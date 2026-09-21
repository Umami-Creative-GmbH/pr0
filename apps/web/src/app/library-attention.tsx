"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

interface Attention {
  message: string;
  target: string;
  unsaved: boolean;
}
const AttentionContext = createContext<{
  entries: Record<string, Attention>;
  report: (id: string, value: Attention | null) => void;
}>({
  entries: {},
  report: () => {
    throw new Error("LibraryAttentionProvider is required");
  },
});

export const LibraryAttentionProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [entries, setEntries] = useState<Record<string, Attention>>({});
  const report = useCallback((id: string, value: Attention | null) => {
    setEntries((prior) => {
      if (
        value &&
        prior[id]?.message === value.message &&
        prior[id]?.target === value.target &&
        prior[id]?.unsaved === value.unsaved
      ) {
        return prior;
      }
      if (!value && !prior[id]) {
        return prior;
      }
      if (value) {
        return { ...prior, [id]: value };
      }
      return Object.fromEntries(
        Object.entries(prior).filter(([key]) => key !== id)
      );
    });
  }, []);
  const value = useMemo(() => ({ entries, report }), [entries, report]);
  return <AttentionContext value={value}>{children}</AttentionContext>;
};
export const useLibraryAttention = () => useContext(AttentionContext).entries;
export const useReportAttention = (
  message: string,
  target: string,
  unsaved = true
) => {
  const { report } = useContext(AttentionContext);
  const id = useId();
  useEffect(() => {
    report(id, message ? { message, target, unsaved } : null);
    return () => report(id, null);
  }, [id, message, target, report, unsaved]);
};
