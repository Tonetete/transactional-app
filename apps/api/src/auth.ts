import { jwtVerify } from "jose";

export interface Claims {
  userId: string;
  tenantId: string;
}

/** Verifies an HS256 bearer token and extracts the verified user (sub) and tenant (tenant_id). */
export async function verifyBearer(header: string | undefined, secret: string): Promise<Claims | null> {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return null;
  try {
    const { payload } = await jwtVerify(match[1]!, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    const tenantId = payload.tenant_id;
    if (typeof payload.sub !== "string" || typeof tenantId !== "string" || !payload.sub || !tenantId) return null;
    return { userId: payload.sub, tenantId };
  } catch {
    return null;
  }
}
