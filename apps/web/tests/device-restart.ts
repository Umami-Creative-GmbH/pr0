import { expect } from "bun:test";
import path from "node:path";

import { capabilitiesSchema } from "@pr0/api-contract/device";

import type { accountTestServer } from "./account-test-server";
import {
  approveDevice,
  readDesktop,
  redeem,
  startDevice,
  tokenFrom,
  verifiedBrowser,
} from "./device-fixture";
import { origin } from "./http-fixture";

export const verifyDeviceRestart = async (
  server: ReturnType<typeof accountTestServer>
) => {
  const browser = await verifiedBrowser();
  const code = await startDevice();
  await approveDevice(
    code.user_code,
    browser.library.account.id,
    browser.browser
  );
  const token = await tokenFrom(await redeem(code.device_code));
  const session = await readDesktop(token.access_token);
  const response = await fetch(`${origin}/api/v1/capabilities`);
  const capabilities = capabilitiesSchema.parse(await response.json());
  const expired = await startDevice();
  const clock = path
    .join(import.meta.dir, "device-clock-preload.ts")
    .replaceAll("\\", "/");
  await server.startServer({ PR0_TEST_TIME_OFFSET_MS: "660000" }, [clock]);
  const rejection = await redeem(expired.device_code);
  expect(await rejection.json()).toEqual({ error: "expired_token" });
  const after = await readDesktop(token.access_token);
  expect(after.session.id).toBe(session.session.id);
  expect(after.deletionHandle).toBe(session.deletionHandle);
  const discovery = await fetch(`${origin}/api/v1/capabilities`);
  expect(capabilitiesSchema.parse(await discovery.json())).toEqual(
    capabilities
  );
  process.stdout.write(
    "PASS served process restart: independent session, trust anchor, deletion handle and code expiry\n"
  );
};
