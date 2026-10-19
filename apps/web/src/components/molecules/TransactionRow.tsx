import type { DepositListItem } from "@acex/shared";
import { formatMoney, formatTimestamp } from "@/lib/format";
import { StatusBadge } from "../atoms";

export function TransactionRow({ item }: { item: DepositListItem }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-1) var(--space-3)", padding: "var(--space-3) 0", borderBottom: "1px solid var(--color-border)" }}>
      <strong>{formatMoney(item.amount_cents, item.currency)}</strong>
      <StatusBadge status={item.status} />
      <small style={{ color: "var(--color-muted)" }}>{formatTimestamp(item.created_at)}</small>
      <small style={{ color: "var(--color-muted)" }}>{item.transaction_id}</small>
    </li>
  );
}
