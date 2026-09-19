import { ApiError } from "@pr0/api-client/client";

export const accountErrorMessage = (error: Error) => {
  if (error instanceof ApiError) {
    if (error.code === "invalid_credentials") {
      return "Unable to sign in. Check your email and password, and verify your email first.";
    }
    if (error.code === "invalid_recovery") {
      return "This recovery link is invalid, expired, or already used. Request another recovery email.";
    }
    if (error.code === "registration_closed") {
      return "Registration is closed for this address. Ask your instance operator for access.";
    }
    if (error.code === "rate_limited") {
      return `Too many attempts. Try again in ${error.retryAfter ?? 60} seconds.`;
    }
    if (error.code === "unauthenticated") {
      return "Your session has ended. Sign in again to continue.";
    }
    if (error.code === "forbidden") {
      return "This request was refused. Reload this instance and try again.";
    }
  }
  return "The service could not complete this request. Please try again.";
};
