import type { ReactNode } from "react";

export interface FieldProps {
  readonly label: string;
  /** Associated with the control through `id`/`htmlFor`; required for screen readers. */
  readonly htmlFor: string;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}

export function Field({ label, htmlFor, hint, children }: FieldProps) {
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint !== undefined && <span className="ui-field__hint">{hint}</span>}
    </div>
  );
}

export interface FieldControlProps {
  readonly id: string;
  readonly className?: string;
}

/** Wrapper so an input, select or textarea gets the same control styling without forking it. */
export function fieldControlClass(className?: string): string {
  return ["ui-field__control", className ?? ""].filter(Boolean).join(" ");
}
