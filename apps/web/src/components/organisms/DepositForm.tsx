"use client";

import { parseDepositRequest, type DepositIssueCode, type DepositRequest } from "@acex/shared";
import { useState, type FormEvent } from "react";
import { parseAmountToCents } from "@/lib/format";
import { Alert, Button, Input, Select } from "../atoms";
import { FormField } from "../molecules";

export type DepositSubmitResult =
  | { ok: true; message: string }
  | { ok: false; code: string; message: string; correlationId?: string };

type Field = "amount" | "currency" | "iban" | "holder";
const FIELD_OF: Record<DepositIssueCode, Field | undefined> = {
  INVALID_AMOUNT: "amount",
  AMOUNT_EXCEEDS_LIMIT: "amount",
  INVALID_CURRENCY: "currency",
  INVALID_IBAN: "iban",
  INVALID_ACCOUNT_HOLDER: "holder",
  INVALID_BODY: undefined,
};

export function DepositForm({
  onSubmit,
  currencies = ["USD", "EUR", "GBP"],
}: {
  onSubmit: (request: DepositRequest) => Promise<DepositSubmitResult>;
  currencies?: readonly string[];
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [result, setResult] = useState<DepositSubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    const cents = parseAmountToCents(amount);
    const parsed = parseDepositRequest({
      amount_cents: cents ?? 0, // 0 makes the shared rule report INVALID_AMOUNT for unparseable input
      currency,
      source_account: { holder_name: holder, iban },
    });
    if (!parsed.ok) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.issues) {
        const field = FIELD_OF[issue.code];
        if (field && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await onSubmit(parsed.value);
      setResult(res);
      if (res.ok) {
        setAmount("");
        setHolder("");
        setIban("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-labelledby="deposit-title">
      <h2 id="deposit-title">New deposit</h2>
      <FormField id="amount" label="Amount" error={errors.amount}>
        {(a) => <Input {...a} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </FormField>
      <FormField id="currency" label="Currency" error={errors.currency}>
        {(a) => <Select {...a} options={currencies} value={currency} onChange={(e) => setCurrency(e.target.value)} />}
      </FormField>
      <FormField id="holder" label="Account holder" error={errors.holder}>
        {(a) => <Input {...a} value={holder} onChange={(e) => setHolder(e.target.value)} />}
      </FormField>
      <FormField id="iban" label="IBAN" error={errors.iban}>
        {(a) => <Input {...a} value={iban} onChange={(e) => setIban(e.target.value)} />}
      </FormField>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Request deposit"}
      </Button>
      {result ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          {result.ok ? (
            <Alert tone="success">{result.message}</Alert>
          ) : (
            <Alert tone="error">
              {result.code}: {result.message}
              {result.correlationId ? ` (ref ${result.correlationId})` : ""}
            </Alert>
          )}
        </div>
      ) : null}
    </form>
  );
}
