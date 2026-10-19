import type { ReactNode } from "react";

/** Two-slot layout: the action (form) beside the live feed (list). Knows nothing about their content. */
export function DashboardTemplate({ header, form, list }: { header: ReactNode; form: ReactNode; list: ReactNode }) {
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "var(--space-4)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>{header}</header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-4)" }}>
        <div style={{ background: "var(--color-surface)", padding: "var(--space-4)", borderRadius: "var(--radius)" }}>{form}</div>
        <div style={{ background: "var(--color-surface)", padding: "var(--space-4)", borderRadius: "var(--radius)" }}>{list}</div>
      </div>
    </main>
  );
}
