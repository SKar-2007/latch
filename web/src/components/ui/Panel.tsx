import type { HTMLAttributes, ReactNode } from "react";

export type PanelTone = "default" | "acid" | "latch" | "sunken";

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly title?: ReactNode;
  /** Right-hand slot in the header bar: a count, a status chip, an action. */
  readonly aside?: ReactNode;
  readonly tone?: PanelTone;
  readonly flush?: boolean;
  readonly children?: ReactNode;
}

const HEADER_TONE_CLASS: Record<Exclude<PanelTone, "sunken">, string> = {
  default: "",
  acid: "ui-panel__header--acid",
  latch: "ui-panel__header--latch",
};

/**
 * The structural box: 3px border, zero radius, hard offset shadow. Almost every block of content in
 * LATCH sits in one of these, which is what makes the grid read as an assembled machine rather than
 * a page of cards.
 */
export function Panel({
  title,
  aside,
  tone = "default",
  flush = false,
  className,
  children,
  ...rest
}: PanelProps) {
  const panelClass = [
    "ui-panel",
    tone === "sunken" ? "ui-panel--sunken" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const headerClass = [
    "ui-panel__header",
    tone === "sunken" ? "" : HEADER_TONE_CLASS[tone],
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={panelClass} {...rest}>
      {(title !== undefined || aside !== undefined) && (
        <div className={headerClass}>
          <span>{title}</span>
          {aside !== undefined && <span>{aside}</span>}
        </div>
      )}
      <div className={flush ? "ui-panel__body ui-panel__body--tight" : "ui-panel__body"}>
        {children}
      </div>
    </div>
  );
}
