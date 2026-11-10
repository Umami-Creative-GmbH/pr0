import { afterEach, expect, test } from "bun:test";
import { copyFile, rm } from "node:fs/promises";
import path from "node:path";

import { packageChannel, verifyRehearsalTarget } from "./package-channel";
import {
  commandOutput,
  removeTemporaryDirectories,
  signedRelease,
  temporaryDirectory,
} from "./test-fixtures";

afterEach(removeTemporaryDirectories);

test("an empty release history packages a channel without a live manifest", async () => {
  const outputDirectory = path.join(await temporaryDirectory(), "channel");
  await packageChannel({ releases: [], outputDirectory, publicKey: "" });
  expect(await Bun.file(path.join(outputDirectory, "live.json")).exists()).toBe(
    false
  );
});

test("packaging refuses a dirty output directory rather than including unrelated files", async () => {
  const outputDirectory = await temporaryDirectory();
  await Bun.write(
    path.join(outputDirectory, "old-secret.txt"),
    "must not enter the image"
  );
  await expect(
    packageChannel({ releases: [], outputDirectory, publicKey: "" })
  ).rejects.toThrow("Output directory must be empty");
});

test("a signed release packages only public artifacts and a usable live manifest", async () => {
  const release = await signedRelease("0.1.0");
  const outputDirectory = path.join(await temporaryDirectory(), "channel");
  await packageChannel({
    releases: [release],
    outputDirectory,
    publicKey: release.publicKey,
  });
  expect(
    await Bun.file(path.join(outputDirectory, "live.json")).json()
  ).toEqual({
    version: "0.1.0",
    notes: "A tested release",
    platforms: {
      "windows-x86_64": {
        url: "https://pr0.umami-creative.app/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe",
        signature: release.signature,
      },
    },
  });
  expect(
    await Bun.file(
      path.join(outputDirectory, "releases/0.1.0/pr0_0.1.0_x64-setup.exe")
    ).text()
  ).toBe("abc");
  expect(
    await Bun.file(
      path.join(outputDirectory, "releases/0.1.0/test.key")
    ).exists()
  ).toBe(false);
});

test("a new image retains predecessor artifacts even if the release was removed from GitHub", async () => {
  const previous = await signedRelease("0.1.0");
  const previousDirectory = path.join(await temporaryDirectory(), "previous");
  await packageChannel({
    releases: [previous],
    outputDirectory: previousDirectory,
    publicKey: previous.publicKey,
  });
  const latest = await signedRelease("0.1.2", previous.directory);
  const outputDirectory = path.join(await temporaryDirectory(), "channel");
  await packageChannel({
    releases: [latest],
    outputDirectory,
    previousDirectory,
    publicKey: previous.publicKey,
  });
  expect(
    await Bun.file(
      path.join(outputDirectory, "releases/0.1.0/pr0_0.1.0_x64-setup.exe")
    ).text()
  ).toBe("abc");
  const manifest = await Bun.file(
    path.join(outputDirectory, "live.json")
  ).json();
  expect(manifest.version).toBe("0.1.2");
});

test("a published version cannot be replaced with different artifact bytes", async () => {
  const release = await signedRelease("0.1.0");
  const previousDirectory = path.join(await temporaryDirectory(), "previous");
  await packageChannel({
    releases: [release],
    outputDirectory: previousDirectory,
    publicKey: release.publicKey,
  });
  await Bun.write(
    path.join(release.directory, "pr0_0.1.0_x64-setup.exe.sig"),
    `${release.signature}\n`
  );
  await expect(
    packageChannel({
      releases: [release],
      outputDirectory: path.join(await temporaryDirectory(), "channel"),
      previousDirectory,
      publicKey: release.publicKey,
    })
  ).rejects.toThrow("Immutable artifact changed");
});

test.each(["../0.1.0", "01.0.0", "0.1.1", "0.2.0-beta.1"])(
  "invalid or rehearsal version %s cannot become public",
  async (version) => {
    await expect(
      packageChannel({
        releases: [{ version, directory: "unused", notes: "" }],
        outputDirectory: path.join(await temporaryDirectory(), "channel"),
        publicKey: "",
      })
    ).rejects.toThrow("Invalid public version");
  }
);

test("a newly reserved rehearsal version is refused by live packaging even when validly signed", async () => {
  const release = await signedRelease("0.1.3");
  await expect(
    packageChannel({
      releases: [release],
      outputDirectory: path.join(await temporaryDirectory(), "channel"),
      publicKey: release.publicKey,
      reservations: [
        { version: "0.1.1", candidate: "0.1.0" },
        { version: "0.1.3", candidate: "0.1.2" },
      ],
    })
  ).rejects.toThrow("reserved for a rehearsal target");
});

test("a signed reserved rehearsal target passes rehearsal verification", async () => {
  const target = await signedRelease("0.1.1");
  expect(
    await verifyRehearsalTarget({
      directory: target.directory,
      publicKey: target.publicKey,
      version: "0.1.1",
    })
  ).toEqual({
    installer: "pr0_0.1.1_x64-setup.exe",
    signature: target.signature,
  });
});

test("the rehearsal path refuses a signed version that is not reserved", async () => {
  const release = await signedRelease("0.1.0");
  await expect(
    verifyRehearsalTarget({
      directory: release.directory,
      publicKey: release.publicKey,
      version: "0.1.0",
    })
  ).rejects.toThrow("Not a reserved rehearsal version");
});

test.each(["hash", "signed version"])(
  "rehearsal verification refuses %s failures",
  async (failure) => {
    const target = await signedRelease(
      "0.1.1",
      undefined,
      failure === "signed version" ? "0.1.0" : "0.1.1"
    );
    if (failure === "hash") {
      await Bun.write(
        path.join(target.directory, "pr0_0.1.1_x64-setup.exe"),
        "tampered bytes"
      );
    }
    await expect(
      verifyRehearsalTarget({
        directory: target.directory,
        publicKey: target.publicKey,
        version: "0.1.1",
      })
    ).rejects.toThrow();
  }
);

test("the highest version stays live regardless of GitHub response order", async () => {
  const latest = await signedRelease("0.10.0");
  const older = await signedRelease("0.9.0", latest.directory);
  const outputDirectory = path.join(await temporaryDirectory(), "channel");
  await packageChannel({
    releases: [latest, older],
    outputDirectory,
    publicKey: latest.publicKey,
  });
  const manifest = await Bun.file(
    path.join(outputDirectory, "live.json")
  ).json();
  expect(manifest.version).toBe("0.10.0");
});

test.each(["hash", "missing signature", "invalid signature", "signed version"])(
  "release verification refuses %s failures",
  async (failure) => {
    const release = await signedRelease(
      "0.2.0",
      undefined,
      failure === "signed version" ? "0.1.0" : "0.2.0"
    );
    const installerPath = path.join(
      release.directory,
      "pr0_0.2.0_x64-setup.exe"
    );
    if (failure === "hash") {
      await Bun.write(installerPath, "tampered bytes");
    } else if (failure === "missing signature") {
      await rm(`${installerPath}.sig`);
    } else if (failure === "invalid signature") {
      await Bun.write(
        `${installerPath}.sig`,
        Buffer.from("not a signature").toString("base64")
      );
    }
    const outputDirectory = path.join(await temporaryDirectory(), "channel");
    await expect(
      packageChannel({
        releases: [release],
        outputDirectory,
        publicKey: release.publicKey,
      })
    ).rejects.toThrow();
    expect(
      await Bun.file(path.join(outputDirectory, "live.json")).exists()
    ).toBe(false);
  }
);

test("removing a GitHub release cannot silently downgrade the live manifest", async () => {
  const latest = await signedRelease("0.2.0");
  const previousDirectory = path.join(await temporaryDirectory(), "previous");
  await packageChannel({
    releases: [latest],
    outputDirectory: previousDirectory,
    publicKey: latest.publicKey,
  });
  const older = await signedRelease("0.1.0", latest.directory);
  await expect(
    packageChannel({
      releases: [older],
      outputDirectory: path.join(await temporaryDirectory(), "channel"),
      previousDirectory,
      publicKey: latest.publicKey,
    })
  ).rejects.toThrow("Live manifest would downgrade");
});

test("the image serves its packaged manifest and installer without a storage mount", async () => {
  const release = await signedRelease("0.1.0");
  const context = await temporaryDirectory();
  await Promise.all(
    ["Dockerfile", "nginx.conf", ".dockerignore"].map((filename) =>
      copyFile(
        path.join(import.meta.dir, filename),
        path.join(context, filename)
      )
    )
  );
  await packageChannel({
    releases: [release],
    outputDirectory: path.join(context, "channel"),
    publicKey: release.publicKey,
  });
  const name = `pr0-channel-test-${crypto.randomUUID()}`;
  try {
    await commandOutput(["docker", "build", "-t", name, context]);
    await commandOutput([
      "docker",
      "run",
      "-d",
      "--name",
      name,
      "-p",
      "127.0.0.1::8080",
      name,
    ]);
    await commandOutput([
      "docker",
      "exec",
      name,
      "wget",
      "-q",
      "-O",
      "/dev/null",
      "http://127.0.0.1:8080/healthz",
    ]);
    const address = await commandOutput(["docker", "port", name, "8080/tcp"]);
    const response = await fetch(`http://${address}/update/`, {
      redirect: "manual",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    const manifest = await response.json();
    expect(manifest.version).toBe("0.1.0");
    const installer = await fetch(
      `http://${address}/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe`
    );
    expect(await installer.text()).toBe("abc");
    const privatePath = await fetch(`http://${address}/live.json`);
    expect(privatePath.status).toBe(404);
  } finally {
    await commandOutput(["docker", "rm", "-f", name]);
    await commandOutput(["docker", "image", "rm", name]);
  }
}, 120_000);
