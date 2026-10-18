import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SimulatedBank } from "../src/bank.js";
import { createJsonLogger, type Logger } from "../src/logger.js";
import { publishPending } from "../src/outbox/publisher.js";
import { createSqsHandler } from "../src/worker/sqs-handler.js";
import { TEST_JWT_SECRET, token } from "./helpers/auth.js";
import { startTestDb, type TestDb } from "./helpers/db.js";
import { createTestQueue, pollOnce, testSqs } from "./helpers/sqs.js";

let t: TestDb;
const lines: string[] = [];
const logger: Logger = createJsonLogger((line) => lines.push(line));
const logs = () => lines.map((l) => JSON.parse(l) as Record<string, any>);

const body = {
  amount_cents: 5_000_000,
  currency: "USD",
  source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" },
};

beforeAll(async () => {
  t = await startTestDb();
  await t.admin.insertInto("tenants").values({ id: "tnt_abc", name: "abc" }).execute();
});
afterAll(async () => {
  await t.stop();
});

describe("createJsonLogger", () => {
  it("writes one JSON object per line with level, time and message", () => {
    const out: string[] = [];
    createJsonLogger((l) => out.push(l)).info("hello", { correlation_id: "c1" });
    createJsonLogger((l) => out.push(l)).error("boom", { correlation_id: "c2" });
    expect(out).toHaveLength(2);
    expect(out.every((l) => !l.includes("\n"))).toBe(true);
    expect(JSON.parse(out[0]!)).toMatchObject({ level: "info", msg: "hello", correlation_id: "c1" });
    expect(JSON.parse(out[0]!).time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(out[1]!)).toMatchObject({ level: "error", msg: "boom" });
  });
});

describe("correlation id in structured logs", () => {
  it("appears in the API, publisher and worker logs of one deposit, without leaking secrets", async () => {
    const sqs = testSqs();
    const q = await createTestQueue(sqs);
    const app = buildApp({ db: t.app, jwtSecret: TEST_JWT_SECRET, logger });
    const bearer = await token("tnt_abc", "usr_log");

    const res = await app.inject({
      method: "POST",
      url: "/v1/deposits",
      headers: { authorization: `Bearer ${bearer}`, "idempotency-key": "log-1", "x-correlation-id": "corr-log-1" },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    await publishPending({ db: t.relay, sqs, queueUrl: q.url, logger });
    await pollOnce(sqs, q.url, createSqsHandler({ db: t.app, bank: new SimulatedBank("clear"), logger }));

    const mine = logs().filter((l) => l.correlation_id === "corr-log-1");
    const byMsg = Object.fromEntries(mine.map((l) => [l.msg, l]));
    expect(byMsg.request_completed).toMatchObject({ method: "POST", path: "/v1/deposits", status_code: 202 });
    expect(byMsg.request_completed.duration_ms).toEqual(expect.any(Number));
    expect(byMsg.outbox_published).toMatchObject({ tenant_id: "tnt_abc", transaction_id: res.json().transaction_id });
    expect(byMsg.deposit_settled).toMatchObject({ tenant_id: "tnt_abc", transaction_id: res.json().transaction_id });

    const everything = lines.join("\n");
    expect(everything).not.toContain(body.source_account.iban);
    expect(everything).not.toContain(bearer);
    await app.close();
    await q.delete();
  });

  it("logs worker failures at error level with the correlation id of the event", async () => {
    const app = buildApp({ db: t.app, jwtSecret: TEST_JWT_SECRET });
    const res = await app.inject({
      method: "POST",
      url: "/v1/deposits",
      headers: { authorization: `Bearer ${await token("tnt_abc", "usr_log2")}`, "idempotency-key": "log-2", "x-correlation-id": "corr-log-2" },
      payload: body,
    });
    const row = await t.admin.selectFrom("outbox").select("payload").where("transaction_id", "=", res.json().transaction_id).executeTakeFirstOrThrow();
    const handler = createSqsHandler({ db: t.app, bank: new SimulatedBank("down"), logger });
    await handler({ Records: [{ messageId: "m1", body: JSON.stringify(row.payload) }] } as never);

    const err = logs().find((l) => l.level === "error" && l.correlation_id === "corr-log-2");
    expect(err).toMatchObject({ msg: "record_failed", message_id: "m1", error: "bank unavailable" });
    await app.close();
  });

  it("logs unexpected API errors with the correlation id", async () => {
    const broken = buildApp({ db: undefined as never, jwtSecret: TEST_JWT_SECRET, logger });
    const res = await broken.inject({
      method: "POST",
      url: "/v1/deposits",
      headers: { authorization: `Bearer ${await token("tnt_abc", "u")}`, "idempotency-key": "log-3", "x-correlation-id": "corr-log-3" },
      payload: body,
    });
    expect(res.statusCode).toBe(500);
    expect(logs().find((l) => l.level === "error" && l.correlation_id === "corr-log-3")).toMatchObject({ msg: "request_failed" });
  });
});
