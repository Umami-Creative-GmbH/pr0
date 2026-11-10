// Opens a sealed rehearsal target into a temporary directory and verifies it
// with Minisign exactly as the live channel verifies public releases.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openRehearsalTarget } from "./open-rehearsal-target";
import { verifyRehearsalTarget } from "./package-channel";

const [sealedDirectory] = process.argv.slice(2);
const key = process.env.PR0_REHEARSAL_ARTIFACT_KEY;
const publicKey = process.env.PR0_UPDATE_PUBLIC_KEY;
if (!(sealedDirectory && key && publicKey)) {
  throw new Error(
    "Usage: bun verify-rehearsal.ts <sealed directory> with PR0_REHEARSAL_ARTIFACT_KEY and PR0_UPDATE_PUBLIC_KEY set"
  );
}
const directory = await mkdtemp(path.join(tmpdir(), "pr0-rehearsal-"));
try {
  const manifest = await openRehearsalTarget({
    sealedDirectory,
    outputDirectory: directory,
    key,
  });
  await verifyRehearsalTarget({
    directory,
    publicKey,
    version: manifest.version,
  });
  process.stdout.write(
    `Rehearsal target ${manifest.version} (candidate ${manifest.candidate} at ${manifest.candidateCommit}) verified: sha256 ${manifest.sha256}\n`
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
