import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

import { database } from "./database";

const issuanceVersion = new AsyncLocalStorage<number>();

export const withSessionIssuance = async (
  email: string,
  operation: () => Promise<Response>
) => {
  const sql = database();
  const [owner] =
    await sql`SELECT authentication_version FROM "user" WHERE email = ${email}`;
  return issuanceVersion.run(owner?.authentication_version ?? 0, operation);
};

export const sessionAuthenticationVersion = () => {
  const version = issuanceVersion.getStore();
  if (version === undefined) {
    throw new Error(
      "Session issuance requires a server authentication context"
    );
  }
  return version;
};
