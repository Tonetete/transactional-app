export interface Session {
  token: string;
  tenant_id: string;
  user_id: string;
}

const KEY = "acex.session";

export function loadSession(storage: Pick<Storage, "getItem"> = sessionStorage): Session | null {
  try {
    const raw = storage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Partial<Session>) : null;
    return s && typeof s.token === "string" && typeof s.tenant_id === "string" && typeof s.user_id === "string" ? (s as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session, storage: Pick<Storage, "setItem"> = sessionStorage): void {
  storage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  storage.removeItem(KEY);
}
