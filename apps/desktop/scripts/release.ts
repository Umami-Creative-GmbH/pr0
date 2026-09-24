import { fileURLToPath } from "node:url";

// Bun loads the desktop .env before passing its environment to PowerShell.
// Signing secrets stay in the environment, never in command arguments.
const release = Bun.spawn(
  [
    "powershell.exe",
    "-NoProfile",
    "-File",
    fileURLToPath(new URL("../release.ps1", import.meta.url)),
  ],
  {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    // Windows PowerShell must discover its own modules, not inherited PS7 ones.
    env: { ...process.env, PSModulePath: undefined },
  }
);
process.exit(await release.exited);
