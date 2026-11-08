import assert from "node:assert/strict";

export const capacityP95 = (samples: readonly number[]) => {
  assert.ok(samples.length > 0 && samples.every(Number.isFinite));
  const ordered = [...samples];
  ordered.sort((a, b) => a - b);
  const value = ordered[Math.ceil(ordered.length * 0.95) - 1];
  assert.ok(value !== undefined);
  return value;
};
