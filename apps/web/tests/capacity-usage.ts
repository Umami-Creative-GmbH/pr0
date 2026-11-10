interface CapacityUsageSample {
  account: number;
  number: number;
  status: number;
  error: string | null;
}

// Twenty accounts take turns; every fifth turn records usage.
export const isCapacityUsageSample = (number: number): boolean =>
  Math.floor(number / 20) % 5 === 0;

export const acknowledgedCapacityUses = (
  samples: readonly CapacityUsageSample[],
  account: number
): number =>
  samples.filter(
    (sample) =>
      sample.account === account &&
      sample.status === 200 &&
      !sample.error &&
      isCapacityUsageSample(sample.number)
  ).length;
