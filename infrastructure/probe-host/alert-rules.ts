import { z } from "zod";

/** Consecutive failed probe or metrics minutes before an alert is sent. */
export const failedMinutesBeforeAlert = 3;

export const alertStateSchema = z.strictObject({
  /** Last evaluated UTC minute (milliseconds since the epoch / 60 000). */
  lastMinute: z.number().int().nullable(),
  lastAvailable: z.boolean(),
  /** Consecutive failed minutes immediately before the last evaluated minute. */
  failuresBeforeLast: z.number().int().nonnegative(),
  probeFailures: z.number().int().nonnegative(),
  probeAlerting: z.boolean(),
  metricsFailures: z.number().int().nonnegative(),
  metricsUnreachableAlerting: z.boolean(),
  metricsAlerts: z.array(z.string()),
});
export type AlertState = z.infer<typeof alertStateSchema>;

export const initialAlertState: AlertState = {
  lastMinute: null,
  lastAvailable: true,
  failuresBeforeLast: 0,
  probeFailures: 0,
  probeAlerting: false,
  metricsFailures: 0,
  metricsUnreachableAlerting: false,
  metricsAlerts: [],
};

export interface MinuteObservation {
  /** UTC minute index of the probe sample. */
  minute: number;
  available: boolean;
  /** Alerts reported by the private metrics route, or null when it could not be read. */
  metricsAlerts: string[] | null;
}

export interface AlertNotification {
  title: string;
  message: string;
  urgent: boolean;
}

const formatMinute = (minute: number) =>
  `${new Date(minute * 60_000).toISOString().slice(0, 16)}Z`;

const advanceProbe = (
  state: AlertState,
  { minute, available }: MinuteObservation,
  notifications: AlertNotification[]
): AlertState => {
  let { probeFailures } = state;
  let { failuresBeforeLast } = state;
  if (state.lastMinute !== null && minute <= state.lastMinute) {
    // A repeated sample for an already evaluated minute can only make that minute worse.
    if (available || !state.lastAvailable || minute < state.lastMinute) {
      return state;
    }
    probeFailures = failuresBeforeLast + 1;
  } else {
    // Minutes without a sample are unavailable, exactly as in the availability report.
    const missing =
      state.lastMinute === null ? 0 : minute - state.lastMinute - 1;
    failuresBeforeLast = probeFailures + missing;
    probeFailures = available ? 0 : failuresBeforeLast + 1;
    if (
      available &&
      !state.probeAlerting &&
      missing >= failedMinutesBeforeAlert
    ) {
      notifications.push({
        title: "pr0 probe gap",
        message: `No availability samples for ${missing} minutes before ${formatMinute(minute)}; those minutes count unavailable.`,
        urgent: false,
      });
    }
  }
  let { probeAlerting } = state;
  if (!probeAlerting && probeFailures >= failedMinutesBeforeAlert) {
    probeAlerting = true;
    notifications.push({
      title: "pr0 unavailable",
      message: `The availability probe failed for ${probeFailures} consecutive minutes (latest ${formatMinute(minute)}).`,
      urgent: true,
    });
  } else if (probeAlerting && available) {
    probeAlerting = false;
    notifications.push({
      title: "pr0 available again",
      message: `The availability probe succeeded at ${formatMinute(minute)}.`,
      urgent: false,
    });
  }
  return {
    ...state,
    lastMinute: Math.max(minute, state.lastMinute ?? minute),
    lastAvailable: available,
    failuresBeforeLast,
    probeFailures,
    probeAlerting,
  };
};

const advanceMetrics = (
  state: AlertState,
  { metricsAlerts }: MinuteObservation,
  notifications: AlertNotification[]
): AlertState => {
  if (metricsAlerts === null) {
    const metricsFailures = state.metricsFailures + 1;
    const alerting =
      state.metricsUnreachableAlerting ||
      metricsFailures >= failedMinutesBeforeAlert;
    if (alerting && !state.metricsUnreachableAlerting) {
      notifications.push({
        title: "pr0 metrics unreachable",
        message: `The private metrics route could not be read for ${metricsFailures} consecutive minutes.`,
        urgent: true,
      });
    }
    return {
      ...state,
      metricsFailures,
      metricsUnreachableAlerting: alerting,
    };
  }
  if (state.metricsUnreachableAlerting) {
    notifications.push({
      title: "pr0 metrics reachable again",
      message: "The private metrics route answered again.",
      urgent: false,
    });
  }
  const current = [...new Set(metricsAlerts)].toSorted();
  const known = new Set(state.metricsAlerts);
  const added = current.filter((name) => !known.has(name));
  if (added.length > 0) {
    notifications.push({
      title: "pr0 metrics alert",
      message: `New: ${added.join(", ")}. Active: ${current.join(", ")}.`,
      urgent: true,
    });
  } else if (current.length === 0 && state.metricsAlerts.length > 0) {
    notifications.push({
      title: "pr0 metrics alerts cleared",
      message: `Cleared: ${state.metricsAlerts.join(", ")}.`,
      urgent: false,
    });
  }
  return {
    ...state,
    metricsFailures: 0,
    metricsUnreachableAlerting: false,
    metricsAlerts: current,
  };
};

/**
 * Applies one probe minute to the alert state and returns the notifications it triggers:
 * three consecutive failed (or missing) probe minutes, three unreadable metrics polls,
 * and immediately any new alert reported by the metrics route.
 */
export const advanceAlerts = (
  state: AlertState,
  observation: MinuteObservation
) => {
  const notifications: AlertNotification[] = [];
  const probed = advanceProbe(state, observation, notifications);
  return {
    state: advanceMetrics(probed, observation, notifications),
    notifications,
  };
};
