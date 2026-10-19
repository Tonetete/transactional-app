import type { SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { options: readonly string[]; invalid?: boolean };

export function Select({ options, invalid, style, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || undefined}
      style={{
        width: "100%",
        padding: "var(--space-2)",
        borderRadius: "var(--radius)",
        border: `1px solid ${invalid ? "var(--color-danger)" : "var(--color-border)"}`,
        font: "inherit",
        background: "var(--color-surface)",
        ...style,
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
