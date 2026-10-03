import { Chip, MonoValue } from "@/components/ui";
import { CHAIN_ID, CHAIN_NAME } from "@/core/addresses";
import type { Phase } from "@/app/state";

export interface SiteHeaderProps {
  /** The live machine phase. Displayed as-is; the shell never keeps a second copy of it. */
  readonly phase: Phase;
}

/**
 * Sticky chrome: brand, tagline, section nav, and the two status chips an operator checks before
 * touching anything.
 *
 * `ConnectWallet` is deliberately not here. It is a panel that owns account, chain and module
 * state, so it sits in the left column of the workbench where the rest of the panels live — a
 * wallet prompt is not a navigation item.
 */
export function SiteHeader({ phase }: SiteHeaderProps) {
  return (
    <header className="app-header">
      <div className="page app-header__inner">
        <a className="app-brand" href="/">
          <span className="app-mark" aria-hidden="true">
            L
          </span>
          <span className="app-wordmark">LATCH</span>
        </a>
        <span className="app-tagline">sign a plan, not a guess</span>

        <nav className="app-nav" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#workbench">Workbench</a>
          <a href="#limits">Limits</a>
        </nav>

        <div className="row app-status">
          <Chip tone="sunken">
            {CHAIN_NAME} · <MonoValue value={String(CHAIN_ID)} />
          </Chip>
          <Chip tone="acid">
            <MonoValue value={phase} />
          </Chip>
        </div>
      </div>
    </header>
  );
}
