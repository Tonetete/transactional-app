import type { SQSClient } from "@aws-sdk/client-sqs";
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
  amount_cents: 5_000_000, // $50,000
  currency: "USD",
  source_account: { holder_name: "Jane Doe", iban: "GB82WEST12345698765432" },
};

const post = async (key: string, user: string) =>
  app.inject({
    method: "POST",
    url: "/v1/deposits",
    headers: { authorization: `Bearer ${await token("tnt_abc", user)}`, "idempotency-key": key, "x-correlation-id": `corr-${key}` },
    payload: body,
  });

const balanceOf = async (txnId: string) =>
  (
    await t.admin
      .selectFrom("accounts")
      .innerJoin("transactions", "transactions.account_id", "accounts.id")
      .select("accounts.balance_cents")
      .where("transactions.id", "=", txnId)
      .executeTakeFirstOrThrow()
  ).balance_cents;

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

describe("deposit end to end: API -> outbox -> SQS -> worker -> ledger", () => {
  it("settles a deposit, credits the ledger once, and a later API replay reports SETTLED", async () => {
    const q = await createTestQueue(sqs);
    const handler = createSqsHandler({ db: t.app, bank: new SimulatedBank("clear") });

    const first = await post("e2e-1", "usr_e2e1");
    expect(first.statusCode).toBe(202);
    const id = first.json().transaction_id;
    expect(await balanceOf(id)).toBe("0"); // unchanged until settlement

    expect(await publishPending({ db: t.relay, sqs, queueUrl: q.url })).toBe(1);
    expect(await pollOnce(sqs, q.url, handler)).toEqual({ received: 1, failed: 0 });
    expect(await balanceOf(id)).toBe("5000000");

    const replay = await post("e2e-1", "usr_e2e1");
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ transaction_id: id, status: "SETTLED", created: false });
    expect(await balanceOf(id)).toBe("5000000");
    await q.delete();
  });

  it("a duplicate SQS delivery of the same event does not double-credit", async () => {
    const q = await createTestQueue(sqs);
    const handler = createSqsHandler({ db: t.app, bank: new SimulatedBank("clear") });
    const res = await post("e2e-dup", "usr_e2e2");
    const id = res.json().transaction_id;
    await publishPending({ db: t.relay, sqs, queueUrl: q.url });

    const [original] = await receiveAll(sqs, q.url, 1);
    // SQS may deliver the same event several times; hand the same body to the handler three times.
    await handler({ Records: [original!, original!, original!].map((m, i) => ({ messageId: `d${i}`, body: m.Body! })) } as never);

    expect(await balanceOf(id)).toBe("5000000");
    await q.delete();
  });

  it("a bank rejection ends in FAILED with no credit, visible through the API replay", async () => {
    const q = await createTestQueue(sqs);
    const handler = createSqsHandler({ db: t.app, bank: new SimulatedBank("reject") });
    const res = await post("e2e-rej", "usr_e2e3");
    const id = res.json().transaction_id;
    await publishPending({ db: t.relay, sqs, queueUrl: q.url });
    expect(await pollOnce(sqs, q.url, handler)).toEqual({ received: 1, failed: 0 });

    expect(await balanceOf(id)).toBe("0");
    const replay = await post("e2e-rej", "usr_e2e3");
    expect(replay.json()).toMatchObject({ transaction_id: id, status: "FAILED", created: false });
    await q.delete();
  });
});
