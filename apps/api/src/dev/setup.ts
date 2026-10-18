// Local development bootstrap: migrate, set role passwords, seed tenants, create queue + DLQ on floci.
import { CreateQueueCommand, GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import pg from "pg";
import { runMigrations } from "../db/migrate.js";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (copy .env.example to .env)`);
  return v;
};

const adminUrl = env("ADMIN_DATABASE_URL");
await runMigrations(adminUrl);

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
for (const [role, passwordVar] of [["app_user", "APP_DB_PASSWORD"], ["outbox_relay", "RELAY_DB_PASSWORD"]] as const) {
  const { rows } = await admin.query("select format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) as stmt", [role, env(passwordVar)]);
  await admin.query(rows[0].stmt);
}
for (const tenant of [["tnt_abc", "Tenant ABC"], ["tnt_xyz", "Tenant XYZ"]]) {
  await admin.query("insert into tenants (id, name) values ($1, $2) on conflict (id) do nothing", tenant);
}
await admin.end();
console.log("database ready: migrations applied, roles configured, tenants tnt_abc and tnt_xyz seeded");

const sqs = new SQSClient({});
const dlq = await sqs.send(new CreateQueueCommand({ QueueName: env("DLQ_NAME") }));
const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ["QueueArn"] }));
const main = await sqs.send(
  new CreateQueueCommand({
    QueueName: env("QUEUE_NAME"),
    Attributes: {
      VisibilityTimeout: "30",
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: Attributes!.QueueArn, maxReceiveCount: 3 }),
    },
  }),
);
console.log(`queue ready: ${main.QueueUrl} (DLQ: ${dlq.QueueUrl}, maxReceiveCount 3)`);
console.log(`set QUEUE_URL=${main.QueueUrl} in .env if it differs`);
