// Prints a dev JWT: pnpm --filter @acex/api dev:token <tenantId> <userId>
import { SignJWT } from "jose";

const [tenantId = "tnt_abc", userId = "usr_123"] = process.argv.slice(2);
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("Missing env var JWT_SECRET");
console.log(
  await new SignJWT({ tenant_id: tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("8h")
    .sign(new TextEncoder().encode(secret)),
);
