import {
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
  Credentials,
  AccountRequest,
  PasswordReset,
  SocialProvider,
} from "@pr0/api-contract/accounts";
import { healthPath, healthResponseSchema } from "@pr0/api-contract/health";

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
    baseUrl: normalizedBaseUrl,
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
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
