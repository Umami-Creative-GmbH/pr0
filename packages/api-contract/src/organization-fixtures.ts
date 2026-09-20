// Shared literal acceptance vectors for REST and future native command conformance.
export const organizationIdentityFixtures = [
  { name: "Straße", equivalent: "STRASSE", distinct: "Strase" },
  { name: "Café", equivalent: "CAFE\u0301", distinct: "Cafe" },
  { name: "A  B", equivalent: "a  b", distinct: "A B" },
  { name: "\u0085Work\u00A0", equivalent: "work", distinct: "\uFEFFWork" },
  { name: "İ", equivalent: "i\u0307", distinct: "i" },
  { name: "Σ", equivalent: "ς", distinct: "s" },
  { name: "꟎", equivalent: "꟏", distinct: "p" },
  { name: "\u{16EA0}", equivalent: "\u{16EBB}", distinct: "a" },
  { name: "가", equivalent: "가", distinct: "각" },
  { name: "①", equivalent: "①", distinct: "1" },
  { name: "A\uFE0F", equivalent: "a\uFE0F", distinct: "A" },
] as const;
