import { describe, expect, it, vi } from "vitest";
import { loadDbCredentials } from "../src/db/secret.js";

const client = (secret: unknown) => ({ send: vi.fn().mockResolvedValue({ SecretString: JSON.stringify(secret) }) });

describe("loadDbCredentials", () => {
  it("reads username and password from the secret named by DB_SECRET_ARN into DB_USER / DB_PASSWORD", async () => {
    const env: Record<string, string | undefined> = { DB_SECRET_ARN: "arn:secret" };
    const c = client({ username: "app_user", password: "pw" });
    await loadDbCredentials(env, c);
    expect(env).toMatchObject({ DB_USER: "app_user", DB_PASSWORD: "pw" });
    expect(c.send.mock.calls[0]![0].input).toEqual({ SecretId: "arn:secret" });
  });

  it("does nothing when no secret ARN is configured (local development)", async () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: "postgres://x" };
    const c = client({});
    await loadDbCredentials(env, c);
    expect(c.send).not.toHaveBeenCalled();
    expect(env).toEqual({ DATABASE_URL: "postgres://x" });
  });

  it("fails clearly when the secret lacks username or password", async () => {
    await expect(loadDbCredentials({ DB_SECRET_ARN: "arn:s" }, client({ username: "u" }))).rejects.toThrow("Secret arn:s must contain username and password");
  });
});
