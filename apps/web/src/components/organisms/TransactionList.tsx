import type { DepositListItem } from "@acex/shared";
import { TransactionRow } from "../molecules";

export function TransactionList({ items, loading = false }: { items: readonly DepositListItem[]; loading?: boolean }) {
  return (
    <section aria-labelledby="transactions-title">
      <h2 id="transactions-title">Transactions</h2>
      {loading && items.length === 0 ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p>No transactions yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((item) => (
            <TransactionRow key={item.transaction_id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
