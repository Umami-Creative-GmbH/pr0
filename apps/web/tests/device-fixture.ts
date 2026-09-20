import { expect } from "bun:test";

import { librarySchema } from "@pr0/api-contract/accounts";
import {
  deviceCodeSchema,
  deviceTokenSchema,
  desktopSessionSchema,
} from "@pr0/api-contract/device";

import {
  cookieFrom,
  origin,
  password,
  post,
  accountEmailLink,
} from "./http-fixture";

export const verifiedBrowser = async () => {
  const email = `device-${crypto.randomUUID()}@example.test`;
  const signup = await post("/api/auth/sign-up/email", { email, password });
  expect(signup.status).toBe(202);
  await fetch(await accountEmailLink(email));
  const browser = cookieFrom(
    await post("/api/auth/sign-in/email", { email, password })
  );
  const response = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: browser },
  });
  const library = librarySchema.parse(await response.json());
  return { email, browser, library };
};
export const startDevice = async () => {
  const response = await post("/api/auth/device/code", {
    client_id: "pr0-desktop",
  });
  expect(response.status).toBe(200);
  return deviceCodeSchema.parse(await response.json());
};
export const redeem = (code: string) =>
  post("/api/auth/device/token", {
    client_id: "pr0-desktop",
    device_code: code,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
export const approveDevice = (
  userCode: string,
  accountId: string,
  cookie: string,
  approve = true
) =>
  post(
    `/api/auth/device/${approve ? "approve" : "deny"}`,
    { userCode, accountId },
    { Cookie: cookie }
  );
export const readDesktop = async (token: string) => {
  const response = await fetch(`${origin}/api/v1/desktop/session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return desktopSessionSchema.parse(await response.json());
};
export const tokenFrom = async (response: Response) =>
  deviceTokenSchema.parse(await response.json());
