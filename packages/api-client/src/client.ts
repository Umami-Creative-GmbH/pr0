import {
  deleteAccountSchema,
  accountIdentitySchema,
  linkMethodSchema,
  removeMethodSchema,
  loginMethodsSchema,
  reauthenticationSchema,
  emailChangeSchema,
  challengeVerificationSchema,
  accountSettingsSchema,
  accountChallengeSchema,
  freshAuthenticationSchema,
  emailChangedSchema,
  accountErrorSchema,
  credentialsSchema,
  emailRequestSchema,
  librarySchema,
  successSchema,
  verificationRequiredSchema,
  passwordResetSchema,
  recoveryRequestedSchema,
  revokeSessionSchema,
  sessionsSchema,
  socialProvidersSchema,
  socialRedirectSchema,
  socialSignInSchema,
  socialVerificationSchema,
} from "@pr0/api-contract/accounts";
import type {
  AccountIdentity,
  LinkMethod,
  RemoveMethod,
  Reauthentication,
  EmailChange,
  ChallengeVerification,
  Credentials,
  AccountRequest,
  PasswordReset,
  SocialProvider,
} from "@pr0/api-contract/accounts";
import {
  deletionHandleSchema,
  deletionLookupSchema,
  deletionResultSchema,
  deletionTrustSchema,
  deletionVerificationSchema,
} from "@pr0/api-contract/deletions";
import {
  capabilitiesSchema,
  negotiateCapabilities,
  deviceApprovalSchema,
} from "@pr0/api-contract/device";
import {
  healthPath,
  healthResponseSchema,
  readinessResponseSchema,
} from "@pr0/api-contract/health";
import { operationalMetricsSchema } from "@pr0/api-contract/operations";
import { z } from "zod";

import { createPromptClient } from "./prompts";

const trailingSlashes = /\/+$/u;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfter?: number;

  constructor(status: number, code?: string, retryAfter?: number) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: (input: string, init: RequestInit) => Promise<Response>;
}

export const createApiClient = ({
  baseUrl = "",
  fetcher = globalThis.fetch,
}: ApiClientOptions = {}) => {
  const normalizedBaseUrl = baseUrl.replace(trailingSlashes, "");
  const accountRequest = async (
    path: string,
    body?: AccountRequest,
    signal?: AbortSignal
  ) => {
    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetcher(`${normalizedBaseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ApiError(response.status);
      }
      const error = accountErrorSchema.safeParse(payload);
      throw new ApiError(
        response.status,
        error.success ? error.data.code : undefined,
        error.success ? error.data.retryAfter : undefined
      );
    }
    return response.json();
  };

  return {
    async getCompatibility(signal?: AbortSignal) {
      const capabilities = capabilitiesSchema.parse(
        await accountRequest(
          "/api/v1/capabilities?negotiation=1",
          undefined,
          signal
        )
      );
      return { capabilities, ...negotiateCapabilities(capabilities) };
    },
    async decideDevice(
      input: z.infer<typeof deviceApprovalSchema>,
      approve: boolean,
      signal?: AbortSignal
    ) {
      return z
        .object({ success: z.literal(true) })
        .parse(
          await accountRequest(
            `/api/auth/device/${approve ? "approve" : "deny"}`,
            deviceApprovalSchema.parse(input),
            signal
          )
        );
    },
    async getDeletionVerification(signal?: AbortSignal) {
      return deletionVerificationSchema.parse(
        await accountRequest(
          "/api/v1/account-deletions/verification",
          undefined,
          signal
        )
      );
    },
    async getDeletionTrust(signal?: AbortSignal) {
      return deletionTrustSchema.parse(
        await accountRequest("/api/v1/account/deletion", undefined, signal)
      );
    },
    async deleteAccount(
      input: AccountIdentity & { confirmation: "delete-account" },
      signal?: AbortSignal
    ) {
      return deletionResultSchema.parse(
        await accountRequest(
          "/api/v1/account/deletion",
          deleteAccountSchema.parse(input),
          signal
        )
      );
    },
    async getDeletionReceipt(handle: string, signal?: AbortSignal) {
      return deletionLookupSchema.parse(
        await accountRequest(
          `/api/v1/account-deletions/${deletionHandleSchema.parse(handle)}`,
          undefined,
          signal
        )
      );
    },
    ...createPromptClient(normalizedBaseUrl, fetcher),
    baseUrl: normalizedBaseUrl,
    async getLoginMethods(signal?: AbortSignal) {
      return loginMethodsSchema.parse(
        await accountRequest("/api/v1/account/methods", undefined, signal)
      );
    },
    async linkLoginMethod(input: LinkMethod, signal?: AbortSignal) {
      return socialRedirectSchema.parse(
        await accountRequest(
          "/api/v1/account/methods/link",
          linkMethodSchema.parse(input),
          signal
        )
      );
    },
    async removeLoginMethod(input: RemoveMethod, signal?: AbortSignal) {
      return successSchema.parse(
        await accountRequest(
          "/api/v1/account/methods/remove",
          removeMethodSchema.parse(input),
          signal
        )
      );
    },
    async getAccountSettings(signal?: AbortSignal) {
      return accountSettingsSchema.parse(
        await accountRequest("/api/v1/account", undefined, signal)
      );
    },
    async requestReauthentication(
      input: AccountIdentity,
      signal?: AbortSignal
    ) {
      return accountChallengeSchema.parse(
        await accountRequest(
          "/api/v1/account/reauth/challenges",
          accountIdentitySchema.parse(input),
          signal
        )
      );
    },
    async reauthenticate(input: Reauthentication, signal?: AbortSignal) {
      return freshAuthenticationSchema.parse(
        await accountRequest(
          "/api/v1/account/reauth/verify",
          reauthenticationSchema.parse(input),
          signal
        )
      );
    },
    async requestEmailChange(input: EmailChange, signal?: AbortSignal) {
      return accountChallengeSchema.parse(
        await accountRequest(
          "/api/v1/account/email/challenges",
          emailChangeSchema.parse(input),
          signal
        )
      );
    },
    async verifyEmailChange(
      input: ChallengeVerification,
      signal?: AbortSignal
    ) {
      return emailChangedSchema.parse(
        await accountRequest(
          "/api/v1/account/email/verify",
          challengeVerificationSchema.parse(input),
          signal
        )
      );
    },
    async getSocialProviders(signal?: AbortSignal) {
      return socialProvidersSchema.parse(
        await accountRequest("/api/auth/providers", undefined, signal)
      );
    },
    async signInSocial(provider: SocialProvider, signal?: AbortSignal) {
      return socialRedirectSchema.parse(
        await accountRequest(
          "/api/auth/sign-in/social",
          socialSignInSchema.parse({ provider }),
          signal
        )
      );
    },
    async requestSocialEmail(email: string, signal?: AbortSignal) {
      return verificationRequiredSchema.parse(
        await accountRequest(
          "/api/auth/social/email",
          emailRequestSchema.parse({ email }),
          signal
        )
      );
    },
    async verifySocialEmail(token: string, signal?: AbortSignal) {
      return successSchema.parse(
        await accountRequest(
          "/api/auth/social/verify",
          socialVerificationSchema.parse({ token }),
          signal
        )
      );
    },
    async requestRecovery(email: string, signal?: AbortSignal) {
      return recoveryRequestedSchema.parse(
        await accountRequest(
          "/api/auth/request-password-reset",
          emailRequestSchema.parse({ email }),
          signal
        )
      );
    },
    async resetPassword(input: PasswordReset, signal?: AbortSignal) {
      return successSchema.parse(
        await accountRequest(
          "/api/auth/reset-password",
          passwordResetSchema.parse(input),
          signal
        )
      );
    },
    async getSessions(signal?: AbortSignal) {
      return sessionsSchema.parse(
        await accountRequest("/api/v1/sessions", undefined, signal)
      );
    },
    async revokeSession(sessionId: string, signal?: AbortSignal) {
      return successSchema.parse(
        await accountRequest(
          "/api/v1/sessions/revoke",
          revokeSessionSchema.parse({ sessionId }),
          signal
        )
      );
    },
    async revokeOtherSessions(signal?: AbortSignal) {
      return successSchema.parse(
        await accountRequest("/api/v1/sessions/revoke-others", {}, signal)
      );
    },
    async getLibrary(signal?: AbortSignal) {
      return librarySchema.parse(
        await accountRequest("/api/v1/library", undefined, signal)
      );
    },
    async register(input: Credentials, signal?: AbortSignal) {
      return verificationRequiredSchema.parse(
        await accountRequest(
          "/api/auth/sign-up/email",
          credentialsSchema.parse(input),
          signal
        )
      );
    },
    async signIn(input: Credentials, signal?: AbortSignal) {
      return successSchema.parse(
        await accountRequest(
          "/api/auth/sign-in/email",
          credentialsSchema.parse(input),
          signal
        )
      );
    },
    async resendVerification(email: string, signal?: AbortSignal) {
      return verificationRequiredSchema.parse(
        await accountRequest(
          "/api/auth/send-verification-email",
          emailRequestSchema.parse({ email }),
          signal
        )
      );
    },
    async signOut(signal?: AbortSignal) {
      return successSchema.parse(
        await accountRequest("/api/auth/sign-out", {}, signal)
      );
    },
    async getHealth(signal?: AbortSignal) {
      const response = await fetcher(`${normalizedBaseUrl}${healthPath}`, {
        headers: { Accept: "application/json" },
        signal,
      });

      if (!response.ok) {
        throw new ApiError(response.status);
      }

      return healthResponseSchema.parse(await response.json());
    },
    async getReadiness(signal?: AbortSignal) {
      const response = await fetcher(`${normalizedBaseUrl}/api/v1/ready`, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status !== 200 && response.status !== 503) {
        throw new ApiError(response.status);
      }
      const body = readinessResponseSchema.parse(await response.json());
      if ((body.status === "ready") !== response.ok) {
        throw new Error("Invalid readiness status");
      }
      return body;
    },
    async getOperationalMetrics(token: string, signal?: AbortSignal) {
      const response = await fetcher(
        `${normalizedBaseUrl}/api/v1/operations/metrics`,
        {
          signal,
          cache: "no-store",
          redirect: "error",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!response.ok) {
        throw new ApiError(response.status);
      }
      return operationalMetricsSchema.parse(await response.json());
    },
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
