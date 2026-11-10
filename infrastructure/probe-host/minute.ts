import { appendFileSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { createApiClient } from "@pr0/api-client/client";
import { createTransport } from "nodemailer";
import { z } from "zod";

import {
  advanceAlerts,
  alertStateSchema,
  initialAlertState,
} from "./alert-rules";
import type { AlertNotification } from "./alert-rules";

const minuteMs = 60_000;
/** The probe bounds itself to 15 s; this only stops a hung process. */
const probeTimeoutMs = 25_000;
const requestTimeoutMs = 15_000;
const deliveryTimeoutMs = 10_000;
/** Leave the rest of the minute for the heartbeat; the next run retries undelivered alerts. */
const deliveryDeadlineMs = 45_000;
const runStarted = Date.now();
const maximumOutbox = 50;
const availabilityScript = path.resolve(
  import.meta.dir,
  "../../apps/web/scripts/availability.ts"
);

const sampleSchema = z.strictObject({
  at: z.iso.datetime(),
  available: z.boolean(),
  durationMs: z.number().nonnegative(),
});
const channelSchema = z.enum(["ntfy", "email"]);
type Channel = z.infer<typeof channelSchema>;
const pendingSchema = z.strictObject({
  title: z.string(),
  message: z.string(),
  urgent: z.boolean(),
  channels: z.array(channelSchema),
});
type Pending = z.infer<typeof pendingSchema>;
const storedSchema = z.strictObject({
  alerts: alertStateSchema,
  outbox: z.array(pendingSchema),
});

const setting = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

/** Secrets are read from protected files named by the environment, never from argv or values. */
const secret = (name: string) => {
  const value = readFileSync(setting(name), "utf-8").trim();
  if (!value) {
    throw new Error(`${name} names an empty file`);
  }
  return value;
};

const optionalSecret = (name: string) =>
  process.env[name]?.trim() ? secret(name) : null;

const config = () => ({
  origin: new URL(setting("PR0_PROBE_ORIGIN")).origin,
  evidenceDirectory: setting("PR0_PROBE_EVIDENCE_DIRECTORY"),
  stateFile: setting("PR0_PROBE_STATE_FILE"),
  metricsSecret: secret("PR0_PROBE_METRICS_SECRET_FILE"),
  ntfyUrl: secret("PR0_ALERT_NTFY_URL_FILE"),
  ntfyToken: optionalSecret("PR0_ALERT_NTFY_TOKEN_FILE"),
  smtpUrl: secret("PR0_ALERT_SMTP_URL_FILE"),
  emailFrom: setting("PR0_ALERT_EMAIL_FROM"),
  emailTo: setting("PR0_ALERT_EMAIL_TO"),
  heartbeatUrl: secret("PR0_ALERT_HEARTBEAT_URL_FILE"),
});
type Config = ReturnType<typeof config>;

/** Runs the repository's availability probe; a probe that cannot report is recorded as a failed sample. */
const probe = async (evidenceFile: string) => {
  const started = Date.now();
  const child = Bun.spawn(
    [process.execPath, availabilityScript, "probe", evidenceFile],
    {
      env: process.env,
      stdout: "pipe",
      stderr: "ignore",
      timeout: probeTimeoutMs,
      killSignal: "SIGKILL",
    }
  );
  const output = await new Response(child.stdout).text();
  await child.exited;
  const reported = sampleSchema.safeParse(
    (() => {
      try {
        return JSON.parse(output.trim().split("\n").at(-1) ?? "");
      } catch {
        return null;
      }
    })()
  );
  if (reported.success) {
    return reported.data;
  }
  const failed = {
    at: new Date(started).toISOString(),
    available: false,
    durationMs: Date.now() - started,
  };
  appendFileSync(evidenceFile, `${JSON.stringify(failed)}\n`, { mode: 0o600 });
  return failed;
};

const metricsAlerts = async ({ origin, metricsSecret }: Config) => {
  try {
    const signal = AbortSignal.timeout(requestTimeoutMs);
    const metrics = await createApiClient({
      baseUrl: origin,
    }).getOperationalMetrics(metricsSecret, signal);
    return metrics.alerts;
  } catch {
    /* Unreachable, unauthorized or invalid metrics count as one failed poll; never log the cause. */
    return null;
  }
};

const loadState = async (stateFile: string) => {
  try {
    return storedSchema.parse(await Bun.file(stateFile).json());
  } catch {
    return { alerts: initialAlertState, outbox: [] };
  }
};

const saveState = async (
  stateFile: string,
  state: z.infer<typeof storedSchema>
) => {
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, stateFile);
};

const sendNtfy = async (
  { ntfyUrl, ntfyToken }: Config,
  notification: AlertNotification
) => {
  const headers = new Headers({
    Title: notification.title,
    Priority: notification.urgent ? "urgent" : "default",
    Tags: notification.urgent ? "rotating_light" : "white_check_mark",
  });
  if (ntfyToken) {
    headers.set("Authorization", `Bearer ${ntfyToken}`);
  }
  const response = await fetch(ntfyUrl, {
    method: "POST",
    body: notification.message,
    redirect: "error",
    signal: AbortSignal.timeout(deliveryTimeoutMs),
    headers,
  });
  if (!response.ok) {
    throw new Error("ntfy rejected the notification");
  }
};

const deliver = async (configuration: Config, outbox: Pending[]) => {
  const mail = createTransport(configuration.smtpUrl, {
    connectionTimeout: deliveryTimeoutMs,
    greetingTimeout: deliveryTimeoutMs,
    socketTimeout: deliveryTimeoutMs,
  });
  const send: Record<Channel, (n: AlertNotification) => Promise<void>> = {
    ntfy: (notification) => sendNtfy(configuration, notification),
    email: async (notification) => {
      await mail.sendMail({
        from: configuration.emailFrom,
        to: configuration.emailTo,
        subject: notification.title,
        text: notification.message,
      });
    },
  };
  const remaining: Pending[] = [];
  let delivered = 0;
  try {
    for (const pending of outbox) {
      const channels: Channel[] = [];
      for (const channel of pending.channels) {
        if (Date.now() - runStarted > deliveryDeadlineMs) {
          channels.push(channel);
          continue;
        }
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Notifications are delivered in order, one channel at a time.
          await send[channel](pending);
          delivered += 1;
        } catch {
          /* Undelivered channels stay in the outbox; the heartbeat reports the failure. */
          channels.push(channel);
        }
      }
      if (channels.length > 0) {
        remaining.push({ ...pending, channels });
      }
    }
  } finally {
    mail.close();
  }
  return { remaining: remaining.slice(-maximumOutbox), delivered };
};

/** Pings the dead-man's switch with this run's exit status (healthchecks-compatible `<url>/<code>`). */
const heartbeat = async ({ heartbeatUrl }: Config, exitCode: number) => {
  try {
    await fetch(`${heartbeatUrl.replace(/\/+$/u, "")}/${exitCode}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(deliveryTimeoutMs),
    });
  } catch {
    /* A failed heartbeat is exactly what the dead-man's switch detects. */
  }
};

const configuration = config();
await mkdir(configuration.evidenceDirectory, { recursive: true, mode: 0o700 });
const at = new Date();
const evidenceFile = path.join(
  configuration.evidenceDirectory,
  `${at.toISOString().slice(0, 7)}.jsonl`
);
const [sample, alerts] = await Promise.all([
  probe(evidenceFile),
  metricsAlerts(configuration),
]);
const stored = await loadState(configuration.stateFile);
const advanced = advanceAlerts(stored.alerts, {
  minute: Math.floor(Date.parse(sample.at) / minuteMs),
  available: sample.available,
  metricsAlerts: alerts,
});
const outbox = [
  ...stored.outbox,
  ...advanced.notifications.map((notification) => ({
    ...notification,
    channels: [...channelSchema.options],
  })),
];
// Commit the alert transition before delivery so a crash cannot repeat or lose it.
await saveState(configuration.stateFile, { alerts: advanced.state, outbox });
const { remaining, delivered } = await deliver(configuration, outbox);
await saveState(configuration.stateFile, {
  alerts: advanced.state,
  outbox: remaining,
});
const exitCode = remaining.length > 0 ? 1 : 0;
await heartbeat(configuration, exitCode);
process.stdout.write(
  `${JSON.stringify({
    at: sample.at,
    available: sample.available,
    metrics: alerts === null ? "unreachable" : "ok",
    metricsAlerts: alerts?.length ?? null,
    delivered,
    undelivered: remaining.length,
  })}\n`
);
process.exitCode = exitCode;
