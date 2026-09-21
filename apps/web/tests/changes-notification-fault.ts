import { SQL } from "bun";

// Disposable fixture only: shadow the external notification function, leaving durable SQL intact.
const database = new SQL(process.env.DATABASE_URL ?? "");
try {
  await database`CREATE FUNCTION public.pg_notify(text,text) RETURNS void LANGUAGE plpgsql AS 'BEGIN RETURN; END'`;
  await database`ALTER ROLE CURRENT_USER SET search_path TO public,pg_catalog`;
} finally {
  await database.close();
}
