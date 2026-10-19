import type { ReactNode } from "react";

export function Alert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const color = tone === "error" ? "var(--color-danger)" : "var(--color-success)";
  return (
    <div role={tone === "error" ? "alert" : "status"} style={{ border: `1px solid ${color}`, color, borderRadius: "var(--radius)", padding: "var(--space-2) var(--space-3)" }}>
      {children}
    </div>
  );
}
