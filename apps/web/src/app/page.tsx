"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/atoms";
import { DepositForm, LoginForm, TransactionList } from "@/components/organisms";
import { CenteredTemplate, DashboardTemplate } from "@/components/templates";
import { createApiClient, type ApiClient } from "@/lib/api";
import { createIntentKeys } from "@/lib/idempotency";
import { clearSession, loadSession, saveSession, type Session } from "@/lib/session";
import { useDeposits } from "@/lib/use-deposits";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function HomePage() {
  const api = useMemo(() => createApiClient(API_URL), []);
  // Read after mount: sessionStorage does not exist during server rendering.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => setSession(loadSession()), []);
  if (session === undefined) return null;

  if (!session) {
    return (
      <CenteredTemplate>
        <LoginForm
          onSubmit={async (values) => {
            const res = await api.devLogin(values);
            if (!res.ok) return { ok: false, message: `${res.error.code}: ${res.error.message}` };
            const next = { token: res.value.token, tenant_id: res.value.tenant_id, user_id: res.value.user_id };
            saveSession(next);
            setSession(next);
            return { ok: true };
          }}
        />
      </CenteredTemplate>
    );
  }

  return (
    <Dashboard
      api={api}
      session={session}
      onSignOut={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}

function Dashboard({ api, session, onSignOut }: { api: ApiClient; session: Session; onSignOut: () => void }) {
  const keys = useMemo(() => createIntentKeys(), []);
  const { items, loading, error, refresh } = useDeposits(api, session.token, 3000, onSignOut);

  return (
    <DashboardTemplate
      header={
        <>
          <h1>ACEX Credit</h1>
          <span>
            {session.tenant_id} / {session.user_id}{" "}
            <Button variant="secondary" onClick={onSignOut}>
              Sign out
            </Button>
          </span>
        </>
      }
      form={
        <DepositForm
          onSubmit={async (request) => {
            const res = await api.createDeposit(session.token, keys.keyFor(request), request);
            if (!res.ok) return { ok: false, ...res.error };
            keys.resolved();
            void refresh();
            return {
              ok: true,
              message: res.value.created ? `Deposit ${res.value.transaction_id} requested (${res.value.status})` : `Deposit ${res.value.transaction_id} already existed (${res.value.status})`,
            };
          }}
        />
      }
      list={
        <>
          {error ? <p role="alert">Could not refresh transactions: {error.code}</p> : null}
          <TransactionList items={items} loading={loading} />
        </>
      }
    />
  );
}
