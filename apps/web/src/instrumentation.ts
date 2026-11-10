export const register = async () => {
  // Next's compatibility runtime name also covers the required Bun server.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Reject invalid public legal links before serving any page.
    const { legalLinks } = await import("./server/config");
    legalLinks();
    const { startChangeRetention } = await import("./server/change-retention");
    startChangeRetention();
  }
};
