// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Download release snapshots in order with bounded memory before packaging.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { packageChannel } from "./package-channel";
import type { ChannelRelease } from "./package-channel";
import { validatePublicVersion } from "./release-versions";

const run = async (command: string[]) => {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "inherit" });
  const [output, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Release command failed: ${command[0]}`);
  }
  return output;
};

const repository = process.env.GITHUB_REPOSITORY;
if (!repository) {
  throw new Error("GITHUB_REPOSITORY is required");
}
const releasesSchema = z.array(
  z.array(
    z.object({
      draft: z.boolean(),
      prerelease: z.boolean(),
      tag_name: z.string(),
      body: z.string().nullish(),
    })
  )
);
const pages = releasesSchema.parse(
  JSON.parse(
    await run([
      "gh",
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/releases?per_page=100`,
    ])
  )
);
const downloads = await mkdtemp(path.join(tmpdir(), "pr0-release-assets-"));
try {
  const releases: ChannelRelease[] = [];
  for (const page of pages) {
    for (const release of page) {
      if (release.draft || release.prerelease) {
        continue;
      }
      if (!release.tag_name.startsWith("v")) {
        throw new Error("Public desktop release tags must use v<version>");
      }
      const version = release.tag_name.slice(1);
      validatePublicVersion(version);
      const directory = path.join(downloads, version);
      const installer = `pr0_${version}_x64-setup.exe`;
      await run([
        "gh",
        "release",
        "download",
        release.tag_name,
        "--repo",
        repository,
        "--dir",
        directory,
        "--pattern",
        installer,
        "--pattern",
        `${installer}.sig`,
        "--pattern",
        "signing-evidence.json",
      ]);
      releases.push({
        version,
        directory,
        notes: release.body ?? "",
      });
    }
  }
  if (!process.env.PREVIOUS_CHANNEL_DIRECTORY && releases.length > 0) {
    throw new Error(
      "Bootstrap the empty channel before publishing the first desktop release; an existing channel snapshot is required to preserve immutable history."
    );
  }
  await packageChannel({
    releases,
    outputDirectory: "infrastructure/update-channel/channel",
    previousDirectory: process.env.PREVIOUS_CHANNEL_DIRECTORY,
    publicKey: process.env.PR0_UPDATE_PUBLIC_KEY ?? "",
  });
} finally {
  await rm(downloads, { recursive: true, force: true });
}
