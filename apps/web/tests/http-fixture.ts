// oxlint-disable eslint/no-await-in-loop -- Poll the controlled email delivery boundary until its deadline.
// oxlint-disable anti-slop/no-object-parameters -- Negative HTTP fixtures deliberately include malformed request shapes.
import { z } from "zod";

export const origin = process.env.PR0_TEST_ORIGIN ?? "http://localhost:30424";
export const password = "private-library-test-password";
const runSubnet = Math.floor(Math.random() * 200) + 20;
let address = 0;
export const ingressHeaders = () => {
  address += 1;
  return {
    "x-pr0-ingress-secret": "local-test-ingress-secret-at-least-32-characters",
    "x-pr0-client-ip": `198.18.${runSubnet}.${address % 255}`,
  };
};
// oxlint-disable-next-line anti-slop/no-object-parameters -- Negative HTTP fixtures deliberately include malformed request shapes.
export const post = (
  path: string,
  body: object,
  headers: Record<string, string> = {}
) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...ingressHeaders(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
export const cookieFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
export const accountEmailLink = async (
  email: string,
  subject?: string,
  excludeToken?: string
) => {
  const mailOrigin =
    process.env.PR0_TEST_MAIL_ORIGIN ?? "http://localhost:18424";
  const listSchema = z.object({
    messages: z.array(
      z.object({
        ID: z.string(),
        Subject: z.string(),
        To: z.array(z.object({ Address: z.string() })),
      })
    ),
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${mailOrigin}/api/v1/messages`);
    const list = listSchema.parse(await response.json());
    const item = list.messages.find(
      (message) =>
        message.To.some((recipient) => recipient.Address === email) &&
        (!subject || message.Subject === subject)
    );
    if (item) {
      const detail = await fetch(`${mailOrigin}/api/v1/message/${item.ID}`);
      const mail = z.object({ Text: z.string() }).parse(await detail.json());
      const link = mail.Text.match(/http[^\s]+/u)?.[0];
      if (link && (!excludeToken || !link.includes(excludeToken))) {
        return link;
      }
    }
    await Bun.sleep(200);
  }
  throw new Error("Verification email did not reach the controlled SMTP sink");
};
