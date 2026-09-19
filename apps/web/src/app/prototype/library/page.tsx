"use client";

/**
 * PROTOTYPE ROUTE (issue #9) — throwaway. Not part of the product surface.
 *
 * Run it with `bun run dev:web` and open /prototype/library.
 * State is in memory only; reloading restores the seed library.
 */

import dynamic from "next/dynamic";

// Client-only: the prototype reads the clock and the clipboard.
const PrototypeClient = dynamic(() => import("./prototype-client"), {
  ssr: false,
});

const PrototypeLibraryPage = () => <PrototypeClient />;

export default PrototypeLibraryPage;
