export const holdNativeResource = async (
  executable: string,
  worker: string,
  env: Record<string, string>
) => {
  const owner = Bun.spawn(
    [executable, "--exact", `auth_tests::${worker}`, "--nocapture"],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, ...env },
    }
  );
  const reader = owner.stdout.getReader();
  let output = "";
  const decoder = new TextDecoder();
  while (!output.includes("READY:")) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Await the competing process's registration acknowledgement.
    const chunk = await reader.read();
    if (chunk.done) {
      throw new Error("Shortcut owner did not start");
    }
    output += decoder.decode(chunk.value);
  }
  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    await owner.stdin.end();
    await owner.exited;
  };
};
