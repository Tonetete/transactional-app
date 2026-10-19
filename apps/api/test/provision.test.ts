import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionDatabase } from "../src/db/provision.js";

let container: StartedPostgreSqlContainer;

const login = async (user: string, password: string) => {
  const c = new pg.Client({ host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user, password });
  await c.connect();
  return c;
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => {
  await container.stop();
});

describe("provisionDatabase (cloud one-off task)", () => {
  it("applies the migrations and gives app_user and outbox_relay the supplied passwords", async () => {
    await provisionDatabase(container.getConnectionUri(), { app_user: "pw-app 1'", outbox_relay: "pw-relay" });
    const app = await login("app_user", "pw-app 1'");
    expect((await app.query("select to_regclass('public.transactions') as t")).rows[0].t).toBe("transactions");
    await app.end();
    await (await login("outbox_relay", "pw-relay")).end();
  });

  it("is idempotent and rotates a password when the secret changes", async () => {
    await provisionDatabase(container.getConnectionUri(), { app_user: "rotated", outbox_relay: "pw-relay" });
    await (await login("app_user", "rotated")).end();
    await expect(login("app_user", "pw-app 1'")).rejects.toThrow();
  });

  it("refuses roles it does not manage", async () => {
    await expect(provisionDatabase(container.getConnectionUri(), { postgres: "x" })).rejects.toThrow("Unmanaged database role: postgres");
  });
});
