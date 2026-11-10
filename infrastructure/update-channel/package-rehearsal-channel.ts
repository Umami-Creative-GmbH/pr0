// Packages one sealed rehearsal target into the private rehearsal channel
// (ADR-0001). The rehearsal channel is its own image, built from
// rehearsal-channel/; the live channel's build context never admits it.
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  openVerifiedRehearsalTarget,
  requireRehearsalVerificationKeys,
} from "./open-rehearsal-target";
import type { RehearsalTargetManifest } from "./open-rehearsal-target";
import { updateManifest } from "./package-channel";
import { requireEmptyDirectory } from "./rehearsal-target";
import type { RehearsalReservation } from "./release-versions";

/** The manifest the rehearsal channel serves at /update/. */
export const rehearsalChannelManifestFile = "rehearsal.json";

interface RehearsalChannelOptions {
  key: string;
  outputDirectory: string;
  publicKey: string;
  reservations?: readonly RehearsalReservation[];
  sealedDirectory: string;
}

/**
 * Opens a sealed rehearsal target and verifies its hash, signing evidence,
 * updater signature and signed version exactly as the live channel verifies
 * public releases. Only then does it write the rehearsal manifest and the
 * target's installer, signature and evidence into an empty output directory.
 */
export const packageRehearsalChannel = async ({
  key,
  outputDirectory,
  publicKey,
  reservations,
  sealedDirectory,
}: RehearsalChannelOptions): Promise<RehearsalTargetManifest> => {
  await requireEmptyDirectory(outputDirectory);
  const opened = await mkdtemp(path.join(tmpdir(), "pr0-rehearsal-channel-"));
  try {
    const { installer, signature, target } = await openVerifiedRehearsalTarget({
      key,
      outputDirectory: opened,
      publicKey,
      reservations,
      sealedDirectory,
    });
    const releaseDirectory = path.join(
      outputDirectory,
      "releases",
      target.version
    );
    await mkdir(releaseDirectory, { recursive: true });
    await Promise.all(
      target.files.map((filename) =>
        copyFile(
          path.join(opened, filename),
          path.join(releaseDirectory, filename)
        )
      )
    );
    await Bun.write(
      path.join(outputDirectory, rehearsalChannelManifestFile),
      updateManifest({
        installer,
        notes: `Rehearsal target ${target.version} for candidate ${target.candidate}. Not a public release.`,
        signature,
        version: target.version,
      })
    );
    return target;
  } finally {
    await rm(opened, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  const [
    sealedDirectory,
    outputDirectory = path.join(
      import.meta.dir,
      "rehearsal-channel",
      "channel"
    ),
  ] = process.argv.slice(2);
  if (!sealedDirectory) {
    throw new Error(
      "Usage: bun package-rehearsal-channel.ts <sealed directory> [empty output directory] with PR0_REHEARSAL_ARTIFACT_KEY and PR0_UPDATE_PUBLIC_KEY set"
    );
  }
  const target = await packageRehearsalChannel({
    ...requireRehearsalVerificationKeys(),
    outputDirectory,
    sealedDirectory,
  });
  process.stdout.write(
    `Rehearsal channel packaged: ${target.version} (candidate ${target.candidate} at ${target.candidateCommit}), sha256 ${target.sha256}\n`
  );
}
