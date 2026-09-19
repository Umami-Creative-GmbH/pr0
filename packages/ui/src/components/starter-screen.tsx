"use client";

import { Button } from "./button";

interface StarterScreenProps {
  status: "pending" | "error" | "success";
  isFetching: boolean;
  onRetry: () => void;
}

const statusMessages = {
  pending: "Connecting…",
  error: "Could not connect. Check that the API is running and try again.",
  success: "Connected",
} as const;

export const StarterScreen = ({
  status,
  isFetching,
  onRetry,
}: StarterScreenProps) => (
  <main className="flex min-h-screen items-center justify-center p-6">
    <section className="bg-card text-card-foreground w-full max-w-md space-y-6 rounded-xl border p-8">
      <h1 className="text-2xl font-semibold tracking-tight">pr0</h1>
      <p className="text-muted-foreground">Ready to get started.</p>
      <p aria-live="polite" className="text-sm">
        {statusMessages[status]}
      </p>
      <Button disabled={isFetching} onClick={onRetry} variant="outline">
        {isFetching ? "Connecting…" : "Check connection"}
      </Button>
    </section>
  </main>
);
