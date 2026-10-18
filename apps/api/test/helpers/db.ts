import { sql } from "kysely";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/db/migrate.js";
import { createDb, type Db } from "../../src/db/client.js";

export interface TestDb {
  admin: Db; // superuser, bypasses RLS: seeding only
  app: Db; // app_user, subject to RLS
  relay: Db; // outbox_relay, sees outbox rows of all tenants
  adminUrl: string;
  appUrl: string;
  relayUrl: string;
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
  await sql`ALTER ROLE outbox_relay PASSWORD 'outbox_relay'`.execute(admin);
  const relayUrl = `postgres://outbox_relay:outbox_relay@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  const relay = createDb(relayUrl);
  return {
    admin,
    app,
    relay,
    adminUrl,
    appUrl,
    relayUrl,
    async stop() {
      await app.destroy();
      await relay.destroy();
      await admin.destroy();
      await container.stop();
    },
  };
}
