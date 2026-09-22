import { ApiError } from "@pr0/api-client/client";
import { translate } from "@pr0/ui/lib/i18n";

const accountFailureMessage = (error: Error) => {
  if (error instanceof ApiError) {
    if (error.code === "account_suspended") {
      return translate(
        "thisAccountIsSuspendedContactYourInstanceOperatorYourRetained"
      );
    }
    if (error.code === "fresh_auth_required") {
      return translate(
        "confirmYourIdentityAgainBeforeChangingAccountSettingsThisRequest"
      );
    }
    if (error.code === "last_login_method") {
      return translate("keepAtLeastOneUsableLoginMethodLinkAnotherEnabled");
    }
    if (error.code === "provider_owned") {
      return translate(
        "thisProviderBelongsToAnotherAccountNoMethodsWereChanged"
      );
    }
    if (error.code === "method_already_linked") {
      return translate("thisAccountAlreadyHasALoginForThatProviderReload");
    }
    if (error.code === "account_changed") {
      return translate(
        "theAccountOrEmailChangedDuringThisRequestReloadSettings"
      );
    }
    if (error.code === "invalid_challenge") {
      return translate("thisCodeIsIncorrectExpiredReplacedOrAlreadyUsedAfter");
    }
    if (error.code === "email_change_unavailable") {
      return translate("thisEmailChangeCouldNotBeCompletedYourCurrentEmail");
    }
    if (error.code === "account_not_linked") {
      return translate("thisProviderIsNotLinkedToYourExistingAccountUse");
    }
    if (error.code === "invalid_social") {
      return translate("thisSignInOrVerificationAttemptIsInvalidExpiredOr");
    }
    if (error.code === "invalid_credentials") {
      return translate("unableToSignInCheckYourEmailAndPasswordAnd");
    }
    if (error.code === "invalid_recovery") {
      return translate("thisRecoveryLinkIsInvalidExpiredOrAlreadyUsedRequest");
    }
    if (error.code === "registration_closed") {
      return translate(
        "registrationIsClosedForThisAddressAskYourInstanceOperator"
      );
    }
    if (error.code === "rate_limited") {
      return translate("tooManyAttemptsTryAgainInValueSeconds", [
        error.retryAfter ?? 60,
      ]);
    }
    if (error.code === "unauthenticated") {
      return translate("yourSessionHasEndedSignInAgainToContinue");
    }
    if (error.code === "forbidden") {
      return translate("thisRequestWasRefusedReloadThisInstanceAndTryAgain");
    }
  }
  return translate("theServiceCouldNotCompleteThisRequestPleaseTryAgain");
};

export const accountErrorMessage = (error: Error) => {
  if (error instanceof ApiError && error.code === "unavailable") {
    return translate(
      "theServiceIsTemporarilyUnavailableRetryInValueSecondsKeep",
      [error.retryAfter ?? 30]
    );
  }
  return accountFailureMessage(error);
};

export const methodResultMessage = (result?: string) => {
  if (result === "linked") {
    return translate("loginMethodLinkedYourAccountEmailAndLibraryAreUnchanged");
  }
  if (result === "invalid") {
    return translate("linkingWasCancelledFailedOrExpiredYourLoginMethodsAre");
  }
  return result ? accountErrorMessage(new ApiError(400, result)) : "";
};
