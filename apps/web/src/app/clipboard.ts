let writing = false;

const busyError = () =>
  new Error("Copying is already in progress. Try again after it finishes.");

// Every production web clipboard action shares this boundary. Web Locks also
// coordinates same-origin tabs; ifAvailable explicitly forbids queued writes.
export const writeClipboard = async (
  prepare: () => string | Promise<string>
) => {
  if (writing) {
    throw busyError();
  }
  writing = true;
  const write = async () => {
    const text = await prepare();
    await navigator.clipboard.writeText(text);
  };
  try {
    if (navigator.locks) {
      await navigator.locks.request(
        "pr0:clipboard",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            throw busyError();
          }
          await write();
        }
      );
      return;
    }
    await write();
  } finally {
    writing = false;
  }
};
