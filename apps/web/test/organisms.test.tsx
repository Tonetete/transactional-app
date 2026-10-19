import type { DepositListItem } from "@acex/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StatusBadge } from "@/components/atoms";
import { DepositForm, LoginForm, TransactionList } from "@/components/organisms";

const VALID_IBAN = "GB82WEST12345698765432";

async function fill(user: ReturnType<typeof userEvent.setup>, v: { amount?: string; holder?: string; iban?: string }) {
  if (v.amount) await user.type(screen.getByLabelText("Amount"), v.amount);
  if (v.holder) await user.type(screen.getByLabelText("Account holder"), v.holder);
  if (v.iban) await user.type(screen.getByLabelText("IBAN"), v.iban);
}

describe("StatusBadge", () => {
  it("shows the status", () => {
    render(<StatusBadge status="SETTLED" />);
    expect(screen.getByText("SETTLED")).toBeInTheDocument();
  });
});

describe("DepositForm (S1, S4)", () => {
  it("submits a contract-shaped request with integer cents and a normalized IBAN", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, message: "Deposit requested" });
    const user = userEvent.setup();
    render(<DepositForm onSubmit={onSubmit} />);
    await fill(user, { amount: "50,000.50", holder: " Jane Doe ", iban: "gb82 west 1234 5698 7654 32" });
    await user.click(screen.getByRole("button", { name: "Request deposit" }));
    expect(onSubmit).toHaveBeenCalledWith({
      amount_cents: 5_000_050,
      currency: "USD",
      source_account: { holder_name: "Jane Doe", iban: VALID_IBAN },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Deposit requested");
    expect(screen.getByLabelText("Amount")).toHaveValue("");
  });

  it("shows per-field errors and does not call onSubmit for invalid input", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<DepositForm onSubmit={onSubmit} />);
    await fill(user, { amount: "abc", holder: "", iban: "GB00BAD" });
    await user.click(screen.getByRole("button", { name: "Request deposit" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("amount_cents must be a positive integer")).toBeInTheDocument();
    expect(screen.getByText("source_account.iban is not a valid IBAN")).toBeInTheDocument();
    expect(screen.getByText("source_account.holder_name must be 1-140 characters")).toBeInTheDocument();
    expect(screen.getByLabelText("IBAN")).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects amounts above the contract limit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<DepositForm onSubmit={onSubmit} />);
    await fill(user, { amount: "1000000.01", holder: "Jane", iban: VALID_IBAN });
    await user.click(screen.getByRole("button", { name: "Request deposit" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/must not exceed 100000000/)).toBeInTheDocument();
  });

  it("surfaces an API error with code, message and correlation id, keeping the typed values", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, code: "IDEMPOTENCY_KEY_CONFLICT", message: "key reused", correlationId: "corr-9" });
    const user = userEvent.setup();
    render(<DepositForm onSubmit={onSubmit} />);
    await fill(user, { amount: "10", holder: "Jane", iban: VALID_IBAN });
    await user.click(screen.getByRole("button", { name: "Request deposit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("IDEMPOTENCY_KEY_CONFLICT: key reused (ref corr-9)");
    expect(screen.getByLabelText("Amount")).toHaveValue("10");
  });
});

describe("TransactionList (S1)", () => {
  const items: DepositListItem[] = [
    { transaction_id: "txn_2", amount_cents: 2000, currency: "USD", status: "SETTLED", created_at: "2026-10-19T10:00:00.000Z" },
    { transaction_id: "txn_1", amount_cents: 1050, currency: "EUR", status: "PENDING", created_at: "2026-10-19T09:00:00.000Z" },
  ];

  it("renders each transaction in the given order with amount, status and id", () => {
    render(<TransactionList items={items} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("$20.00");
    expect(rows[0]).toHaveTextContent("SETTLED");
    expect(rows[0]).toHaveTextContent("txn_2");
    expect(rows[1]).toHaveTextContent("€10.50");
    expect(rows[1]).toHaveTextContent("PENDING");
  });

  it("shows an empty state, and a loading state only while nothing is loaded", () => {
    const { rerender } = render(<TransactionList items={[]} />);
    expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
    rerender(<TransactionList items={[]} loading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<TransactionList items={items} loading />);
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});

describe("LoginForm (S3)", () => {
  it("submits the entered tenant and user", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LoginForm onSubmit={onSubmit} />);
    await user.clear(screen.getByLabelText("Tenant"));
    await user.type(screen.getByLabelText("Tenant"), "tnt_x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSubmit).toHaveBeenCalledWith({ tenant_id: "tnt_x", user_id: "usr_demo" });
  });

  it("shows the failure message", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSubmit={async () => ({ ok: false, message: "Login unavailable" })} />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Login unavailable");
  });
});
