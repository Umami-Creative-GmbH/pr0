import "server-only";
import { SQL } from "bun";

import { secret } from "./config";

let client: SQL | undefined;
let workClient: SQL | undefined;
let searchClient: SQL | undefined;
export const searchDatabase = () => {
  searchClient ??= new SQL(secret("DATABASE_URL"), {
    max: 4,
    connectionTimeout: 2,
    idleTimeout: 30,
    connection: { statement_timeout: 1000, lock_timeout: 1000 },
  });
  return searchClient;
};
export const database = () => {
  client ??= new SQL(secret("DATABASE_URL"), {
    max: 12,
    connectionTimeout: 5,
    idleTimeout: 30,
    connection: { statement_timeout: 5000, lock_timeout: 4000 },
  });
  return client;
};

export const workDatabase = () => {
  workClient ??= new SQL(secret("DATABASE_URL"), {
    max: 2,
    connectionTimeout: 2,
    idleTimeout: 30,
    connection: { statement_timeout: 1000, lock_timeout: 1000 },
  });
  return workClient;
};
