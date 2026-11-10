// Shared fixtures for the update-channel tests: disposable directories,
// disposable Minisign keys and signed release directories.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { releaseFiles } from "./release-versions";

const temporaryDirectories: string[] = [];

export const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-channel-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

export const removeTemporaryDirectories = async (): Promise<void> => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
};

const minisign = (...args: string[]) => {
  const result = Bun.spawnSync([
    process.env.MINISIGN_PATH ?? "minisign",
    ...args,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
};

export const commandOutput = async (command: string[]): Promise<string> => {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [output, error, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(error);
  }
  return output.trim();
};

/**
 * A release directory as the desktop build leaves it: installer, base64
 * updater signature and signing evidence. Pass keyDirectory to sign with the
 * key of an earlier fixture.
 */
export const signedRelease = async (
  version: string,
  keyDirectory?: string,
  signedVersion = version
) => {
  const directory = await temporaryDirectory();
  const [installer, , evidenceFile] = releaseFiles(version);
  const installerPath = path.join(directory, installer);
  const publicPath = path.join(keyDirectory ?? directory, "test.pub");
  const privatePath = path.join(keyDirectory ?? directory, "test.key");
  const rawSignaturePath = path.join(directory, "test.minisig");
  await Bun.write(installerPath, "abc");
  if (!keyDirectory) {
    minisign("-G", "-W", "-p", publicPath, "-s", privatePath);
  }
  minisign(
    "-Sm",
    installerPath,
    "-s",
    privatePath,
    "-x",
    rawSignaturePath,
    "-t",
    `timestamp:0\tversion:${signedVersion}`
  );
  const signature = Buffer.from(
    await Bun.file(rawSignaturePath).text()
  ).toString("base64");
  await Bun.write(`${installerPath}.sig`, signature);
  await Bun.write(
    path.join(directory, evidenceFile),
    JSON.stringify({
      version,
      installer,
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    })
  );
  return {
    directory,
    notes: "A tested release",
    version,
    publicKey: Buffer.from(await Bun.file(publicPath).text()).toString(
      "base64"
    ),
    signature,
  };
};
