import type { ReactNode } from "react";
import { Label } from "../atoms";

/** Label + control + inline error. The control receives its id and aria wiring through the render prop. */
export function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: (a11y: { id: string; invalid: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, invalid: Boolean(error), "aria-describedby": error ? errorId : undefined })}
      {error ? (
        <div id={errorId} style={{ color: "var(--color-danger)", fontSize: "0.8125rem", marginTop: "var(--space-1)" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
