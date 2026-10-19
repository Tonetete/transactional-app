import pg from "pg";
import { runMigrations } from "./migrate.js";

/** Roles created by the migrations; only these may have their password managed here. */
const MANAGED_ROLES = new Set(["app_user", "outbox_relay"]);

/**
 * One-off database provisioning with the administrative role: applies the migrations (which create the
 * roles) and sets each role's password to the value held in its Secrets Manager secret. Idempotent, and
 * re-running it after a secret rotation rotates the database password too.
 */
export async function provisionDatabase(adminUrl: string, passwords: Record<string, string>): Promise<void> {
  for (const role of Object.keys(passwords)) {
    if (!MANAGED_ROLES.has(role)) throw new Error(`Unmanaged database role: ${role}`);
  }
  await runMigrations(adminUrl);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    for (const [role, password] of Object.entries(passwords)) {
      const { rows } = await admin.query("select format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) as stmt", [role, password]);
      await admin.query(rows[0].stmt);
    }
  } finally {
    await admin.end();
  }
}
