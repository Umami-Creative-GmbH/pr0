import { legalLinkKinds, legalLinksSchema } from "@pr0/api-contract/legal";
import type { LegalLinks } from "@pr0/api-contract/legal";

export const legalLinkSettings = {
  impressum: "PR0_IMPRESSUM_URL",
  privacy: "PR0_PRIVACY_URL",
  terms: "PR0_TERMS_URL",
} as const;

/**
 * Reads the operator's optional legal pages. Empty settings stay unconfigured;
 * there are no built-in defaults, so self-hosted instances remain neutral.
 */
export const readLegalLinks = (
  environment: Record<string, string | undefined>
): LegalLinks => {
  const links: LegalLinks = {};
  for (const kind of legalLinkKinds) {
    const name = legalLinkSettings[kind];
    const value = environment[name]?.trim();
    if (!value) {
      continue;
    }
    const parsed = legalLinksSchema.shape[kind].safeParse(value);
    if (!parsed.success || parsed.data === undefined) {
      throw new Error(
        `${name} must be an absolute HTTPS URL without credentials (at most 2048 characters)`
      );
    }
    links[kind] = parsed.data;
  }
  return links;
};

export const hasLegalLinks = (links: LegalLinks) =>
  legalLinkKinds.some((kind) => links[kind] !== undefined);
