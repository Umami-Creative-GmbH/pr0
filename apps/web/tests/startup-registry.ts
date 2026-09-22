import path from "node:path";

// Registry effects stay in this test's unique subtree; never register the test
// executable as an actual Windows login application.
export const startupRegistry = async (
  directory: string,
  action: "disable" | "unknown" | "cleanup"
) => {
  const child = Bun.spawn(
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; $taskKey='HKCU:\\Software\\pr0-startup-tests\\' + $env:PR0_STARTUP_TEST_NAME; if ($env:PR0_STARTUP_TEST_ACTION -eq 'cleanup') { if (Test-Path -LiteralPath $taskKey) { Remove-Item -LiteralPath $taskKey -Recurse -Force }; exit }; $taskApproval=$taskKey + '\\Explorer\\StartupApproved\\Run'; New-Item -Path $taskApproval -Force | Out-Null; $taskBytes=[byte[]]::new(12); $taskBytes[0]=3; if ($env:PR0_STARTUP_TEST_ACTION -eq 'unknown') { $taskBytes[0]=99 }; New-ItemProperty -LiteralPath $taskApproval -Name 'pr0-test' -PropertyType Binary -Value $taskBytes -Force | Out-Null",
    ],
    {
      env: {
        ...process.env,
        PR0_STARTUP_TEST_NAME: path.basename(directory),
        PR0_STARTUP_TEST_ACTION: action,
      },
      stdout: "ignore",
      stderr: "inherit",
    }
  );
  if ((await child.exited) !== 0) {
    throw new Error(
      "Could not prepare or clean up the isolated startup registry"
    );
  }
};
