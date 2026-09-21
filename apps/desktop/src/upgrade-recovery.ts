export const compatibilityRecovery =
  "Sync paused because this desktop and server have no compatible protocol and search normalization. Update pr0, or ask your self-hosted server operator to update, then retry sync. Local browsing and pending changes are preserved.";
const recoveryMessages = new Map([
  ["compatibility_update_required", compatibilityRecovery],
  [
    "local_update_required",
    "This library was opened by a newer pr0. Install that version or newer. Do not delete or downgrade the library; local work is preserved.",
  ],
  [
    "migration_space_required",
    "Not enough free space to upgrade safely. Free disk space and restart pr0 to retry. Your library and pending changes are preserved.",
  ],
  [
    "migration_space_unknown",
    "Storage space could not be checked. Check access to this Windows user's data folder and restart pr0. Your local work is preserved.",
  ],
  [
    "migration_backup_failed",
    "The safety backup could not be completed. Check disk space and folder permissions, then restart pr0. The original library and pending changes are preserved.",
  ],
]);
export const upgradeRecoveryMessage = (code: string) =>
  recoveryMessages.get(code);
