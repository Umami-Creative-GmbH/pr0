import { afterEach, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { packageRehearsalChannel } from "./package-rehearsal-channel";
import { sealRehearsalTarget } from "./rehearsal-target";
import {
  removeTemporaryDirectories,
  signedRelease,
  temporaryDirectory,
} from "./test-fixtures";

// These tests spawn bun and Minisign, which can be slow on Windows hosts.
const processTestTimeout = 30_000;
const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 9).toString("base64");
const installer = "pr0_0.1.1_x64-setup.exe";

const listFiles = async (directory: string) => {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(directory, path.join(entry.parentPath, entry.name))
        .replaceAll("\\", "/")
    )
    .toSorted();
};

/** A reserved target as the rehearsal-target workflow uploads it: sealed. */
const sealedTarget = async (version = "0.1.1") => {
  const target = await signedRelease(version);
  const sealedDirectory = path.join(await temporaryDirectory(), "sealed");
  await sealRehearsalTarget({
    bundleDirectory: target.directory,
    candidateCommit: "0123456789abcdef0123456789abcdef01234567",
    key,
    outputDirectory: sealedDirectory,
    version,
  });
  return { ...target, sealedDirectory };
};

afterEach(removeTemporaryDirectories);

test("a sealed reserved target packages into a rehearsal channel holding only its manifest and artifacts", async () => {
  const target = await sealedTarget();
  const outputDirectory = path.join(await temporaryDirectory(), "channel");
  await packageRehearsalChannel({
    key,
    outputDirectory,
    publicKey: target.publicKey,
    sealedDirectory: target.sealedDirectory,
  });
  expect(await listFiles(outputDirectory)).toEqual([
    "rehearsal.json",
    `releases/0.1.1/${installer}`,
    `releases/0.1.1/${installer}.sig`,
    "releases/0.1.1/signing-evidence.json",
  ]);
  expect(
    await Bun.file(path.join(outputDirectory, "rehearsal.json")).json()
  ).toEqual({
    version: "0.1.1",
    notes: "Rehearsal target 0.1.1 for candidate 0.1.0. Not a public release.",
    platforms: {
      "windows-x86_64": {
        url: `https://pr0.umami-creative.app/update/releases/0.1.1/${installer}`,
        signature: target.signature,
      },
    },
  });
  expect(
    await Bun.file(
      path.join(outputDirectory, "releases/0.1.1", installer)
    ).text()
  ).toBe("abc");
});

test("a target signed with another updater key is refused before anything is packaged", async () => {
  const target = await sealedTarget();
  const official = await signedRelease("0.1.0");
  const outputDirectory = path.join(await temporaryDirectory(), "channel");
  await expect(
    packageRehearsalChannel({
      key,
      outputDirectory,
      publicKey: official.publicKey,
      sealedDirectory: target.sealedDirectory,
    })
  ).rejects.toThrow("Updater signature or signed version invalid");
  expect(await listFiles(outputDirectory)).toEqual([]);
});

test("a target sealed with another key is refused", async () => {
  const target = await sealedTarget();
  await expect(
    packageRehearsalChannel({
      key: otherKey,
      outputDirectory: path.join(await temporaryDirectory(), "channel"),
      publicKey: target.publicKey,
      sealedDirectory: target.sealedDirectory,
    })
  ).rejects.toThrow("Cannot open sealed rehearsal artifact");
});

test("a target whose version is no longer reserved is refused", async () => {
  const target = await sealedTarget();
  await expect(
    packageRehearsalChannel({
      key,
      outputDirectory: path.join(await temporaryDirectory(), "channel"),
      publicKey: target.publicKey,
      reservations: [{ version: "0.1.3", candidate: "0.1.2" }],
      sealedDirectory: target.sealedDirectory,
    })
  ).rejects.toThrow("Not a reserved rehearsal version");
});

test("packaging refuses a dirty output directory rather than including unrelated files", async () => {
  const target = await sealedTarget();
  const outputDirectory = await temporaryDirectory();
  await Bun.write(path.join(outputDirectory, "live.json"), "{}");
  await expect(
    packageRehearsalChannel({
      key,
      outputDirectory,
      publicKey: target.publicKey,
      sealedDirectory: target.sealedDirectory,
    })
  ).rejects.toThrow("Output directory must be empty");
});

test(
  "the packaging CLI reads its keys from the environment and reports the packaged target",
  async () => {
    const target = await sealedTarget();
    const outputDirectory = path.join(await temporaryDirectory(), "channel");
    const script = path.join(import.meta.dir, "package-rehearsal-channel.ts");
    const missingKeys = Bun.spawnSync(
      ["bun", script, target.sealedDirectory, outputDirectory],
      {
        env: {
          ...process.env,
          PR0_REHEARSAL_ARTIFACT_KEY: "",
          PR0_UPDATE_PUBLIC_KEY: "",
        },
      }
    );
    expect(missingKeys.exitCode).not.toBe(0);
    const packaged = Bun.spawnSync(
      ["bun", script, target.sealedDirectory, outputDirectory],
      {
        env: {
          ...process.env,
          PR0_REHEARSAL_ARTIFACT_KEY: key,
          PR0_UPDATE_PUBLIC_KEY: target.publicKey,
        },
      }
    );
    expect(packaged.stderr.toString()).toBe("");
    expect(packaged.exitCode).toBe(0);
    expect(packaged.stdout.toString()).toContain(
      "Rehearsal channel packaged: 0.1.1 (candidate 0.1.0 at 0123456789abcdef0123456789abcdef01234567), sha256 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(
      await Bun.file(path.join(outputDirectory, "rehearsal.json")).exists()
    ).toBe(true);
  },
  processTestTimeout
);

test(
  "the verification CLI requires both keys and verifies the sealed target",
  async () => {
    const target = await sealedTarget();
    const script = path.join(import.meta.dir, "verify-rehearsal.ts");
    const missingKey = Bun.spawnSync(["bun", script, target.sealedDirectory], {
      env: {
        ...process.env,
        PR0_REHEARSAL_ARTIFACT_KEY: "",
        PR0_UPDATE_PUBLIC_KEY: target.publicKey,
      },
    });
    expect(missingKey.exitCode).not.toBe(0);
    expect(missingKey.stderr.toString()).toContain(
      "PR0_REHEARSAL_ARTIFACT_KEY is required"
    );
    const verified = Bun.spawnSync(["bun", script, target.sealedDirectory], {
      env: {
        ...process.env,
        PR0_REHEARSAL_ARTIFACT_KEY: key,
        PR0_UPDATE_PUBLIC_KEY: target.publicKey,
      },
    });
    expect(verified.stderr.toString()).toBe("");
    expect(verified.exitCode).toBe(0);
    expect(verified.stdout.toString()).toContain(
      "Rehearsal target 0.1.1 (candidate 0.1.0 at 0123456789abcdef0123456789abcdef01234567) verified"
    );
  },
  processTestTimeout
);
