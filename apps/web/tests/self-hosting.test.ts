import { expect, test } from "bun:test";

import { z } from "zod";

import {
  selfHostingTitle,
  selfHostingTemplate,
  verifySelfHostingBrowser,
} from "./self-hosting-browser";
import { selfHostingClient } from "./self-hosting-client";
import {
  selfHostingFixture,
  selfHostingPassword,
} from "./self-hosting-fixture";
import { verifySelfHostingNative } from "./self-hosting-native";
import {
  verifySelfHostingIsolation,
  verifySelfHostingRestore,
} from "./self-hosting-recovery";
import { verifySelfHostingUpgrade } from "./self-hosting-upgrade";

const composeSchema = z.object({
  services: z.object({
    operations: z.object({ image: z.string() }),
    accounts: z.object({ image: z.string() }),
    database: z.object({
      networks: z.record(z.string(), z.object({}).nullable()),
      ports: z.array(z.object({})).optional(),
    }),
  }),
  networks: z.object({ database: z.object({ internal: z.boolean() }) }),
});

test("Compose exposes the operator commands with versioned application images", async () => {
  const instance = await selfHostingFixture();
  try {
    const configuration = composeSchema.parse(
      JSON.parse(await instance.compose("config", "--format", "json"))
    );
    expect(configuration.services.operations.image).toBe(
      instance.settings.PR0_IMAGE
    );
    expect(configuration.services.accounts.image).toBe(
      instance.settings.PR0_TOOLS_IMAGE
    );
    expect(Object.keys(configuration.services.database.networks)).toEqual([
      "database",
    ]);
    expect(configuration.services.database.ports).toBeUndefined();
    expect(configuration.networks.database.internal).toBe(true);
  } finally {
    await instance.cleanup();
  }
});

test("fresh production Compose initializes mounted secrets, verified email access and storage diagnostics", async () => {
  const instance = await selfHostingFixture();
  const email = "self-hoster@example.test";
  const peer = await selfHostingFixture();
  try {
    await instance.initialize(email);
    const denied = await instance.request("/api/auth/sign-up/email", {
      email: "uninvited@example.test",
      password: selfHostingPassword,
    });
    expect(denied.status).toBe(403);
    const signup = await instance.request("/api/auth/sign-up/email", {
      email,
      password: selfHostingPassword,
    });
    expect(signup.status).toBe(202);
    const unverified = await instance.request("/api/auth/sign-in/email", {
      email,
      password: selfHostingPassword,
    });
    expect(unverified.status).toBe(401);
    const link = await instance.verificationLink(email);
    expect(link.startsWith(instance.origin)).toBe(true);
    const verification = await fetch(link, { redirect: "manual" });
    expect(verification.status).toBe(303);
    expect(verification.headers.get("location")).toBe(
      `${instance.origin}/?verified=1`
    );
    const cookie = await instance.login(email);
    const library = await instance.library(cookie);
    expect(library.account.email).toBe(email);
    expect(library.instance.origin).toBe(instance.origin);
    expect(
      await instance.compose(
        "run",
        "--rm",
        "operations",
        "sample-storage",
        "database",
        "/var/lib/postgresql/data"
      )
    ).toContain('"event":"storage_sampled"');
    await verifySelfHostingBrowser(instance, email);
    const client = selfHostingClient(instance, cookie);
    const found = await client.getPrompts({ query: "independent instance" });
    expect(found.prompts).toHaveLength(1);
    const [prompt] = found.prompts;
    expect(prompt?.title).toBe(selfHostingTitle);
    if (!prompt) {
      throw new Error("Saved prompt absent from search");
    }
    const saved = await client.getPrompt(prompt.id);
    expect(saved.content).toBe(selfHostingTemplate);
    await instance.compose("restart", "web", "mail");
    await instance.ready();
    const restarted = await instance.library(cookie);
    expect(restarted.instance.id).toBe(library.instance.id);
    await instance.compose("down");
    await instance.compose(
      "up",
      "-d",
      "--no-build",
      "--wait",
      "database",
      "smtp"
    );
    await instance.compose("run", "--rm", "accounts", "migrate");
    await instance.compose("up", "-d", "--no-build", "web", "mail");
    await instance.ready();
    const recreated = await instance.library(cookie);
    expect(recreated.account.id).toBe(library.account.id);
    const durable = await client.getPrompt(prompt.id);
    expect(durable.content).toBe(selfHostingTemplate);
    expect(
      await instance.compose(
        "run",
        "--rm",
        "operations",
        "sample-storage",
        "search",
        "/var/lib/pr0-search"
      )
    ).toContain('"event":"storage_sampled"');
    await verifySelfHostingIsolation(instance, peer, email, cookie);
    await verifySelfHostingUpgrade(instance, cookie, prompt.id);
    const executable = process.env.PR0_SELF_HOST_NATIVE_EXE;
    if (executable) {
      await verifySelfHostingNative(
        instance,
        peer,
        email,
        prompt.id,
        executable
      );
    }
    // Catch up the on-demand search projection after native uploads.
    await client.getPrompts();
    const recovery = await verifySelfHostingRestore(
      instance,
      email,
      cookie,
      prompt.id
    );
    process.stdout.write(`SELF_HOSTING_RECOVERY ${JSON.stringify(recovery)}\n`);
    const architecture = await instance.compose(
      "exec",
      "-T",
      "web",
      "uname",
      "-m"
    );
    const bun = await instance.compose("exec", "-T", "web", "bun", "--version");
    const postgresql = await instance.compose(
      "exec",
      "-T",
      "database",
      "postgres",
      "--version"
    );
    const tools = await instance.compose(
      "run",
      "--rm",
      "--entrypoint",
      "pg_dump",
      "backup",
      "--version"
    );
    const evidence = {
      measuredAt: new Date().toISOString(),
      architecture: architecture.trim(),
      bun: bun.trim(),
      postgresql: postgresql.trim(),
      tools: tools.trim(),
      images: [instance.settings.PR0_IMAGE, instance.settings.PR0_TOOLS_IMAGE],
      mountedSecrets: true,
      emailVerification: true,
      browserCreateSearchVariableCopy: true,
      restartAndDownPreservedIdentity: true,
      schema20To21Upgrade: true,
      independentSameEmail: true,
      nativeHttpsOfflineReconnectAndSwitch: Boolean(executable),
      recovery,
      limitations: [
        "The local backup mount does not establish independent host-loss durability.",
        "SMTP sink is local; real SMTP delivery and optional OAuth require operator integration.",
        "Native command worker is not a signed installed release acceptance test.",
      ],
    };
    if (process.env.PR0_SELF_HOST_EVIDENCE) {
      await Bun.write(
        process.env.PR0_SELF_HOST_EVIDENCE,
        `${JSON.stringify(evidence, null, 2)}\n`
      );
    }
    process.stdout.write(`SELF_HOSTING_EVIDENCE ${JSON.stringify(evidence)}\n`);
  } finally {
    await peer.cleanup();
    await instance.cleanup();
  }
}, 600_000);
