import { useState } from "react";
import { DEFAULT_AMOUNT_IN } from "@latch/client";
import { Button, Chip, Eyebrow, Panel } from "@/components/ui";
import { Policy, type Bounds } from "@/app/state";
import { formatAmount, formatBps, formatSeconds, parseAmount } from "@/core/format";
import { AmountInput } from "./AmountInput";
import { BoundsEditor } from "./BoundsEditor";
import { DEMO_PAIR, TOKEN_PAIRS, TokenSelector } from "./TokenSelector";
import { PolicyToggle } from "./PolicyToggle";
import { SlippageControl } from "./SlippageControl";
import "./builder.css";

export interface IntentBuilderProps {
  readonly bounds: Bounds;
  readonly policy: readonly Policy[];
  readonly onBoundsChange: (bounds: Bounds) => void;
  readonly onPolicyChange: (index: number, policy: Policy) => void;
  /** Build the batch from the current intent. Implementations dispatch `build/ready`. */
  readonly onBuild: () => void;
  readonly busy?: boolean;
}

/**
 * The intent configuration panel. It owns no batch state: bounds and policy go out through
 * `onBoundsChange` / `onPolicyChange` and come back as props, so there is exactly one copy of the
 * intent and anything that edits it invalidates the simulation upstream.
 *
 * Two rules are structural rather than cosmetic:
 *   D5 — slippage is presets only, never a free-text field, and the chosen number is always visible.
 *   D6 — `REVERT_BATCH` is the default; `SKIP_CALL` requires an inline confirmation that names
 *        what is skipped and what breaking the provenance invariant costs.
 */
export function IntentBuilder({
  bounds,
  policy,
  onBoundsChange,
  onPolicyChange,
  onBuild,
  busy = false,
}: IntentBuilderProps) {
  const [pairId, setPairId] = useState(DEMO_PAIR.id);
  const [amount, setAmount] = useState(() =>
    formatAmount(DEFAULT_AMOUNT_IN, DEMO_PAIR.from.decimals),
  );

  const pair = TOKEN_PAIRS.find((candidate) => candidate.id === pairId) ?? DEMO_PAIR;
  const amountRaw = parseAmount(amount, pair.from.decimals);
  const amountValid = amountRaw !== null && amountRaw > 0n;
  const skipCount = policy.filter((entry) => entry === Policy.SkipCall).length;

  const summary = [
    amountValid
      ? `${formatAmount(amountRaw, pair.from.decimals)} ${pair.from.symbol} → ${pair.to.symbol}`
      : `${pair.from.symbol} → ${pair.to.symbol} · amount not set`,
    `slippage ${formatBps(bounds.slippageBps)}`,
    `freshness ${formatSeconds(bounds.maxStalenessSec)}`,
    `band ${formatBps(bounds.priceBandBps)}`,
    policy.length === 0
      ? "no segments yet"
      : `${skipCount} of ${policy.length} segments opted out of atomicity`,
  ].join(" · ");

  return (
    <Panel
      title="Intent"
      tone="acid"
      className="b-panel"
      aside={<Chip tone="ink">{formatBps(bounds.slippageBps)}</Chip>}
    >
      <div className="b-builder">
        <section className="b-block" aria-label="Route">
          <Eyebrow tone="muted">Route</Eyebrow>
          <div className="b-route">
            <TokenSelector value={pairId} onChange={setPairId} />
            <AmountInput
              symbol={pair.from.symbol}
              decimals={pair.from.decimals}
              value={amount}
              onChange={setAmount}
            />
          </div>
        </section>

        <section className="b-block" aria-label="Slippage">
          <Eyebrow tone="muted">Slippage · presets only</Eyebrow>
          <SlippageControl
            value={bounds.slippageBps}
            onChange={(slippageBps) => onBoundsChange({ ...bounds, slippageBps })}
          />
        </section>

        <section className="b-block" aria-label="Bounds">
          <Eyebrow tone="muted">Bounds</Eyebrow>
          <BoundsEditor bounds={bounds} onChange={onBoundsChange} />
        </section>

        <section className="b-block" aria-label="Failure policy">
          <Eyebrow tone="muted">Failure policy · per segment</Eyebrow>
          <PolicyToggle policy={policy} onChange={onPolicyChange} />
        </section>

        <div className="b-build">
          <Button variant="acid" size="lg" block onClick={onBuild} disabled={busy}>
            {busy ? "Building…" : "Build batch"}
          </Button>
          <p className="b-summary ui-mono">{summary}</p>
        </div>
      </div>
    </Panel>
  );
}
