import { z } from "zod";

export const deviceClientSchema = z.strictObject({
  client_id: z.literal("pr0-desktop"),
});
export const deviceTokenRequestSchema = deviceClientSchema.extend({
  device_code: z.string().min(1).max(191),
  grant_type: z.literal("urn:ietf:params:oauth:grant-type:device_code"),
});
export const deviceCancelSchema = deviceClientSchema.extend({
  device_code: z.string().min(1).max(191),
});
export const deviceApprovalSchema = z.strictObject({
  userCode: z.string().regex(/^[A-Z2-9]{8}$/u),
  accountId: z.uuid(),
});
export const deviceCodeSchema = z.strictObject({
  device_code: z.string().min(1).max(191),
  user_code: z.string().regex(/^[A-Z2-9]{8}$/u),
  verification_uri: z.url(),
  verification_uri_complete: z.url(),
  expires_in: z.number().int().positive().max(600),
  interval: z.number().int().positive().max(60),
});
export const deviceTokenSchema = z.strictObject({
  access_token: z.string().min(1).max(512),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().nonnegative(),
  scope: z.literal(""),
});
export const deviceFailureSchema = z.object({
  error: z.enum([
    "authorization_pending",
    "slow_down",
    "expired_token",
    "access_denied",
    "invalid_request",
    "invalid_grant",
    "server_error",
  ]),
});
export const deletionKeySchema = z.strictObject({
  kid: z.uuid(),
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});
export const capabilitiesSchema = z.strictObject({
  instanceId: z.uuid(),
  origin: z.url(),
  protocols: z.array(z.number().int().positive().max(65_535)).min(1).max(16),
  normalization: z.string().min(1).max(80),
  deviceAuthorization: z.literal(true),
  deletionKey: deletionKeySchema,
  limits: z.strictObject({
    credentialBytes: z.literal(2560),
    responseBytes: z.literal(16_384),
  }),
  compatibility: z
    .strictObject({
      supportDays: z.literal(90),
      contracts: z
        .array(
          z.strictObject({
            protocol: z.number().int().positive().max(65_535),
            normalization: z.string().min(1).max(80),
          })
        )
        .min(1)
        .max(16),
    })
    .optional(),
});

// Keep protocol 1 and its normalization together throughout the release window.
export const desktopContract = {
  protocol: 1,
  normalization: "pr0-search-v1-ucd17",
} as const;
export const compatibilityPolicy = {
  supportDays: 90,
  contracts: [desktopContract],
} as const;
export const negotiateCapabilities = (
  capabilities: z.infer<typeof capabilitiesSchema>
) => {
  const compatible = capabilities.compatibility
    ? capabilities.compatibility.contracts.some(
        (entry) =>
          entry.protocol === desktopContract.protocol &&
          entry.normalization === desktopContract.normalization
      )
    : capabilities.protocols.includes(desktopContract.protocol) &&
      capabilities.normalization === desktopContract.normalization;
  return { compatible, contract: compatible ? desktopContract : null };
};
export const desktopSessionSchema = z.strictObject({
  instance: z.strictObject({ id: z.uuid(), origin: z.url() }),
  account: z.strictObject({
    id: z.uuid(),
    email: z.email().max(254),
    verified: z.literal(true),
  }),
  session: z.strictObject({
    id: z.uuid(),
    expiresAt: z.iso.datetime(),
    provenance: z.literal("device"),
  }),
  deletionHandle: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});
