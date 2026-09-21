import { ApiError } from "@pr0/api-client/client";

const accountFailureMessage = (error: Error) => {
  if (error instanceof ApiError) {
    if (error.code === "account_suspended") {
      return "This account is suspended. Contact your instance operator. Your retained work has not been deleted.";
    }
    if (error.code === "fresh_auth_required") {
      return "Confirm your identity again before changing account settings. This request made no changes.";
    }
    if (error.code === "last_login_method") {
      return "Keep at least one usable login method. Link another enabled provider or set a password through account recovery before removing this method.";
    }
    if (error.code === "provider_owned") {
      return "This provider belongs to another account. No methods were changed and no libraries were merged. Try a different provider account.";
    }
    if (error.code === "method_already_linked") {
      return "This account already has a login for that provider. Reload settings to review your methods.";
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

export const accountErrorMessage = (error: Error) => {
  if (error instanceof ApiError && error.code === "unavailable") {
    return `The service is temporarily unavailable. Retry in ${error.retryAfter ?? 30} seconds. Keep this tab open to retain your work.`;
  }
  return accountFailureMessage(error);
};

export const methodResultMessage = (result?: string) => {
  if (result === "linked") {
    return "Login method linked. Your account email and library are unchanged.";
  }
  if (result === "invalid") {
    return "Linking was cancelled, failed, or expired. Your login methods are unchanged. Try again when ready.";
  }
  return result ? accountErrorMessage(new ApiError(400, result)) : "";
};
