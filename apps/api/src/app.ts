import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { isValidIdempotencyKey, parseDepositRequest } from "@acex/shared";
import { verifyBearer } from "./auth.js";
import type { Db } from "./db/client.js";
import { createDeposit } from "./deposits.js";
import { noopLogger, type Logger } from "./logger.js";

export interface AppDeps {
  db: Db;
  jwtSecret: string;
  logger?: Logger;
}

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
  }
}

const CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function buildApp({ db, jwtSecret, logger = noopLogger }: AppDeps) {
  const app = Fastify({ logger: false });

  app.decorateRequest("correlationId", "");
  app.addHook("onRequest", async (req, reply) => {
    const incoming = req.headers["x-correlation-id"];
    req.correlationId = typeof incoming === "string" && CORRELATION_ID.test(incoming) ? incoming : randomUUID();
    reply.header("x-correlation-id", req.correlationId);
  });

  const fail = (req: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string) =>
    reply.status(status).send({ code, message, correlation_id: req.correlationId });

  app.addHook("onResponse", async (req, reply) => {
    logger.info("request_completed", {
      correlation_id: req.correlationId,
      method: req.method,
      path: req.routeOptions.url ?? req.url.split("?")[0],
      status_code: reply.statusCode,
      duration_ms: Math.round(reply.elapsedTime),
    });
  });

  app.setErrorHandler((err: { statusCode?: number; message?: string }, req, reply) => {
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return fail(req, reply, err.statusCode, "INVALID_BODY", "Request body could not be parsed");
    }
    logger.error("request_failed", { correlation_id: req.correlationId, error: err.message });
    return fail(req, reply, 500, "INTERNAL_ERROR", "Unexpected error");
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/v1/deposits", async (req, reply) => {
    const claims = await verifyBearer(req.headers.authorization, jwtSecret);
    if (!claims) return fail(req, reply, 401, "UNAUTHORIZED", "Missing or invalid bearer token");

    const key = req.headers["idempotency-key"];
    if (!isValidIdempotencyKey(key)) {
      return fail(req, reply, 400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key header must be 1-64 chars of A-Z, a-z, 0-9, _ or -");
    }

    const parsed = parseDepositRequest(req.body);
    if (!parsed.ok) {
      const first = parsed.issues[0]!;
      return fail(req, reply, 400, first.code, parsed.issues.map((i) => i.message).join("; "));
    }

    const result = await createDeposit(db, {
      tenantId: claims.tenantId,
      userId: claims.userId,
      idempotencyKey: key,
      correlationId: req.correlationId,
      request: parsed.value,
    });
    if (result.kind === "conflict") {
      return fail(req, reply, 409, "IDEMPOTENCY_KEY_CONFLICT", "Idempotency-Key was already used with a different request");
    }
    return reply.status(result.created ? 202 : 200).send({
      transaction_id: result.transactionId,
      status: result.status,
      created: result.created,
      correlation_id: req.correlationId,
    });
  });

  return app;
}
