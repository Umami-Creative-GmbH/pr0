// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Open one artifact at a time to bound installer memory.
import path from "node:path";

import { z } from "zod";

import {
  importRehearsalArtifactKey,
  rehearsalManifestFile,
  rehearsalTargetFiles,
  requireEmptyDirectory,
  requireRehearsalArtifactKey,
  sealedFileContext,
  sealedIvLength,
  sealedSuffix,
  sha256File,
} from "./rehearsal-target";
import type { RehearsalTargetManifest } from "./rehearsal-target";
import { validateRehearsalVersion } from "./release-versions";
import type { RehearsalReservation } from "./release-versions";

const manifestSchema = z.object({
  version: z.string(),
  candidate: z.string(),
  candidateCommit: z.string(),
  installer: z.string(),
  sha256: z.string(),
  files: z.array(z.string()),
});

interface OpenOptions {
  key: string;
  outputDirectory: string;
  reservations?: readonly RehearsalReservation[];
  sealedDirectory: string;
}

const decrypt = async (
  key: CryptoKey,
  sealed: Uint8Array<ArrayBuffer>,
  context: Uint8Array<ArrayBuffer>,
  filename: string
) => {
  try {
    return await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: sealed.subarray(0, sealedIvLength),
        additionalData: context,
      },
      key,
      sealed.subarray(sealedIvLength)
    );
  } catch {
    throw new Error(`Cannot open sealed rehearsal artifact: ${filename}`);
  }
};

/**
 * Decrypts a sealed rehearsal target into an empty directory. Callers must
 * still verify the result with verifyRehearsalTarget before serving it.
 */
export const openRehearsalTarget = async ({
  key,
  outputDirectory,
  reservations,
  sealedDirectory,
}: OpenOptions): Promise<RehearsalTargetManifest> => {
  const manifest = manifestSchema.parse(
    await Bun.file(path.join(sealedDirectory, rehearsalManifestFile)).json()
  );
  validateRehearsalVersion(manifest.version, reservations);
  const files = rehearsalTargetFiles(manifest.version);
  if (
    manifest.installer !== files[0] ||
    manifest.files.join("\n") !== files.join("\n")
  ) {
    throw new Error("Rehearsal target manifest is inconsistent");
  }
  const cryptoKey = await importRehearsalArtifactKey(key);
  await requireEmptyDirectory(outputDirectory);
  for (const filename of files) {
    const sealed = await Bun.file(
      path.join(sealedDirectory, `${filename}${sealedSuffix}`)
    ).arrayBuffer();
    const plaintext = await decrypt(
      cryptoKey,
      new Uint8Array(sealed),
      sealedFileContext(manifest.version, filename),
      filename
    );
    await Bun.write(path.join(outputDirectory, filename), plaintext);
  }
  const installerHash = await sha256File(
    path.join(outputDirectory, manifest.installer)
  );
  if (installerHash !== manifest.sha256) {
    throw new Error("Opened installer does not match the recorded hash");
  }
  return manifest;
};

if (import.meta.main) {
  const [sealedDirectory, outputDirectory] = process.argv.slice(2);
  if (!(sealedDirectory && outputDirectory)) {
    throw new Error(
      "Usage: bun open-rehearsal-target.ts <sealed directory> <empty output directory> with PR0_REHEARSAL_ARTIFACT_KEY set"
    );
  }
  await openRehearsalTarget({
    sealedDirectory,
    outputDirectory,
    key: requireRehearsalArtifactKey(),
  });
}
