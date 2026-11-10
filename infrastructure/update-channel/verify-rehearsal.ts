// Opens a sealed rehearsal target into a temporary directory and verifies it
// with Minisign exactly as the live channel verifies public releases.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  openVerifiedRehearsalTarget,
  requireRehearsalVerificationKeys,
} from "./open-rehearsal-target";

const [sealedDirectory] = process.argv.slice(2);
if (!sealedDirectory) {
  throw new Error(
    "Usage: bun verify-rehearsal.ts <sealed directory> with PR0_REHEARSAL_ARTIFACT_KEY and PR0_UPDATE_PUBLIC_KEY set"
  );
}
const keys = requireRehearsalVerificationKeys();
const directory = await mkdtemp(path.join(tmpdir(), "pr0-rehearsal-"));
try {
  const { target } = await openVerifiedRehearsalTarget({
    ...keys,
    sealedDirectory,
    outputDirectory: directory,
  });
  process.stdout.write(
    `Rehearsal target ${target.version} (candidate ${target.candidate} at ${target.candidateCommit}) verified: sha256 ${target.sha256}\n`
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
