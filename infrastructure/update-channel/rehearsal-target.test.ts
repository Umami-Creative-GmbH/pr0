import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openRehearsalTarget } from "./open-rehearsal-target";
import { sealRehearsalTarget, setRehearsalVersion } from "./rehearsal-target";
import {
  parseReservations,
  reservedRehearsalVersions,
  validatePublicVersion,
  validateRehearsalVersion,
} from "./release-versions";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const temporaryDirectory = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-rehearsal-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

// These tests spawn git and bun, which can be slow on Windows hosts.
const processTestTimeout = 30_000;
const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 9).toString("base64");

const git = (directory: string, ...args: string[]) => {
  const result = Bun.spawnSync([
    "git",
    "-C",
    directory,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "core.autocrlf=false",
    ...args,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString();
};

const candidateCheckout = async (version = "0.1.0") => {
  const directory = await temporaryDirectory();
  const files = {
    "apps/desktop/src-tauri/tauri.conf.json": `{\n  "productName": "pr0",\n  "version": "${version}",\n  "plugins": { "updater": { "pubkey": "" } }\n}\n`,
    "apps/desktop/package.json": `{\n  "name": "@pr0/desktop",\n  "version": "${version}",\n  "dependencies": { "react": "19.2.8" }\n}\n`,
    "apps/desktop/src-tauri/Cargo.toml": `[package]\nname = "pr0-desktop"\nversion = "${version}"\n\n[dependencies]\nserde = { version = "${version}" }\n`,
    "apps/desktop/src-tauri/Cargo.lock": `[[package]]\nname = "other"\nversion = "${version}"\n\n[[package]]\nname = "pr0-desktop"\nversion = "${version}"\n`,
    "README.md": `pr0 ${version}\n`,
  };
  await Promise.all(
    Object.entries(files).map(([file, text]) =>
      Bun.write(path.join(directory, file), text)
    )
  );
  git(directory, "init", "--quiet");
  git(directory, "add", ".");
  git(directory, "commit", "--quiet", "-m", "candidate");
  return directory;
};

const builtTarget = async (version = "0.1.1") => {
  const directory = await temporaryDirectory();
  const installer = `pr0_${version}_x64-setup.exe`;
  await Bun.write(path.join(directory, installer), "abc");
  await Bun.write(path.join(directory, `${installer}.sig`), "signature");
  await Bun.write(
    path.join(directory, "signing-evidence.json"),
    JSON.stringify({ version, installer })
  );
  return directory;
};

const runCli = (script: string, ...args: string[]) =>
  Bun.spawnSync(["bun", path.join(import.meta.dir, script), ...args], {
    env: { ...process.env, PR0_REHEARSAL_ARTIFACT_KEY: key },
  });

test("the repository reserves 0.1.1 as the rehearsal target of candidate 0.1.0", () => {
  expect(reservedRehearsalVersions).toContainEqual({
    version: "0.1.1",
    candidate: "0.1.0",
  });
  expect(() => validatePublicVersion("0.1.1")).toThrow(
    "reserved for a rehearsal target"
  );
  expect(() => validatePublicVersion("0.1.0")).not.toThrow();
  expect(validateRehearsalVersion("0.1.1").candidate).toBe("0.1.0");
  expect(() => validateRehearsalVersion("0.1.0")).toThrow(
    "Not a reserved rehearsal version"
  );
});

test.each([
  [
    "a target that does not follow its candidate",
    [{ version: "0.1.3", candidate: "0.1.0" }],
  ],
  [
    "a version reserved twice",
    [
      { version: "0.1.1", candidate: "0.1.0" },
      { version: "0.1.1", candidate: "0.1.0" },
    ],
  ],
  [
    "a reserved version used as a candidate",
    [
      { version: "0.1.1", candidate: "0.1.0" },
      { version: "0.1.2", candidate: "0.1.1" },
    ],
  ],
  ["a prerelease", [{ version: "0.1.1-rc.1", candidate: "0.1.0" }]],
])("the reserved-versions list rejects %s", (_name, rehearsalTargets) => {
  expect(() => parseReservations({ rehearsalTargets })).toThrow();
});

test(
  "the candidate workflow's version check refuses reserved versions",
  () => {
    expect(runCli("release-versions.ts", "public", "0.1.1").exitCode).not.toBe(
      0
    );
    expect(runCli("release-versions.ts", "public", "0.1.0").exitCode).toBe(0);
  },
  processTestTimeout
);

test(
  "the rehearsal workflow's version check accepts only reserved versions and names their candidate",
  () => {
    const reserved = runCli("release-versions.ts", "rehearsal", "0.1.1");
    expect(reserved.exitCode).toBe(0);
    expect(reserved.stdout.toString().trim()).toBe("0.1.0");
    expect(
      runCli("release-versions.ts", "rehearsal", "0.1.0").exitCode
    ).not.toBe(0);
    expect(
      runCli("release-versions.ts", "rehearsal", "0.1.2").exitCode
    ).not.toBe(0);
  },
  processTestTimeout
);

test(
  "a rehearsal target changes only the desktop version of its candidate",
  async () => {
    const checkout = await candidateCheckout();
    await setRehearsalVersion(checkout, "0.1.1");
    const diff = git(checkout, "diff", "--unified=0", "--no-color");
    const changedLines = diff
      .split("\n")
      .filter((line) => /^[+-][^+-]/u.test(line));
    expect(changedLines.toSorted()).toEqual(
      [
        '-  "version": "0.1.0",',
        '+  "version": "0.1.1",',
        '-  "version": "0.1.0",',
        '+  "version": "0.1.1",',
        '-version = "0.1.0"',
        '+version = "0.1.1"',
        '-version = "0.1.0"',
        '+version = "0.1.1"',
      ].toSorted()
    );
    const lock = await Bun.file(
      path.join(checkout, "apps/desktop/src-tauri/Cargo.lock")
    ).text();
    expect(lock).toContain('name = "other"\nversion = "0.1.0"');
    expect(lock).toContain('name = "pr0-desktop"\nversion = "0.1.1"');
  },
  processTestTimeout
);

test(
  "the workflows can run the release policy from a copy without dependencies",
  async () => {
    // Workflows copy these files from the default branch before checking out
    // the tag or candidate commit, so they must not import installed packages.
    const policy = await temporaryDirectory();
    await Promise.all(
      [
        "release-versions.ts",
        "rehearsal-target.ts",
        "reserved-rehearsal-versions.json",
      ].map((file) =>
        copyFile(path.join(import.meta.dir, file), path.join(policy, file))
      )
    );
    const checkout = await candidateCheckout();
    const prepare = Bun.spawnSync(
      [
        "bun",
        "--no-install",
        path.join(policy, "rehearsal-target.ts"),
        "prepare",
        checkout,
        "0.1.1",
      ],
      { cwd: policy }
    );
    expect(prepare.stderr.toString()).toBe("");
    expect(prepare.exitCode).toBe(0);
    const check = Bun.spawnSync(
      [
        "bun",
        "--no-install",
        path.join(policy, "release-versions.ts"),
        "public",
        "0.1.1",
      ],
      { cwd: policy }
    );
    expect(check.exitCode).not.toBe(0);
    expect(check.stderr.toString()).toContain(
      "reserved for a rehearsal target"
    );
  },
  processTestTimeout
);

test(
  "the rehearsal build refuses a version that is not reserved",
  async () => {
    const checkout = await candidateCheckout();
    await expect(setRehearsalVersion(checkout, "0.1.2")).rejects.toThrow(
      "Not a reserved rehearsal version"
    );
    expect(git(checkout, "status", "--porcelain")).toBe("");
  },
  processTestTimeout
);

test(
  "the rehearsal build refuses a checkout that is not its reserved candidate",
  async () => {
    const checkout = await candidateCheckout("0.1.2");
    await expect(setRehearsalVersion(checkout, "0.1.1")).rejects.toThrow(
      "must name candidate version 0.1.0"
    );
  },
  processTestTimeout
);

test(
  "the rehearsal build refuses a candidate checkout with other changes",
  async () => {
    const checkout = await candidateCheckout();
    await Bun.write(path.join(checkout, "README.md"), "changed\n");
    await expect(setRehearsalVersion(checkout, "0.1.1")).rejects.toThrow(
      "must be clean"
    );
  },
  processTestTimeout
);

test("sealed rehearsal artifacts are encrypted and open to the exact verified bytes", async () => {
  const bundle = await builtTarget();
  const sealed = path.join(await temporaryDirectory(), "sealed");
  const manifest = await sealRehearsalTarget({
    bundleDirectory: bundle,
    outputDirectory: sealed,
    version: "0.1.1",
    candidateCommit: "abc123",
    key,
  });
  expect(manifest).toEqual({
    version: "0.1.1",
    candidate: "0.1.0",
    candidateCommit: "abc123",
    installer: "pr0_0.1.1_x64-setup.exe",
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    files: [
      "pr0_0.1.1_x64-setup.exe",
      "pr0_0.1.1_x64-setup.exe.sig",
      "signing-evidence.json",
    ],
  });
  const sealedFiles = await readdir(sealed);
  expect(sealedFiles.toSorted()).toEqual([
    "pr0_0.1.1_x64-setup.exe.sealed",
    "pr0_0.1.1_x64-setup.exe.sig.sealed",
    "rehearsal-target.json",
    "signing-evidence.json.sealed",
  ]);
  const sealedSignature = await Bun.file(
    path.join(sealed, "pr0_0.1.1_x64-setup.exe.sig.sealed")
  ).text();
  expect(sealedSignature).not.toContain("signature");

  const opened = path.join(await temporaryDirectory(), "opened");
  await openRehearsalTarget({
    sealedDirectory: sealed,
    outputDirectory: opened,
    key,
  });
  expect(
    await Bun.file(path.join(opened, "pr0_0.1.1_x64-setup.exe")).text()
  ).toBe("abc");
  expect(
    await Bun.file(path.join(opened, "pr0_0.1.1_x64-setup.exe.sig")).text()
  ).toBe("signature");
});

test("sealed rehearsal artifacts cannot be opened with another key or swapped", async () => {
  const sealed = path.join(await temporaryDirectory(), "sealed");
  await sealRehearsalTarget({
    bundleDirectory: await builtTarget(),
    outputDirectory: sealed,
    version: "0.1.1",
    candidateCommit: "abc123",
    key,
  });
  await expect(
    openRehearsalTarget({
      sealedDirectory: sealed,
      outputDirectory: path.join(await temporaryDirectory(), "opened"),
      key: otherKey,
    })
  ).rejects.toThrow("Cannot open sealed rehearsal artifact");
  const signature = path.join(sealed, "pr0_0.1.1_x64-setup.exe.sig.sealed");
  await Bun.write(
    path.join(sealed, "pr0_0.1.1_x64-setup.exe.sealed"),
    Bun.file(signature)
  );
  await expect(
    openRehearsalTarget({
      sealedDirectory: sealed,
      outputDirectory: path.join(await temporaryDirectory(), "opened"),
      key,
    })
  ).rejects.toThrow("Cannot open sealed rehearsal artifact");
});

test("sealing refuses a version that is not reserved", async () => {
  await expect(
    sealRehearsalTarget({
      bundleDirectory: await builtTarget("0.1.0"),
      outputDirectory: path.join(await temporaryDirectory(), "sealed"),
      version: "0.1.0",
      candidateCommit: "abc123",
      key,
    })
  ).rejects.toThrow("Not a reserved rehearsal version");
});

test("opening refuses an installer whose bytes differ from the recorded hash", async () => {
  const sealed = path.join(await temporaryDirectory(), "sealed");
  await sealRehearsalTarget({
    bundleDirectory: await builtTarget(),
    outputDirectory: sealed,
    version: "0.1.1",
    candidateCommit: "abc123",
    key,
  });
  const manifestPath = path.join(sealed, "rehearsal-target.json");
  const manifest = await Bun.file(manifestPath).json();
  await Bun.write(
    manifestPath,
    JSON.stringify({ ...manifest, sha256: "0".repeat(64) })
  );
  await expect(
    openRehearsalTarget({
      sealedDirectory: sealed,
      outputDirectory: path.join(await temporaryDirectory(), "opened"),
      key,
    })
  ).rejects.toThrow("does not match the recorded hash");
});
