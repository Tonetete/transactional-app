import type { SQSClient } from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { publishPending } from "../src/outbox/publisher.js";
import { TEST_JWT_SECRET, token } from "./helpers/auth.js";
import { startTestDb, type TestDb } from "./helpers/db.js";
import { createTestQueue, receiveAll, testSqs } from "./helpers/sqs.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let sqs: SQSClient;

const body = {
  amount_cents: 5_000_000,
  currency: "USD",
  source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" },
};

async function deposit(key: string, tenant = "tnt_abc", correlation = `corr-${key}`) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/deposits",
    headers: {
      authorization: `Bearer ${await token(tenant, "usr_123")}`,
      "idempotency-key": key,
      "x-correlation-id": correlation,
    },
    payload: body,
  });
  expect(res.statusCode).toBe(202);
  return res.json().transaction_id as string;
}

const unpublished = async () =>
  (await t.admin.selectFrom("outbox").select("id").where("published_at", "is", null).execute()).length;

beforeAll(async () => {
  t = await startTestDb();
  sqs = testSqs();
  for (const id of ["tnt_abc", "tnt_xyz"]) await t.admin.insertInto("tenants").values({ id, name: id }).execute();
  app = buildApp({ db: t.app, jwtSecret: TEST_JWT_SECRET });
});
afterAll(async () => {
  await app.close();
  await t.stop();
});

describe("outbox publisher", () => {
  it("publishes events of all tenants with correlation attributes and marks them published", async () => {
    const q = await createTestQueue(sqs);
    const a = await deposit("pub-a", "tnt_abc", "corr-a");
    const b = await deposit("pub-b", "tnt_xyz", "corr-b");

    const n = await publishPending({ db: t.relay, sqs, queueUrl: q.url });
    expect(n).toBe(2);
    expect(await unpublished()).toBe(0);

    const msgs = await receiveAll(sqs, q.url);
    expect(msgs).toHaveLength(2);
    const byTxn = new Map(msgs.map((m) => [JSON.parse(m.Body!).data.transaction_id, m]));
    const ma = byTxn.get(a)!;
    expect(ma.MessageAttributes!.correlation_id!.StringValue).toBe("corr-a");
    expect(ma.MessageAttributes!.tenant_id!.StringValue).toBe("tnt_abc");
    expect(ma.MessageAttributes!.event_type!.StringValue).toBe("DepositRequested");
    expect(JSON.parse(ma.Body!)).toMatchObject({ event_type: "DepositRequested", tenant_id: "tnt_abc", correlation_id: "corr-a" });
    expect(byTxn.get(b)!.MessageAttributes!.tenant_id!.StringValue).toBe("tnt_xyz");
    await q.delete();
  });

  it("publishes nothing when there is nothing pending", async () => {
    const q = await createTestQueue(sqs);
    expect(await publishPending({ db: t.relay, sqs, queueUrl: q.url })).toBe(0);
    expect(await receiveAll(sqs, q.url, 1)).toHaveLength(0);
    await q.delete();
  });

  it("leaves events unpublished when SQS fails and publishes them on the next run", async () => {
    const q = await createTestQueue(sqs);
    await deposit("pub-fail");
    const broken = { send: async () => { throw new Error("sqs down"); } } as unknown as SQSClient;
    await expect(publishPending({ db: t.relay, sqs: broken, queueUrl: q.url })).rejects.toThrow("sqs down");
    expect(await unpublished()).toBe(1);
    expect(await publishPending({ db: t.relay, sqs, queueUrl: q.url })).toBe(1);
    expect(await unpublished()).toBe(0);
    await q.delete();
  });

  it("concurrent publishers never send the same event twice", async () => {
    const q = await createTestQueue(sqs);
    for (let i = 0; i < 12; i++) await deposit(`pub-race-${i}`);
    const cfg = { db: t.relay, sqs, queueUrl: q.url, batchSize: 4 };
    const counts = await Promise.all([publishPending(cfg), publishPending(cfg), publishPending(cfg)]);
    let total = counts.reduce((a, b) => a + b, 0);
    while ((await unpublished()) > 0) total += await publishPending(cfg);
    expect(total).toBe(12);
    const msgs = await receiveAll(sqs, q.url, 4);
    expect(new Set(msgs.map((m) => JSON.parse(m.Body!).event_id)).size).toBe(12);
    expect(msgs).toHaveLength(12);
    await q.delete();
  });

  it("the relay role cannot read business tables or modify event content", async () => {
    await expect(t.relay.selectFrom("transactions").selectAll().execute()).rejects.toThrow(/permission denied/);
    await expect(
      t.relay.updateTable("outbox").set({ event_type: "x" } as never).execute(),
    ).rejects.toThrow(/permission denied/);
  });
});
