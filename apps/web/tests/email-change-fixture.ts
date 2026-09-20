// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Poll the external SMTP sink within a bounded deadline.
import { z } from "zod";

import { cookieFrom, post } from "./http-fixture";
import { githubLogin, libraryFor } from "./social-fixture";

export const emailCode = async (email: string, exclude: string[] = []) => {
  const origin = process.env.PR0_TEST_MAIL_ORIGIN ?? "http://localhost:18426";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${origin}/api/v1/messages`);
    const { messages } = z
      .object({
        messages: z.array(
          z.object({
            ID: z.string(),
            To: z.array(z.object({ Address: z.string() })),
          })
        ),
      })
      .parse(await response.json());
    for (const item of messages.filter((message) =>
      message.To.some((recipient) => recipient.Address === email)
    )) {
      const detail = await fetch(`${origin}/api/v1/message/${item.ID}`);
      const { Text } = z
        .object({ Text: z.string() })
        .parse(await detail.json());
      const code = Text.match(/\b\d{8}\b/u)?.[0];
      if (code && !exclude.includes(code)) {
        return code;
      }
    }
    await Bun.sleep(200);
  }
  throw new Error("Account code did not reach the controlled SMTP sink");
};

export const socialBrowser = async () => {
  const email = `${crypto.randomUUID()}@example.test`;
  const subject = crypto.randomUUID();
  const Cookie = cookieFrom(await githubLogin(subject, email));
  const library = await libraryFor(Cookie);
  const identity = { accountId: library.account.id, emailVersion: 0 };
  return { email, subject, Cookie, identity, sessionId: library.session.id };
};

export const freshSocialBrowser = async () => {
  const browser = await socialBrowser();
  const response = await post(
    "/api/v1/account/reauth/challenges",
    browser.identity,
    { Cookie: browser.Cookie }
  );
  const { challengeId } = await response.json();
  const verified = await post(
    "/api/v1/account/reauth/verify",
    { ...browser.identity, challengeId, code: await emailCode(browser.email) },
    { Cookie: browser.Cookie }
  );
  if (!verified.ok) {
    throw new Error("Fresh-authentication fixture failed");
  }
  return browser;
};
