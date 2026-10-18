import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

const app = buildApp({ db: createDb(required("DATABASE_URL")), jwtSecret: required("JWT_SECRET") });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
