export const register = async () => {
  // Next's compatibility runtime name also covers the required Bun server.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startChangeRetention } = await import("./server/change-retention");
    startChangeRetention();
  }
};
