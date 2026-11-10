import { z } from "zod";

export const legalLinkKinds = ["impressum", "privacy", "terms"] as const;
export type LegalLinkKind = (typeof legalLinkKinds)[number];

const httpsProtocol = /^https$/u;

/** An operator-published HTTPS page; credentials never appear in public links. */
export const legalLinkSchema = z
  .url({ protocol: httpsProtocol, normalize: true })
  .max(2048)
  .refine((value) => {
    const url = URL.parse(value);
    return Boolean(url && !url.username && !url.password);
  }, "Legal links must not contain credentials");

/**
 * Instance-operated legal pages. Every link is optional; unconfigured links are
 * omitted so self-hosted instances never present another operator's pages.
 */
export const legalLinksSchema = z.strictObject({
  impressum: legalLinkSchema.optional(),
  privacy: legalLinkSchema.optional(),
  terms: legalLinkSchema.optional(),
});
export type LegalLinks = z.infer<typeof legalLinksSchema>;
