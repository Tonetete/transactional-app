import type { InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ invalid, style, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      style={{
        width: "100%",
        padding: "var(--space-2)",
        borderRadius: "var(--radius)",
        border: `1px solid ${invalid ? "var(--color-danger)" : "var(--color-border)"}`,
        font: "inherit",
        ...style,
      }}
    />
  );
}
