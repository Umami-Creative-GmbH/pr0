// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Retries are deliberately sequential.
// Reports one run's exit code to the dead-man's switch: POST <check-url>/<exit-code>.
// Same protocol as infrastructure/probe-host/heartbeat.sh, for the tools image,
// which has Bun but no curl. The check URL is a secret that Coolify passes as
// PR0_BACKUP_HEARTBEAT_URL; it never appears on a command line or in the output.
// Usage: bun heartbeat.ts <exit-code>
const attempts = 3;
const timeoutMs = 10_000;
const retryDelayMs = 2000;
const exitCodePattern = /^\d+$/u;
const trailingSlashPattern = /\/+$/u;

const fail = (message: string, code: number) => {
  process.stderr.write(`heartbeat: ${message}\n`);
  process.exit(code);
};

const report = async (code: string) => {
  if (!exitCodePattern.test(code)) {
    fail("numeric exit code required", 2);
  }
  const url = process.env.PR0_BACKUP_HEARTBEAT_URL?.trim() ?? "";
  if (!url) {
    fail("PR0_BACKUP_HEARTBEAT_URL is not set", 2);
  }
  const target = `${url.replace(trailingSlashPattern, "")}/${code}`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(target, {
        method: "POST",
        body: "",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return;
      }
      process.stderr.write(
        `heartbeat: attempt ${attempt} answered HTTP ${response.status}\n`
      );
    } catch {
      process.stderr.write(`heartbeat: attempt ${attempt} failed\n`);
    }
    if (attempt < attempts) {
      await Bun.sleep(retryDelayMs);
    }
  }
  fail(`not delivered after ${attempts} attempts`, 1);
};

if (import.meta.main) {
  await report(process.argv[2] ?? "");
}
