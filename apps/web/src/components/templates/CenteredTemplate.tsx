import type { ReactNode } from "react";

export function CenteredTemplate({ children }: { children: ReactNode }) {
  return (
    <main style={{ maxWidth: 420, margin: "10vh auto", padding: "var(--space-4)", background: "var(--color-surface)", borderRadius: "var(--radius)" }}>{children}</main>
  );
}
