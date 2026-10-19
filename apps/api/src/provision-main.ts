// One-off ECS task (run after each deploy that adds migrations or rotates a database secret).
import { provisionDatabase } from "./db/provision.js";
import { resolveDatabaseUrl } from "./db/url.js";
import { createJsonLogger } from "./logger.js";

const logger = createJsonLogger();
const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

// The secrets carry the role names; they must match the roles the migrations create.
const expectUser = (varName: string, role: string) => {
  if (required(varName) !== role) throw new Error(`${varName} must be ${role}`);
};
expectUser("DB_USER", "app_user");
expectUser("RELAY_DB_USER", "outbox_relay");

await provisionDatabase(resolveDatabaseUrl(process.env, "ADMIN_DATABASE_URL", "ADMIN_DB"), {
  app_user: required("DB_PASSWORD"),
  outbox_relay: required("RELAY_DB_PASSWORD"),
});
logger.info("database_provisioned", { roles: ["app_user", "outbox_relay"] });
