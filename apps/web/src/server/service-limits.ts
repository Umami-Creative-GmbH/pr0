import "server-only";

export const serviceLimit = (name: string, fallback: number): number => {
  const value = process.env[`PR0_LIMIT_${name}`];
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 1_000_000) {
    throw new Error(
      `PR0_LIMIT_${name} must be a positive integer at most 1000000`
    );
  }
  return number;
};
