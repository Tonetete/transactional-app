import type { LabelHTMLAttributes } from "react";

export function Label({ style, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...rest} style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "var(--space-1)", ...style }} />;
}
