type Env = Record<string, string | undefined>;

/**
 * Connection string for a database role. Locally it is one variable (`urlVar`); in AWS the pieces arrive
 * separately (host/port/name as plain env, user/password injected from Secrets Manager), so the password
 * never appears in a task definition. Composed URLs target RDS, which enforces TLS: `no-verify` encrypts the
 * connection without validating the server certificate (the RDS CA is not in Node's trust store; follow-up: ship the CA bundle). `prefix` selects the credentials: `DB` (app_user) or e.g. `RELAY_DB`.
 */
export function resolveDatabaseUrl(env: Env, urlVar: string, prefix = "DB"): string {
  const explicit = env[urlVar];
  if (explicit) return explicit;
  const host = env.DB_HOST;
  const port = env.DB_PORT;
  const name = env.DB_NAME;
  const user = env[`${prefix}_USER`];
  const password = env[`${prefix}_PASSWORD`];
  if (!host || !port || !name || !user || !password) {
    throw new Error(`Missing required env var ${urlVar} (or DB_HOST, DB_PORT, DB_NAME, ${prefix}_USER, ${prefix}_PASSWORD)`);
  }
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}?sslmode=no-verify`;
}
