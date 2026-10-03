import { Panel, Eyebrow } from "@/components/ui";
import type { Bounds, Policy } from "@/app/state";

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
 * Wave 1, seat E owns this file.
 *
 * Stub: replace the body, keep the export name and props.
 *
 * Constraints from docs/06 that the real implementation must satisfy:
 * - `<SlippageControl>` is presets only. A free-text slippage field is a foot-gun in both
 *   directions — `0.1` loses to ordinary price impact, `50` disables the guard while the UI still
 *   shows green ticks. The preset's numeric value is always displayed.
 * - `<PolicyToggle>` defaults to `REVERT_BATCH` on every segment. Selecting `SKIP_CALL` opens a
 *   confirmation that names what will be skipped.
 * - `<BoundsEditor>` exposes min output, price band and max staleness as bounded numeric controls.
 */
export function IntentBuilder({ bounds, onBuild, busy }: IntentBuilderProps) {
  return (
    <Panel title="Intent" tone="default">
      <div className="stack">
        <Eyebrow tone="sky">Wave 1 · seat E</Eyebrow>
        <p>
          Bounds: slippage {bounds.slippageBps} bps, freshness {bounds.maxStalenessSec}s, band{" "}
          {bounds.priceBandBps} bps.
        </p>
        <button type="button" onClick={onBuild} disabled={busy}>
          Build batch
        </button>
      </div>
    </Panel>
  );
}
