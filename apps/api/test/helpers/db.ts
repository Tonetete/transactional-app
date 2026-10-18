import { sql } from "kysely";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/db/migrate.js";
import { createDb, type Db } from "../../src/db/client.js";

export interface TestDb {
  admin: Db; // superuser, bypasses RLS: seeding only
  app: Db; // app_user, subject to RLS
  stop(): Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine").start();
  const adminUrl = container.getConnectionUri();
  await runMigrations(adminUrl);
  const admin = createDb(adminUrl);
  await sql`ALTER ROLE app_user PASSWORD 'app_user'`.execute(admin);
  const appUrl = `postgres://app_user:app_user@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  const app = createDb(appUrl);
  return {
    admin,
    app,
    async stop() {
      await app.destroy();
      await admin.destroy();
      await container.stop();
    },
  };
}
