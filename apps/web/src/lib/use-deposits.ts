"use client";

import type { DepositListItem } from "@acex/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ApiError } from "./api";

/** Loads the caller's deposits and keeps them fresh by polling; `refresh` forces an immediate reload. */
export function useDeposits(api: ApiClient, token: string, intervalMs = 3000, onUnauthorized?: () => void) {
  const [items, setItems] = useState<DepositListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const refresh = useCallback(async () => {
    const res = await api.listDeposits(token);
    if (res.ok) {
      setItems(res.value.items);
      setError(null);
    } else {
      setError(res.error);
      if (res.error.code === "UNAUTHORIZED") unauthorized.current?.();
    }
    setLoading(false);
  }, [api, token]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (!stopped) await refresh();
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [refresh, intervalMs]);

  return { items, loading, error, refresh };
}
