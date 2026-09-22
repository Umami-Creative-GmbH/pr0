import { translate } from "@pr0/ui/lib/i18n";

export const compatibilityRecovery = translate(
  "syncPausedBecauseThisDesktopAndServerHaveNoCompatible"
);
const recoveryMessages = new Map([
  ["compatibility_update_required", compatibilityRecovery],
  [
    "local_update_required",
    translate("thisLibraryWasOpenedByANewerPr0InstallThat"),
  ],
  [
    "migration_space_required",
    translate("notEnoughFreeSpaceToUpgradeSafelyFreeDiskSpace"),
  ],
  [
    "migration_space_unknown",
    translate("storageSpaceCouldNotBeCheckedCheckAccessToThis"),
  ],
  [
    "migration_backup_failed",
    translate("theSafetyBackupCouldNotBeCompletedCheckDiskSpace"),
  ],
]);
export const upgradeRecoveryMessage = (code: string) =>
  recoveryMessages.get(code);
