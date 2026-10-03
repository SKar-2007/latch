import { useEffect, useState } from "react";
import { Alert, Field, fieldControlClass, MonoValue } from "@/components/ui";
import type { Bounds } from "@/app/state";
import { formatAmount, formatBps, formatSeconds, parseAmount } from "@/core/format";

/** The only freshness values this control offers. A stale oracle read is a wrong constraint. */
export const STALENESS_OPTIONS: readonly number[] = [60, 300, 600, 1200, 3600];

/** Price band bounds, in basis points. The slider cannot leave this range. */
export const PRICE_BAND_MIN = 0;
export const PRICE_BAND_MAX = 1000;
export const PRICE_BAND_STEP = 5;

export interface BoundsEditorProps {
  readonly bounds: Bounds;
  readonly onChange: (bounds: Bounds) => void;
}

/**
 * Three bounded numeric controls. Nothing here accepts an arbitrary value: the band is a slider
 * clamped to a range, staleness is a stepped picker over five values, and the minimum output is
 * parsed by `parseAmount`, which returns null instead of coercing a malformed bound.
 */
export function BoundsEditor({ bounds, onChange }: BoundsEditorProps) {
  const patch = (partial: Partial<Bounds>): void => onChange({ ...bounds, ...partial });

  const [minOutputText, setMinOutputText] = useState(bounds.minOutput);
  useEffect(() => {
    setMinOutputText(bounds.minOutput);
  }, [bounds.minOutput]);

  const typed = parseAmount(minOutputText, 18);
  const typedInvalid = typed === null || typed === 0n;
  const committed = parseAmount(bounds.minOutput, 18) ?? 0n;

  return (
    <div className="b-bounds">
      <Field
        label="Minimum output (WETH)"
        htmlFor="intent-min-output"
        hint="Entered by you, not quoted: QuoterGuard cannot quote on Base Sepolia yet, so verification item V-23 stays open until it can."
      >
        <input
          id="intent-min-output"
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          className={fieldControlClass("b-bounds__input")}
          value={minOutputText}
          aria-invalid={typedInvalid}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setMinOutputText(next);
            const parsed = parseAmount(next, 18);
            if (parsed !== null && parsed > 0n) patch({ minOutput: next });
          }}
        />
      </Field>
      {typedInvalid ? (
        <Alert tone="warn" title="Minimum output not usable">
          Enter a positive decimal amount of WETH, at most 18 decimal places.
        </Alert>
      ) : (
        <p className="b-readout">
          <span className="b-readout__label">Minimum output</span>
          <MonoValue value={formatAmount(parseAmount(bounds.minOutput, 18) ?? 0n, 18)} />
          <span className="ui-mono">WETH</span>
          <span className="b-readout__label">Base units</span>
          <MonoValue value={committed.toString()} />
        </p>
      )}

      <Field
        label="Price band"
        htmlFor="intent-price-band"
        hint="Acceptable deviation from the observed rate, in basis points. Bounded 0–10.00%."
      >
        <span className="b-slider">
          <input
            id="intent-price-band"
            type="range"
            className="b-slider__input"
            min={PRICE_BAND_MIN}
            max={PRICE_BAND_MAX}
            step={PRICE_BAND_STEP}
            value={bounds.priceBandBps}
            onChange={(event) => patch({ priceBandBps: Number(event.currentTarget.value) })}
          />
          <MonoValue value={formatBps(bounds.priceBandBps)} />
        </span>
      </Field>

      <Field
        label="Max staleness"
        htmlFor="intent-staleness"
        hint="Should follow the feed's published heartbeat. Chainlink ETH/USD on Base Sepolia is 1200s."
      >
        <span className="b-stepper">
          <select
            id="intent-staleness"
            className={fieldControlClass("b-stepper__select")}
            value={String(bounds.maxStalenessSec)}
            onChange={(event) => patch({ maxStalenessSec: Number(event.currentTarget.value) })}
          >
            {STALENESS_OPTIONS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {formatSeconds(seconds)}
              </option>
            ))}
          </select>
          <MonoValue value={formatSeconds(bounds.maxStalenessSec)} />
        </span>
      </Field>
    </div>
  );
}
