import { Eyebrow, Field } from "@/components/ui";
import { formatBps } from "@/core/format";

export interface SlippagePreset {
  readonly slippageBps: number;
  /** The pair type this number was published for (docs/06, Biconomy's guidance table). */
  readonly pairType: string;
  /** One line on why the number exists, so the choice is not a bare digit. */
  readonly rationale: string;
}

/**
 * D5. Presets only — there is no input element of any editable kind in this component, and there
 * never will be. A free-text field is a foot-gun in both directions: `0.1` loses a trade to
 * ordinary price impact, `50` disables the guard while the UI still shows green ticks.
 */
export const SLIPPAGE_PRESETS: readonly SlippagePreset[] = [
  {
    slippageBps: 50,
    pairType: "Stable to stable",
    rationale: "Both legs track the same dollar; pool fee and rounding are the only drift.",
  },
  {
    slippageBps: 100,
    pairType: "Stable to volatile",
    rationale: "One volatile leg: ordinary price impact lands between quote and fill.",
  },
  {
    slippageBps: 300,
    pairType: "Volatile to volatile, long bridge",
    rationale: "Two volatile legs plus bridge latency would fail a tighter bound.",
  },
  {
    slippageBps: 200,
    pairType: "Complex multi-chain rebalancing",
    rationale: "Hops compound; this is the middle of the published 2–3% range.",
  },
];

export interface SlippageControlProps {
  readonly value: number;
  readonly onChange: (slippageBps: number) => void;
}

/**
 * A row of hard-edged selectable blocks — active is acid fill behind a black keyline. Each block is
 * a radio with its own `Field` label, so the group is arrow-key navigable and the chosen number is
 * always on screen, both in the block and in the implied bound underneath.
 */
export function SlippageControl({ value, onChange }: SlippageControlProps) {
  const active = SLIPPAGE_PRESETS.find((preset) => preset.slippageBps === value);

  return (
    <div className="b-slippage" role="group" aria-label="Slippage tolerance">
      <div className="b-presets">
        {SLIPPAGE_PRESETS.map((preset) => {
          const id = `intent-slippage-${preset.slippageBps}`;
          const selected = preset.slippageBps === value;
          return (
            <div
              key={preset.slippageBps}
              className={selected ? "b-preset b-preset--on" : "b-preset"}
            >
              <Field label={preset.pairType} htmlFor={id} hint={preset.rationale}>
                <span className="b-preset__value">
                  <input
                    type="radio"
                    id={id}
                    name="intent-slippage"
                    className="b-preset__input"
                    checked={selected}
                    onChange={() => onChange(preset.slippageBps)}
                  />
                  <span className="ui-mono b-preset__pct">{formatBps(preset.slippageBps)}</span>
                </span>
              </Field>
            </div>
          );
        })}
      </div>
      <div className="b-implied">
        <Eyebrow tone="muted">Implied bound</Eyebrow>
        <span className="ui-mono">min output ≥ quote × (1 − {formatBps(value)})</span>
        <span className="b-implied__note">
          {active !== undefined
            ? `${active.pairType} tolerance. `
            : "Bounded by the presets above. "}
          No quote exists yet — verification item V-23 is open — so the floor below is entered by
          hand rather than quoted.
        </span>
      </div>
    </div>
  );
}
