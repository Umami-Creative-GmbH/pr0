"use client";
import { useTranslations } from "../hooks/use-translations";
import { Button } from "./button";

interface StarterScreenProps {
  status: "pending" | "error" | "success";
  isFetching: boolean;
  onRetry: () => void;
}

const statusMessages = {
  pending: "connecting" as const,
  error: "couldNotConnectCheckThatTheApiIsRunningAnd" as const,
  success: "connected" as const,
} as const;

export const StarterScreen = ({
  status,
  isFetching,
  onRetry,
}: StarterScreenProps) => {
  const t = useTranslations();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="bg-card text-card-foreground w-full max-w-md space-y-6 rounded-xl border p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("pr0")}</h1>
        <p className="text-muted-foreground">{t("readyToGetStarted")}</p>
        <p aria-live="polite" className="text-sm">
          {t(statusMessages[status])}
        </p>
        <Button disabled={isFetching} onClick={onRetry} variant="outline">
          {isFetching ? t("connecting") : t("checkConnection")}
        </Button>
      </section>
    </main>
  );
};
