// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Verify and retain one release at a time to bound installer memory and preserve activation order.
import { copyFile, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  reservedRehearsalVersions,
  validatePublicVersion,
  validateRehearsalVersion,
} from "./release-versions";
import type { RehearsalReservation } from "./release-versions";

export interface ChannelRelease {
  directory: string;
  notes: string;
  version: string;
}

interface PackageOptions {
  outputDirectory: string;
  previousDirectory?: string;
  publicKey: string;
  releases: ChannelRelease[];
  reservations?: readonly RehearsalReservation[];
}

interface RehearsalTargetOptions {
  directory: string;
  publicKey: string;
  reservations?: readonly RehearsalReservation[];
  version: string;
}

const signingEvidenceSchema = z.object({
  version: z.string(),
  installer: z.string(),
  sha256: z.string(),
});
const manifestVersionSchema = z.object({ version: z.string() });
const compareVersions = (left: string, right: string) =>
  left.localeCompare(right, "en", { numeric: true });

const verifyRelease = async (
  release: Pick<ChannelRelease, "directory" | "version">,
  publicKey: string
) => {
  const installer = `pr0_${release.version}_x64-setup.exe`;
  const installerPath = path.join(release.directory, installer);
  const evidence = signingEvidenceSchema.parse(
    await Bun.file(path.join(release.directory, "signing-evidence.json")).json()
  );
  const sha256 = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(installerPath).arrayBuffer())
    .digest("hex");
  if (
    evidence.version !== release.version ||
    evidence.installer !== installer ||
    evidence.sha256.toLowerCase() !== sha256
  ) {
    throw new Error(`Signing evidence mismatch: ${release.version}`);
  }
  const signatureText = await Bun.file(`${installerPath}.sig`).text();
  const signature = signatureText.trim();
  const verificationDirectory = await mkdtemp(
    path.join(tmpdir(), "pr0-signature-")
  );
  try {
    const keyPath = path.join(verificationDirectory, "public.key");
    const signaturePath = path.join(verificationDirectory, "signature.minisig");
    await Promise.all([
      Bun.write(keyPath, Buffer.from(publicKey.trim(), "base64")),
      Bun.write(signaturePath, Buffer.from(signature, "base64")),
    ]);
    const verification = Bun.spawn(
      [
        process.env.MINISIGN_PATH ?? "minisign",
        "-Vm",
        installerPath,
        "-p",
        keyPath,
        "-x",
        signaturePath,
        "-Q",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const [comment, , exitCode] = await Promise.all([
      new Response(verification.stdout).text(),
      new Response(verification.stderr).text(),
      verification.exited,
    ]);
    if (
      exitCode !== 0 ||
      !comment.trim().split("\t").includes(`version:${release.version}`)
    ) {
      throw new Error(
        `Updater signature or signed version invalid: ${release.version}`
      );
    }
  } finally {
    await rm(verificationDirectory, { recursive: true, force: true });
  }
  return { installer, signature };
};

const copyImmutableArtifact = async (source: string, destination: string) => {
  if (await Bun.file(destination).exists()) {
    const [existing, incoming] = await Promise.all([
      Bun.file(destination).arrayBuffer(),
      Bun.file(source).arrayBuffer(),
    ]);
    if (!Buffer.from(existing).equals(Buffer.from(incoming))) {
      throw new Error(`Immutable artifact changed: ${destination}`);
    }
    return;
  }
  await copyFile(source, destination);
};

/**
 * Verifies a private rehearsal target with the same evidence, hash, updater
 * signature and signed-version checks as public releases. Only reserved
 * rehearsal versions are accepted.
 */
export const verifyRehearsalTarget = async ({
  directory,
  publicKey,
  reservations = reservedRehearsalVersions,
  version,
}: RehearsalTargetOptions): Promise<{
  installer: string;
  signature: string;
}> => {
  validateRehearsalVersion(version, reservations);
  return await verifyRelease({ directory, version }, publicKey);
};

export const packageChannel = async ({
  outputDirectory,
  releases,
  publicKey,
  previousDirectory,
  reservations = reservedRehearsalVersions,
}: PackageOptions): Promise<void> => {
  for (const release of releases) {
    validatePublicVersion(release.version, reservations);
  }
  await mkdir(outputDirectory, { recursive: true });
  const existing = await readdir(outputDirectory);
  if (existing.some((filename) => filename !== ".gitkeep")) {
    throw new Error("Output directory must be empty before packaging");
  }
  if (previousDirectory) {
    await cp(previousDirectory, outputDirectory, { recursive: true });
  }
  const ordered = releases.toSorted((left, right) =>
    compareVersions(left.version, right.version)
  );
  const latest = ordered.at(-1);
  const previousManifest = Bun.file(path.join(outputDirectory, "live.json"));
  if (latest && (await previousManifest.exists())) {
    const previous = manifestVersionSchema.parse(await previousManifest.json());
    if (compareVersions(previous.version, latest.version) > 0) {
      throw new Error(
        "Live manifest would downgrade; preserve the current release and investigate missing GitHub releases"
      );
    }
  }
  for (const release of ordered) {
    const { installer, signature } = await verifyRelease(release, publicKey);
    const directory = path.join(outputDirectory, "releases", release.version);
    await mkdir(directory, { recursive: true });
    await Promise.all(
      [installer, `${installer}.sig`, "signing-evidence.json"].map((filename) =>
        copyImmutableArtifact(
          path.join(release.directory, filename),
          path.join(directory, filename)
        )
      )
    );
    await Bun.write(
      path.join(outputDirectory, "live.json"),
      JSON.stringify(
        {
          version: release.version,
          notes: release.notes,
          platforms: {
            "windows-x86_64": {
              url: `https://pr0.umami-creative.app/update/releases/${release.version}/${installer}`,
              signature,
            },
          },
        },
        null,
        2
      )
    );
  }
};
