// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Seal one artifact at a time to bound installer memory.
// Private rehearsal target tooling (ADR-0001). Like release-versions.ts, this
// module has no dependencies so the rehearsal workflow can run it from a copy of
// the default branch against the candidate commit it builds. Opening sealed
// artifacts lives in open-rehearsal-target.ts.
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { validateRehearsalVersion } from "./release-versions";
import type { RehearsalReservation } from "./release-versions";

export const rehearsalManifestFile = "rehearsal-target.json";
export const sealedSuffix = ".sealed";

export interface RehearsalTargetManifest {
  candidate: string;
  candidateCommit: string;
  files: string[];
  installer: string;
  sha256: string;
  version: string;
}

const keyLength = 32;
/** AES-GCM nonce length; each sealed file starts with its nonce. */
export const sealedIvLength = 12;

const escapeRegExp = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

const runGit = (repositoryDirectory: string, args: string[]) => {
  const result = Bun.spawnSync(["git", "-C", repositoryDirectory, ...args]);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
};

const versionFiles = (from: string) => {
  const version = escapeRegExp(from);
  return [
    {
      file: "apps/desktop/src-tauri/tauri.conf.json",
      pattern: new RegExp(`("version": ")${version}(")`, "gu"),
    },
    {
      file: "apps/desktop/package.json",
      pattern: new RegExp(`("version": ")${version}(")`, "gu"),
    },
    {
      file: "apps/desktop/src-tauri/Cargo.toml",
      pattern: new RegExp(`^(version = ")${version}(")`, "gmu"),
    },
    {
      file: "apps/desktop/src-tauri/Cargo.lock",
      pattern: new RegExp(
        `(name = "pr0-desktop"\\r?\\nversion = ")${version}(")`,
        "gu"
      ),
    },
  ];
};

/**
 * Changes only the desktop version of a clean candidate checkout from its
 * candidate version to the reserved rehearsal target, then proves with git
 * that nothing else changed.
 */
export const setRehearsalVersion = async (
  repositoryDirectory: string,
  version: string,
  reservations?: readonly RehearsalReservation[]
): Promise<RehearsalReservation> => {
  const reservation = validateRehearsalVersion(version, reservations);
  if (runGit(repositoryDirectory, ["status", "--porcelain"]).trim() !== "") {
    throw new Error("The candidate checkout must be clean");
  }
  const files = versionFiles(reservation.candidate);
  for (const { file, pattern } of files) {
    const filePath = path.join(repositoryDirectory, file);
    const text = await Bun.file(filePath).text();
    if (text.match(pattern)?.length !== 1) {
      throw new Error(
        `${file} must name candidate version ${reservation.candidate} exactly once`
      );
    }
    await Bun.write(filePath, text.replace(pattern, `$1${version}$2`));
  }
  const changed = runGit(repositoryDirectory, ["diff", "--numstat"])
    .trim()
    .split("\n")
    .toSorted();
  const expected = files.map(({ file }) => `1\t1\t${file}`).toSorted();
  if (changed.join("\n") !== expected.join("\n")) {
    throw new Error(
      `The rehearsal target must differ from its candidate only in version: ${changed.join(", ")}`
    );
  }
  return reservation;
};

export const importRehearsalArtifactKey = async (base64Key: string) => {
  const raw = Buffer.from(base64Key.trim(), "base64");
  if (raw.length !== keyLength) {
    throw new Error(
      "The rehearsal artifact key must be 32 bytes encoded as base64"
    );
  }
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
};

/** Binds each sealed file to its version and name so files cannot be swapped. */
export const sealedFileContext = (version: string, filename: string) =>
  new TextEncoder().encode(`pr0 rehearsal target ${version}/${filename}`);

export const rehearsalTargetFiles = (version: string) => {
  const installer = `pr0_${version}_x64-setup.exe`;
  return [installer, `${installer}.sig`, "signing-evidence.json"];
};

export const sha256File = async (filePath: string) => {
  const bytes = await Bun.file(filePath).arrayBuffer();
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
};

export const requireEmptyDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory);
  if (entries.length > 0) {
    throw new Error(`Output directory must be empty: ${directory}`);
  }
};

interface SealOptions {
  bundleDirectory: string;
  candidateCommit: string;
  key: string;
  outputDirectory: string;
  reservations?: readonly RehearsalReservation[];
  version: string;
}

/**
 * Encrypts a rehearsal target's installer, signature and signing evidence so
 * that the workflow artifact holding them is private even in a public
 * repository. Only the plaintext manifest (version, candidate, hash) stays
 * readable. Evidence, updater signature and signed version are verified after
 * opening, by verifyRehearsalTarget.
 */
export const sealRehearsalTarget = async ({
  bundleDirectory,
  candidateCommit,
  key,
  outputDirectory,
  reservations,
  version,
}: SealOptions): Promise<RehearsalTargetManifest> => {
  const { candidate } = validateRehearsalVersion(version, reservations);
  const files = rehearsalTargetFiles(version);
  const [installer = ""] = files;
  const [installerHash, cryptoKey] = await Promise.all([
    sha256File(path.join(bundleDirectory, installer)),
    importRehearsalArtifactKey(key),
    requireEmptyDirectory(outputDirectory),
  ]);
  for (const filename of files) {
    const iv = crypto.getRandomValues(new Uint8Array(sealedIvLength));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: sealedFileContext(version, filename),
      },
      cryptoKey,
      await Bun.file(path.join(bundleDirectory, filename)).arrayBuffer()
    );
    await Bun.write(
      path.join(outputDirectory, `${filename}${sealedSuffix}`),
      Buffer.concat([iv, new Uint8Array(ciphertext)])
    );
  }
  const manifest: RehearsalTargetManifest = {
    version,
    candidate,
    candidateCommit,
    installer,
    sha256: installerHash,
    files,
  };
  await Bun.write(
    path.join(outputDirectory, rehearsalManifestFile),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
};

const usage = `Usage:
  bun rehearsal-target.ts prepare <candidate checkout> <version>
  bun rehearsal-target.ts seal <bundle directory> <output directory> <version> <candidate commit>
seal reads PR0_REHEARSAL_ARTIFACT_KEY.`;

export const requireRehearsalArtifactKey = () => {
  const key = process.env.PR0_REHEARSAL_ARTIFACT_KEY;
  if (!key) {
    throw new Error("PR0_REHEARSAL_ARTIFACT_KEY is required");
  }
  return key;
};

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "prepare" && args.length === 2) {
    const [repositoryDirectory = "", version = ""] = args;
    const { candidate } = await setRehearsalVersion(
      repositoryDirectory,
      version
    );
    process.stdout.write(`Changed version ${candidate} to ${version}\n`);
  } else if (command === "seal" && args.length === 4) {
    const [bundleDirectory = "", outputDirectory = "", version = ""] = args;
    const manifest = await sealRehearsalTarget({
      bundleDirectory,
      outputDirectory,
      version,
      candidateCommit: args[3] ?? "",
      key: requireRehearsalArtifactKey(),
    });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    throw new Error(usage);
  }
}
