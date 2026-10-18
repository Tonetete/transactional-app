import { GetQueueAttributesCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SimulatedBank } from "../src/bank.js";
import { publishPending } from "../src/outbox/publisher.js";
import { createSqsHandler } from "../src/worker/sqs-handler.js";
import { TEST_JWT_SECRET, token } from "./helpers/auth.js";
import { startTestDb, type TestDb } from "./helpers/db.js";
import { createTestQueue, pollOnce, receiveAll, testSqs } from "./helpers/sqs.js";

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let sqs: SQSClient;

const body = {
  amount_cents: 5_000_000,
  currency: "USD",
  source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" },
};

async function deposit(key: string) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/deposits",
    headers: { authorization: `Bearer ${await token("tnt_abc", `usr_${key}`)}`, "idempotency-key": key },
    payload: body,
  });
  return { status: res.statusCode, id: res.json().transaction_id as string, state: res.json().status as string };
}

const txn = (id: string) => t.admin.selectFrom("transactions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

/** Main queue wired to a DLQ that receives a message after 3 failed receives (S2). */
async function queuePair() {
  const dlq = await createTestQueue(sqs);
  const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq.url, AttributeNames: ["QueueArn"] }));
  const main = await createTestQueue(sqs, {
    VisibilityTimeout: "1",
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: Attributes!.QueueArn, maxReceiveCount: 3 }),
  });
  return { main, dlq };
}

beforeAll(async () => {
  t = await startTestDb();
  sqs = testSqs();
  await t.admin.insertInto("tenants").values({ id: "tnt_abc", name: "abc" }).execute();
  app = buildApp({ db: t.app, jwtSecret: TEST_JWT_SECRET });
});
afterAll(async () => {
  await app.close();
  await t.stop();
});

describe("graceful degradation when the bank is down (S4)", () => {
  it("keeps answering 202 PENDING, retains the event in the queue and settles after recovery", async () => {
    const { main, dlq } = await queuePair();
    const bank = new SimulatedBank("down");
    const handler = createSqsHandler({ db: t.app, bank });

    const d = await deposit("deg-1");
    expect(d.status).toBe(202);
    expect(d.state).toBe("PENDING");
    await publishPending({ db: t.relay, sqs, queueUrl: main.url });

    // One failed attempt: the message is kept (not deleted), the money has not moved.
    expect(await pollOnce(sqs, main.url, handler)).toEqual({ received: 1, failed: 1 });
    expect((await txn(d.id)).status).toBe("PROCESSING");

    // Another API request during the outage is still accepted.
    expect((await deposit("deg-2")).status).toBe(202);

    // Bank recovers before the third receive: the retained message settles normally.
    bank.mode = "clear";
    await new Promise((r) => setTimeout(r, 1200));
    expect(await pollOnce(sqs, main.url, handler)).toEqual({ received: 1, failed: 0 });
    expect((await txn(d.id)).status).toBe("SETTLED");
    expect(await receiveAll(sqs, dlq.url, 1)).toHaveLength(0);
    await Promise.all([main.delete(), dlq.delete()]);
  });
});

describe("dead-letter queue (S2)", () => {
  it("moves a message to the DLQ after 3 failed attempts and does not block other messages", async () => {
    const { main, dlq } = await queuePair();
    const bank = new SimulatedBank("down");
    const handler = createSqsHandler({ db: t.app, bank });

    // Events left unpublished by the previous test belong to a queue that no longer exists.
    await t.admin.updateTable("outbox").set({ published_at: new Date() }).where("published_at", "is", null).execute();
    const poison = await deposit("dlq-1");
    await publishPending({ db: t.relay, sqs, queueUrl: main.url });
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await pollOnce(sqs, main.url, handler)).toEqual({ received: 1, failed: 1 });
      await new Promise((r) => setTimeout(r, 1200));
    }
    expect(await pollOnce(sqs, main.url, handler)).toEqual({ received: 0, failed: 0 }); // gone from main

    const dead = await receiveAll(sqs, dlq.url, 2);
    expect(dead).toHaveLength(1);
    expect(JSON.parse(dead[0]!.Body!).data.transaction_id).toBe(poison.id);
    expect((await txn(poison.id)).status).toBe("PROCESSING"); // preserved for manual audit, no credit

    // The pipeline keeps flowing for later events.
    bank.mode = "clear";
    const next = await deposit("dlq-2");
    await publishPending({ db: t.relay, sqs, queueUrl: main.url });
    expect(await pollOnce(sqs, main.url, handler)).toEqual({ received: 1, failed: 0 });
    expect((await txn(next.id)).status).toBe("SETTLED");
    await Promise.all([main.delete(), dlq.delete()]);
  });
});

describe("sqs handler batch semantics", () => {
  it("reports only the failing records so the rest of the batch is not retried", async () => {
    const handler = createSqsHandler({ db: t.app, bank: new SimulatedBank("clear") });
    const ok = await deposit("batch-ok");
    const row = await t.admin.selectFrom("outbox").select("payload").where("transaction_id", "=", ok.id).executeTakeFirstOrThrow();
    const res = await handler({
      Records: [
        { messageId: "m-bad", body: "{not json" },
        { messageId: "m-ok", body: JSON.stringify(row.payload) },
      ],
    } as never);
    expect(res).toEqual({ batchItemFailures: [{ itemIdentifier: "m-bad" }] });
    expect((await txn(ok.id)).status).toBe("SETTLED");
  });
});
