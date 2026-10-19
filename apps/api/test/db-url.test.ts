import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../src/db/url.js";

describe("resolveDatabaseUrl", () => {
  it("prefers an explicit connection string (local development)", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a:b@h:1/d", DB_HOST: "x" }, "DATABASE_URL")).toBe("postgres://a:b@h:1/d");
  });

  it("composes the URL from DB_* parts injected from Secrets Manager, encoding credentials", () => {
    const env = { DB_HOST: "db.internal", DB_PORT: "5432", DB_NAME: "fintech", DB_USER: "app_user", DB_PASSWORD: "p@ss/w:rd" };
    expect(resolveDatabaseUrl(env, "DATABASE_URL")).toBe("postgres://app_user:p%40ss%2Fw%3Ard@db.internal:5432/fintech");
  });

  it("uses RELAY_DB_* parts for the relay role while sharing host, port and name", () => {
    const env = { DB_HOST: "h", DB_PORT: "5432", DB_NAME: "n", RELAY_DB_USER: "outbox_relay", RELAY_DB_PASSWORD: "pw" };
    expect(resolveDatabaseUrl(env, "RELAY_DATABASE_URL", "RELAY_DB")).toBe("postgres://outbox_relay:pw@h:5432/n");
  });

  it("names the missing variable when nothing is configured", () => {
    expect(() => resolveDatabaseUrl({}, "DATABASE_URL")).toThrow("Missing required env var DATABASE_URL (or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)");
  });
});
