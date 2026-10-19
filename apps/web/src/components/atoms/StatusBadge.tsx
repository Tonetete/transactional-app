import type { TransactionStatus } from "@acex/shared";

const COLORS: Record<TransactionStatus, string> = {
  PENDING: "var(--color-warning)",
  PROCESSING: "var(--color-primary)",
  SETTLED: "var(--color-success)",
  FAILED: "var(--color-danger)",
};

export function StatusBadge({ status }: { status: TransactionStatus }) {
  return (
    <span style={{ color: COLORS[status], border: `1px solid ${COLORS[status]}`, borderRadius: 999, padding: "0 var(--space-2)", fontSize: "0.75rem", fontWeight: 700 }}>
      {status}
    </span>
  );
}
