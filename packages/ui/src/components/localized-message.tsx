"use client";

import { useLocale } from "../hooks/use-translations";
import { localizeMessage } from "../lib/message-localization";

/** Retained feedback changes language without replaying its operation. */
export const LocalizedMessage = ({
  value,
}: {
  value: string | null | undefined;
}) => localizeMessage(value, useLocale());
