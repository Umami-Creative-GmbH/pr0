let writing = false;
const busyError = () =>
  new Error("Copying is already in progress. Try again after it finishes.");

export const writeClipboard = async (
  prepare: () => string | Promise<string>
) => {
  if (writing) {
    throw busyError();
  }
  writing = true;
  const payload = Promise.withResolvers<Blob>();
  const finished = Promise.withResolvers<undefined>();
  let preparationError: Error | undefined;
  const rejectPayload = (error: Error) => {
    preparationError = error;
    payload.reject(error);
  };
  const supply = async () => {
    try {
      const text = await prepare();
      payload.resolve(new Blob([text], { type: "text/plain" }));
      // The lock covers the OS write, not just preparing its content.
      await finished.promise;
    } catch (error) {
      rejectPayload(
        error instanceof Error
          ? error
          : new Error("Could not prepare clipboard content.")
      );
    }
  };
  const reserve = async () => {
    try {
      if (!navigator.locks) {
        await supply();
        return;
      }
      await navigator.locks.request(
        "pr0:clipboard",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            rejectPayload(busyError());
            return;
          }
          await supply();
        }
      );
    } catch (error) {
      rejectPayload(
        error instanceof Error
          ? error
          : new Error("Could not reserve the clipboard.")
      );
    }
  };
  const reservation = reserve();
  try {
    // Invoke from the original gesture (including Safari). No clipboard bytes
    // become available until exclusive admission and eligibility checks pass.
    await navigator.clipboard.write([
      new ClipboardItem({ "text/plain": payload.promise }),
    ]);
  } catch (error) {
    throw preparationError instanceof Error ? preparationError : error;
  } finally {
    finished.resolve();
    await reservation;
    writing = false;
  }
};
