import { expect, test } from "bun:test";

import { advanceAlerts, initialAlertState } from "./alert-rules";
import type {
  AlertNotification,
  AlertState,
  MinuteObservation,
} from "./alert-rules";

const firstMinute = Date.parse("2026-11-12T08:00:00.000Z") / 60_000;

const run = (
  observations: Partial<MinuteObservation>[],
  state: AlertState = initialAlertState
) => {
  const sent: AlertNotification[][] = [];
  let current = state;
  for (const [index, observation] of observations.entries()) {
    const result = advanceAlerts(current, {
      minute: firstMinute + index,
      available: true,
      metricsAlerts: [],
      ...observation,
    });
    current = result.state;
    sent.push(result.notifications);
  }
  return {
    state: current,
    sent,
    titles: sent.map((n) => n.map((x) => x.title)),
  };
};

test("three consecutive failed probe minutes alert once and recovery is announced", () => {
  const { titles } = run([
    { available: false },
    { available: false },
    { available: false },
    { available: false },
    { available: true },
  ]);
  expect(titles).toEqual([
    [],
    [],
    ["pr0 unavailable"],
    [],
    ["pr0 available again"],
  ]);
});

test("two failed minutes separated by a success never alert", () => {
  const { titles } = run([
    { available: false },
    { available: false },
    {},
    { available: false },
    { available: false },
  ]);
  expect(titles.flat()).toEqual([]);
});

test("missing minutes before a failure count as failed minutes", () => {
  const first = advanceAlerts(initialAlertState, {
    minute: firstMinute,
    available: true,
    metricsAlerts: [],
  });
  const afterGap = advanceAlerts(first.state, {
    minute: firstMinute + 3,
    available: false,
    metricsAlerts: [],
  });
  expect(afterGap.notifications.map((n) => n.title)).toEqual([
    "pr0 unavailable",
  ]);
  expect(afterGap.notifications[0]?.urgent).toBe(true);
});

test("a long gap followed by success is reported without an outage alert", () => {
  const first = advanceAlerts(initialAlertState, {
    minute: firstMinute,
    available: true,
    metricsAlerts: [],
  });
  const afterGap = advanceAlerts(first.state, {
    minute: firstMinute + 10,
    available: true,
    metricsAlerts: [],
  });
  expect(afterGap.notifications).toEqual([
    expect.objectContaining({ title: "pr0 probe gap", urgent: false }),
  ]);
});

test("a failed duplicate sample for an available minute counts that minute failed", () => {
  const { state } = run([{ available: false }, { available: false }, {}]);
  const duplicate = advanceAlerts(state, {
    minute: firstMinute + 2,
    available: false,
    metricsAlerts: [],
  });
  expect(duplicate.notifications.map((n) => n.title)).toEqual([
    "pr0 unavailable",
  ]);
  const repeated = advanceAlerts(duplicate.state, {
    minute: firstMinute + 2,
    available: true,
    metricsAlerts: [],
  });
  expect(repeated.notifications).toEqual([]);
  expect(repeated.state.probeFailures).toBe(3);
});

test("any metrics alert is sent immediately and only new alerts are sent again", () => {
  const { titles, sent } = run([
    { metricsAlerts: ["backup_unavailable"] },
    { metricsAlerts: ["backup_unavailable"] },
    { metricsAlerts: ["backup_unavailable", "storage_expand:backup"] },
    { metricsAlerts: [] },
  ]);
  expect(titles).toEqual([
    ["pr0 metrics alert"],
    [],
    ["pr0 metrics alert"],
    ["pr0 metrics alerts cleared"],
  ]);
  expect(sent[2]?.[0]?.message).toBe(
    "New: storage_expand:backup. Active: backup_unavailable, storage_expand:backup."
  );
});

test("an unreadable metrics route alerts after three consecutive minutes and keeps known alerts", () => {
  const { titles, state } = run([
    { metricsAlerts: ["backup_unavailable"] },
    { metricsAlerts: null },
    { metricsAlerts: null },
    { metricsAlerts: null },
    { metricsAlerts: null },
    { metricsAlerts: ["backup_unavailable"] },
  ]);
  expect(titles).toEqual([
    ["pr0 metrics alert"],
    [],
    [],
    ["pr0 metrics unreachable"],
    [],
    ["pr0 metrics reachable again"],
  ]);
  expect(state.metricsAlerts).toEqual(["backup_unavailable"]);
});
