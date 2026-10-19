import { buildApp, type AppDeps } from "./app.js";
import { createDb } from "./db/client.js";
import { createJsonLogger } from "./logger.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

// Dev login mints tokens for anyone and provisions tenants with the admin role: opt-in, local development only.
let devLogin: AppDeps["devLogin"];
if (process.env.DEV_LOGIN_ENABLED === "true") {
  const admin = createDb(required("ADMIN_DATABASE_URL"));
  devLogin = {
    provisionTenant: async (id) => {
      await admin.insertInto("tenants").values({ id, name: id }).onConflict((oc) => oc.column("id").doNothing()).execute();
    },
  };
}

const app = buildApp({
  db: createDb(required("DATABASE_URL")),
  jwtSecret: required("JWT_SECRET"),
  logger: createJsonLogger(),
  devLogin,
  corsOrigin: process.env.CORS_ORIGIN,
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
