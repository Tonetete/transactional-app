"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Input } from "../atoms";
import { FormField } from "../molecules";

export interface LoginValues {
  tenant_id: string;
  user_id: string;
}

export function LoginForm({
  onSubmit,
  defaults = { tenant_id: "tnt_demo", user_id: "usr_demo" },
}: {
  onSubmit: (values: LoginValues) => Promise<{ ok: true } | { ok: false; message: string }>;
  defaults?: LoginValues;
}) {
  const [values, setValues] = useState(defaults);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await onSubmit(values);
      if (!res.ok) setError(res.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-labelledby="login-title">
      <h2 id="login-title">Sign in (simulated)</h2>
      <FormField id="tenant_id" label="Tenant">
        {(a) => <Input {...a} value={values.tenant_id} onChange={(e) => setValues({ ...values, tenant_id: e.target.value })} />}
      </FormField>
      <FormField id="user_id" label="User">
        {(a) => <Input {...a} value={values.user_id} onChange={(e) => setValues({ ...values, user_id: e.target.value })} />}
      </FormField>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
      {error ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </form>
  );
}
