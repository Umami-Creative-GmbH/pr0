import { ApiError } from "@pr0/api-client/client";

export const accountErrorMessage = (error: Error) => {
  if (error instanceof ApiError) {
    if (error.code === "fresh_auth_required") {
      return "Confirm your identity again before changing your email. Your account email has not changed.";
    }
    if (error.code === "account_changed") {
      return "The account or email changed during this request. Reload settings and start again for the current account.";
    }
    if (error.code === "invalid_challenge") {
      return "This code is incorrect, expired, replaced, or already used. After three wrong attempts, request another code. Your account email has not changed.";
    }
    if (error.code === "email_change_unavailable") {
      return "This email change could not be completed. Your current email remains active. Request a new code for another address.";
    }
    if (error.code === "account_not_linked") {
      return "This provider is not linked to your existing account. Use your original sign-in method or recover access with your verified email below.";
    }
    if (error.code === "invalid_social") {
      return "This sign-in or verification attempt is invalid, expired, or already used. Return to sign in and try again in the same browser.";
    }
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
