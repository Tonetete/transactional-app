import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

type Env = Record<string, string | undefined>;

/**
 * Lambda cannot inject secrets natively, so it reads the role credentials at cold start from the
 * secret named by `${prefix}_SECRET_ARN` and exposes them as `${prefix}_USER` / `${prefix}_PASSWORD`
 * for resolveDatabaseUrl. A no-op when the variable is absent (local development).
 */
export async function loadDbCredentials(
  env: Env,
  client: Pick<SecretsManagerClient, "send"> = new SecretsManagerClient({}),
  prefix = "DB",
): Promise<void> {
  const arn = env[`${prefix}_SECRET_ARN`];
  if (!arn) return;
  const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  const secret = JSON.parse(res.SecretString ?? "{}") as { username?: string; password?: string };
  if (!secret.username || !secret.password) throw new Error(`Secret ${arn} must contain username and password`);
  env[`${prefix}_USER`] = secret.username;
  env[`${prefix}_PASSWORD`] = secret.password;
}
