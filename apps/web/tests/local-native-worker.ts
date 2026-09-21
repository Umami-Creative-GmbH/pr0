// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Native commands and stdout lines form a sequential protocol.
import { z } from "zod";

export const nativeArgsSchema = z.record(z.string(), z.json());
export type NativeArgs = z.infer<typeof nativeArgsSchema>;

export const localNativeWorker = async (
  directory: string,
  uploadFixture = false,
  recoveryFixture = false
) => {
  const artifacts = [
    ...new Bun.Glob("pr0_desktop_lib-*.exe").scanSync(
      "apps/desktop/src-tauri/target/debug/deps"
    ),
  ];
  const builds = await Promise.all(
    artifacts.map(async (name) => {
      const file = await Bun.file(
        `apps/desktop/src-tauri/target/debug/deps/${name}`
      ).stat();
      return { name, modified: file.mtimeMs };
    })
  );
  let latest: { name: string; modified: number } | undefined;
  for (const build of builds) {
    if (!latest || build.modified > latest.modified) {
      latest = build;
    }
  }
  const artifact = latest?.name;
  if (!artifact) {
    throw new Error(
      "Build the native tests with cargo test --lib --no-run first."
    );
  }
  const child = Bun.spawn(
    [
      `apps/desktop/src-tauri/target/debug/deps/${artifact}`,
      "--exact",
      "auth_tests::offline_command_worker",
      "--nocapture",
    ],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env: {
        ...process.env,
        PR0_LOCAL_TEST_DIRECTORY: directory,
        PR0_UPLOAD_UI_FIXTURE: String(uploadFixture),
        PR0_RECOVERY_UI_FIXTURE: String(recoveryFixture),
      },
    }
  );
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const line = async () => {
    while (!buffer.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("Native test worker ended unexpectedly");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    const end = buffer.indexOf("\n");
    const result = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    return result;
  };
  let preamble = await line();
  while (!preamble.startsWith("READY:")) {
    preamble = await line();
  }
  let chain = Promise.resolve();
  return {
    async command(command: string, args: NativeArgs = {}) {
      const previous = chain;
      const next = Promise.withResolvers<undefined>();
      chain = next.promise;
      await previous;
      try {
        child.stdin.write(`${JSON.stringify({ command, ...args })}\n`);
        await child.stdin.flush();
        let output = await line();
        while (!output.startsWith("RESULT:")) {
          output = await line();
        }
        const parsed = z
          .union([z.object({ Ok: z.json() }), z.object({ Err: z.string() })])
          .parse(JSON.parse(output.slice(7)));
        if ("Err" in parsed) {
          throw new Error(parsed.Err);
        }
        return parsed.Ok;
      } finally {
        next.resolve();
      }
    },
    async stop() {
      child.stdin.write('{"command":"quit"}\n');
      await child.stdin.end();
      const code = await child.exited;
      if (code !== 0) {
        throw new Error(`Native worker exit ${code}`);
      }
    },
  };
};
