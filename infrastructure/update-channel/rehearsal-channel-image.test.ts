// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Containers are cleaned up and polled one at a time.
// Container tests for the rehearsal channel. The build context mirrors this
// directory as an operator's workspace would look mid-rehearsal: the live
// channel packaged with a public release, the rehearsal channel packaged, and
// the downloaded sealed target.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

import { packageChannel } from "./package-channel";
import { packageRehearsalChannel } from "./package-rehearsal-channel";
import { sealRehearsalTarget } from "./rehearsal-target";
import {
  commandOutput,
  removeTemporaryDirectories,
  signedRelease,
  temporaryDirectory,
} from "./test-fixtures";

const containerTestTimeout = 240_000;
const key = Buffer.alloc(32, 7).toString("base64");
const installer = "pr0_0.1.1_x64-setup.exe";

const sealedTarget = async () => {
  const target = await signedRelease("0.1.1");
  const sealedDirectory = path.join(await temporaryDirectory(), "sealed");
  await sealRehearsalTarget({
    bundleDirectory: target.directory,
    candidateCommit: "0123456789abcdef0123456789abcdef01234567",
    key,
    outputDirectory: sealedDirectory,
    version: "0.1.1",
  });
  return { ...target, sealedDirectory };
};

const runId = crypto.randomUUID().slice(0, 8);
const resource = (name: string) => `pr0-rehearsal-test-${runId}-${name}`;
const images = {
  live: resource("live"),
  liveEmpty: resource("live-empty"),
  rehearsal: resource("rehearsal"),
};
const containers: string[] = [];
let network = "";
let rehearsalTarget: Awaited<ReturnType<typeof sealedTarget>>;

const copyChannelConfig = async (source: string, destination: string) => {
  await mkdir(destination, { recursive: true });
  await Promise.all(
    ["Dockerfile", "nginx.conf", ".dockerignore"].map((filename) =>
      cp(path.join(source, filename), path.join(destination, filename))
    )
  );
};

const docker = (...args: string[]) => commandOutput(["docker", ...args]);

const startContainer = async (name: string, ...args: string[]) => {
  containers.push(name);
  await docker("run", "-d", "--name", name, ...args);
};

beforeAll(async () => {
  const context = await temporaryDirectory();
  await copyChannelConfig(import.meta.dir, context);
  await copyChannelConfig(
    path.join(import.meta.dir, "rehearsal-channel"),
    path.join(context, "rehearsal-channel")
  );
  rehearsalTarget = await sealedTarget();
  const published = await signedRelease("0.1.0", rehearsalTarget.directory);
  await packageChannel({
    releases: [published],
    outputDirectory: path.join(context, "channel"),
    publicKey: rehearsalTarget.publicKey,
  });
  await packageRehearsalChannel({
    key,
    outputDirectory: path.join(context, "rehearsal-channel", "channel"),
    publicKey: rehearsalTarget.publicKey,
    sealedDirectory: rehearsalTarget.sealedDirectory,
  });
  await cp(
    rehearsalTarget.sealedDirectory,
    path.join(context, "rehearsal-target-0.1.1"),
    { recursive: true }
  );
  const emptyContext = await temporaryDirectory();
  await copyChannelConfig(import.meta.dir, emptyContext);
  await mkdir(path.join(emptyContext, "channel"));
  await Promise.all([
    docker("build", "-t", images.live, context),
    docker("build", "-t", images.liveEmpty, emptyContext),
    docker(
      "build",
      "-t",
      images.rehearsal,
      path.join(context, "rehearsal-channel")
    ),
  ]);
}, containerTestTimeout);

// Removes only what these tests created, by name, and keeps going past
// resources that were never created.
afterAll(async () => {
  const cleanup = [
    ...containers.map((name) => ["rm", "-f", name]),
    ...(network ? [["network", "remove", network]] : []),
    ...Object.values(images).map((image) => ["image", "rm", image]),
  ];
  for (const args of cleanup) {
    try {
      await docker(...args);
    } catch {
      // Already gone or never created.
    }
  }
  await removeTemporaryDirectories();
}, containerTestTimeout);

test(
  "the rehearsal image serves its manifest uncached and without cookies, and its artifacts",
  async () => {
    const name = resource("serve");
    await startContainer(name, "-p", "127.0.0.1::8080", images.rehearsal);
    await docker(
      "exec",
      name,
      "wget",
      "-q",
      "-O",
      "/dev/null",
      "http://127.0.0.1:8080/healthz"
    );
    const address = await docker("port", name, "8080/tcp");
    const response = await fetch(`http://${address}/update/`, {
      redirect: "manual",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-pr0-update-channel")).toBe("rehearsal");
    expect(response.headers.has("set-cookie")).toBe(false);
    const manifest = await response.json();
    expect(manifest.version).toBe("0.1.1");
    expect(manifest.platforms["windows-x86_64"].signature).toBe(
      rehearsalTarget.signature
    );
    const releases = `http://${address}/update/releases/0.1.1`;
    const artifact = await fetch(`${releases}/${installer}`);
    expect(artifact.headers.has("set-cookie")).toBe(false);
    expect(await artifact.text()).toBe("abc");
    const signature = await fetch(`${releases}/${installer}.sig`);
    expect(await signature.text()).toBe(rehearsalTarget.signature);
    const evidence = await fetch(`${releases}/signing-evidence.json`);
    expect(await evidence.json()).toMatchObject({ version: "0.1.1" });
    for (const missing of [
      "/rehearsal.json",
      "/update/rehearsal.json",
      "/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe",
    ]) {
      const refused = await fetch(`http://${address}${missing}`);
      expect(refused.status).toBe(404);
    }
  },
  containerTestTimeout
);

test(
  "a live-channel image built beside a packaged rehearsal channel contains no rehearsal files",
  async () => {
    const listing = await docker(
      "run",
      "--rm",
      "--entrypoint",
      "find",
      images.live,
      "/srv",
      "/etc/nginx",
      "-type",
      "f"
    );
    const files = listing.split("\n").toSorted();
    expect(files.filter((file) => file.startsWith("/srv"))).toEqual([
      "/srv/update/live.json",
      "/srv/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe",
      "/srv/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe.sig",
      "/srv/update/releases/0.1.0/signing-evidence.json",
    ]);
    expect(
      files.filter((file) => file.includes("0.1.1") || file.includes("rehears"))
    ).toEqual([]);
  },
  containerTestTimeout
);

// Mirrors the runbook's router labels (docs/operations/update-channel.md,
// "Rehearsal channel"), except TLS: the local entrypoint speaks plain HTTP.
const host = "pr0.umami-creative.app";
const routeLabels = (router: string, rule: string, priority?: number) => [
  "traefik.enable=true",
  `traefik.http.routers.${router}.rule=${rule}`,
  ...(priority ? [`traefik.http.routers.${router}.priority=${priority}`] : []),
  `traefik.http.routers.${router}.entrypoints=https`,
  `traefik.http.routers.${router}.service=${router}`,
  `traefik.http.services.${router}.loadbalancer.server.port=8080`,
];

interface UpdateResponse {
  body: string;
  channel: string | undefined;
  status: number | undefined;
}

const statusPattern = /HTTP\/1\.1 (?<status>\d{3})/u;
const channelPattern = /x-pr0-update-channel: (?<channel>\S+)/iu;

/** Requests the official endpoint from a client container at a fixed address. */
const requestFrom = async (
  address: { ipv4: string } | { ipv6: string },
  proxy: string,
  requestPath = "/update/"
): Promise<UpdateResponse> => {
  const addressArgs =
    "ipv4" in address ? ["--ip", address.ipv4] : ["--ip6", address.ipv6];
  const child = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "--network",
      network,
      ...addressArgs,
      `--add-host=${host}:${proxy}`,
      "--entrypoint",
      "wget",
      images.liveEmpty,
      "-S",
      "-q",
      "-O",
      "-",
      `http://${host}${requestPath}`,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [body, headers] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return {
    body,
    channel: headers.match(channelPattern)?.groups?.channel,
    status: Number(headers.match(statusPattern)?.groups?.status) || undefined,
  };
};

test(
  "the higher-priority router sends allowlisted IPv4 addresses and IPv6 /64s to the rehearsal channel and everyone else to the live channel",
  async () => {
    const octet = 1 + Math.floor(Math.random() * 250);
    const hextet = Math.floor(Math.random() * 0xff_ff).toString(16);
    const ipv4 = (last: number) => `10.125.${octet}.${last}`;
    const ipv6 = (subnet: string, last: string) =>
      `fd7d:125:${hextet}:${subnet}::${last}`;
    const networkName = resource("network");
    await docker(
      "network",
      "create",
      "--ipv6",
      "--subnet",
      `${ipv4(0)}/24`,
      "--ip-range",
      `${ipv4(128)}/25`,
      "--subnet",
      `${ipv6("0", "")}/56`,
      "--ip-range",
      `${ipv6("ff", "")}/64`,
      networkName
    );
    network = networkName;
    const constraint = `pr0.rehearsal-test=${runId}`;
    await startContainer(
      resource("traefik"),
      "--network",
      network,
      "--ip",
      ipv4(2),
      "--ip6",
      ipv6("0", "2"),
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock:ro",
      "traefik:v3.6.25@sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d",
      "--entrypoints.https.address=:80",
      "--providers.docker.exposedbydefault=false",
      `--providers.docker.network=${network}`,
      `--providers.docker.constraints=Label(\`pr0.rehearsal-test\`,\`${runId}\`)`
    );
    // The live resource as Coolify generates it for path /update: no explicit
    // priority.
    await startContainer(
      resource("live"),
      "--network",
      network,
      "--label",
      constraint,
      ...routeLabels(
        "pr0-update-live",
        `Host(\`${host}\`) && PathPrefix(\`/update\`)`
      ).flatMap((label) => ["--label", label]),
      images.liveEmpty
    );
    const allowlist = `ClientIP(\`${ipv4(50)}\`) || ClientIP(\`${ipv6("1", "")}/64\`)`;
    await startContainer(
      resource("rehearsal"),
      "--network",
      network,
      "--label",
      constraint,
      ...routeLabels(
        "pr0-rehearsal",
        `Host(\`${host}\`) && PathPrefix(\`/update\`) && (${allowlist})`,
        1000
      ).flatMap((label) => ["--label", label]),
      images.rehearsal
    );

    const tester = { ipv4: ipv4(50) };
    const deadline = Date.now() + 60_000;
    let first = await requestFrom(tester, ipv4(2));
    while (first.channel !== "rehearsal" && Date.now() < deadline) {
      await Bun.sleep(1000);
      first = await requestFrom(tester, ipv4(2));
    }
    expect(first.status).toBe(200);
    expect(first.channel).toBe("rehearsal");
    expect(JSON.parse(first.body).version).toBe("0.1.1");

    const testerIpv6 = [ipv6("1", "50"), ipv6("1", "a:b:c")];
    for (const address of testerIpv6) {
      const response = await requestFrom(
        { ipv6: address },
        `[${ipv6("0", "2")}]`
      );
      expect(response.channel).toBe("rehearsal");
      expect(JSON.parse(response.body).version).toBe("0.1.1");
    }
    const installerPath = `/update/releases/0.1.1/${installer}`;
    const testerInstaller = await requestFrom(tester, ipv4(2), installerPath);
    expect(testerInstaller.body).toBe("abc");

    const everyoneElse = [
      { address: { ipv4: ipv4(51) }, proxy: ipv4(2) },
      { address: { ipv6: ipv6("2", "50") }, proxy: `[${ipv6("0", "2")}]` },
    ];
    for (const { address, proxy } of everyoneElse) {
      const response = await requestFrom(address, proxy);
      expect(response).toEqual({ body: "", channel: undefined, status: 204 });
      const publicInstaller = await requestFrom(address, proxy, installerPath);
      expect(publicInstaller.status).toBe(404);
    }
  },
  containerTestTimeout
);
