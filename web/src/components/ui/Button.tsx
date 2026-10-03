import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "acid" | "ink" | "danger" | "ghost" | "default";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly block?: boolean;
  readonly children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: "",
  acid: "ui-btn--acid",
  ink: "ui-btn--ink",
  danger: "ui-btn--danger",
  ghost: "ui-btn--ghost",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "ui-btn--sm",
  md: "",
  lg: "ui-btn--lg",
};

/**
 * The only button in the product. The press state translates into the shadow rather than
 * animating a colour, which is the mechanical feel the design direction asks for.
 */
export function Button({
  variant = "default",
  size = "md",
  block = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "ui-btn",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    block ? "ui-btn--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
