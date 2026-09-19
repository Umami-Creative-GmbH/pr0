import { migrate } from "drizzle-orm/bun-sql/migrator";

import { db, client } from "./auth";

await migrate(db, { migrationsFolder: "./migrations" });
await migrate(db, { migrationsFolder: "./migrations" });
console.info("PASS migrations applied twice through Bun SQL");
await client.close();
