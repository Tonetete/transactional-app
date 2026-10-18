import { SignJWT } from "jose";

export const TEST_JWT_SECRET = "test-secret-test-secret-test-secret-123";

export function token(tenantId: string, userId: string, secret = TEST_JWT_SECRET): Promise<string> {
  return new SignJWT({ tenant_id: tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}
