import { z } from "zod";

import data from "./unicode17-data.json";

const combining: Readonly<Record<number, number>> = data.combining;
const decompositions: Readonly<Record<number, readonly number[]>> =
  data.decomposition;
const compositions: Readonly<Record<string, number>> = data.composition;
const folds: Readonly<Record<number, readonly number[]>> = data.casefold;
const whitespace = new Set(data.whitespace);
const marks = new Set(data.marks);
// oxlint-disable-next-line eslint/no-control-regex -- Reject malformed scalar text and NUL before persistence.
const invalidScalar = /[\uD800-\uDFFF\u0000]/u;
const points = (value: string) =>
  [...value].map((char) => char.codePointAt(0) ?? 0);
export const trimOrganizationName = (value: string) => {
  const chars = points(value);
  let start = 0;
  let end = chars.length;
  while (start < end && whitespace.has(chars[start] ?? 0)) {
    start += 1;
  }
  while (end > start && whitespace.has(chars[end - 1] ?? 0)) {
    end -= 1;
  }
  return chars
    .slice(start, end)
    .map((cp) => String.fromCodePoint(cp))
    .join("");
};
export const organizationNameSchema = z
  .string()
  .refine(
    (value) => !invalidScalar.test(value),
    "Use valid Unicode text without NUL characters."
  )
  .refine(
    (value) => [...trimOrganizationName(value)].length > 0,
    "Enter a collection name."
  )
  .refine(
    (value) => [...trimOrganizationName(value)].length <= 60,
    "Name must be at most 60 Unicode code points."
  );
const decompose = (cp: number): readonly number[] => {
  const hangul = cp - 0xac_00;
  if (hangul >= 0 && hangul < 11_172) {
    const tail = hangul % 28;
    return [
      0x11_00 + Math.floor(hangul / 588),
      0x11_61 + Math.floor((hangul % 588) / 28),
      ...(tail ? [0x11_a7 + tail] : []),
    ];
  }
  return decompositions[cp]?.flatMap(decompose) ?? [cp];
};
const nfd = (input: readonly number[]) => {
  const result: number[] = [];
  for (const cp of input.flatMap(decompose)) {
    const cls = combining[cp] ?? 0;
    let index = result.length;
    if (cls > 0) {
      while (index > 0 && (combining[result[index - 1] ?? 0] ?? 0) > cls) {
        index -= 1;
      }
    }
    result.splice(index, 0, cp);
  }
  return result;
};
const composePair = (a: number, b: number) => {
  if (a >= 0x11_00 && a < 0x11_13 && b >= 0x11_61 && b < 0x11_76) {
    return 0xac_00 + (a - 0x11_00) * 588 + (b - 0x11_61) * 28;
  }
  if (
    a >= 0xac_00 &&
    a < 0xd7_a4 &&
    (a - 0xac_00) % 28 === 0 &&
    b > 0x11_a7 &&
    b < 0x11_c3
  ) {
    return a + b - 0x11_a7;
  }
  return compositions[`${a},${b}`];
};
const nfc = (input: readonly number[]) => {
  const result: number[] = [];
  let starter = 0;
  let previousClass = 0;
  for (const cp of nfd(input)) {
    const cls = combining[cp] ?? 0;
    const composed = result.length
      ? composePair(result[starter] ?? 0, cp)
      : undefined;
    if (
      composed !== undefined &&
      (previousClass === 0 || previousClass < cls)
    ) {
      result[starter] = composed;
    } else {
      if (!cls) {
        starter = result.length;
      }
      result.push(cp);
      previousClass = cls;
    }
  }
  return result;
};
const fold = (input: readonly number[]) =>
  input.flatMap((cp) => folds[cp] ?? [cp]);
const text = (input: readonly number[]) =>
  input.map((cp) => String.fromCodePoint(cp)).join("");
export const organizationIdentity = (value: string) =>
  text(nfc(fold(nfc(points(trimOrganizationName(value))))));
export const organizationSearch = (value: string) =>
  text(
    nfd(fold(nfd(points(value)))).flatMap((cp) =>
      marks.has(cp) ? [] : [whitespace.has(cp) ? 32 : cp]
    )
  )
    .replaceAll(/ +/gu, " ")
    .replaceAll(/^ +| +$/gu, "");
export const compareOrganizationNames = (
  a: { name: string; id: string },
  b: { name: string; id: string }
) => {
  const left = points(organizationSearch(a.name));
  const right = points(organizationSearch(b.name));
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta) {
      return delta;
    }
  }
  return left.length - right.length || (a.id < b.id ? -1 : Number(a.id > b.id));
};
