import assert from "node:assert/strict";
import path from "node:path";

import { z } from "zod";

process.chdir(path.resolve(import.meta.dir, "../../.."));
const env = { ...process.env };
if (process.argv.includes("native")) {
  const build = Bun.spawn(
    [
      "cargo",
      "test",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "--lib",
      "--no-run",
      "--message-format=json",
    ],
    { stdout: "pipe", stderr: "inherit" }
  );
  const output = await new Response(build.stdout).text();
  assert.equal(await build.exited, 0);
  const artifact = z.object({
    reason: z.literal("compiler-artifact"),
    executable: z.string(),
  });
  const executable = output
    .trim()
    .split("\n")
    .map((line) => artifact.safeParse(JSON.parse(line)))
    .find((result) => result.success)?.data?.executable;
  assert.ok(executable, "Native acceptance executable was not built");
  env.PR0_SELF_HOST_NATIVE_EXE = executable;
}
const evidence = process.argv.find((arg) => arg.startsWith("--evidence="));
if (evidence) {
  env.PR0_SELF_HOST_EVIDENCE = evidence.slice("--evidence=".length);
}
const tests = Bun.spawn(
  ["bun", "test", "apps/web/tests/self-hosting.test.ts"],
  { env, stdout: "inherit", stderr: "inherit" }
);
process.exitCode = await tests.exited;
