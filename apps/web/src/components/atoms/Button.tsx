import type { ButtonHTMLAttributes } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

export function Button({ variant = "primary", style, ...rest }: ButtonProps) {
  const primary = variant === "primary";
  return (
    <button
      {...rest}
      style={{
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius)",
        border: primary ? "none" : "1px solid var(--color-border)",
        background: primary ? "var(--color-primary)" : "var(--color-surface)",
        color: primary ? "var(--color-primary-contrast)" : "var(--color-text)",
        cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? 0.6 : 1,
        font: "inherit",
        ...style,
      }}
    />
  );
}
