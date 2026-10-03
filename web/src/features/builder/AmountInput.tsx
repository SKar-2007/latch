import { Alert, Field, fieldControlClass } from "@/components/ui";
import { formatAmount, parseAmount } from "@/core/format";

export interface AmountInputProps {
  readonly symbol: string;
  readonly decimals: number;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/**
 * Amount on the input leg. Valid is "a positive decimal that parses to base units" — `parseAmount`
 * returns null rather than coercing, so `0.0.1` and an empty field both stop here instead of
 * reaching the batch.
 */
export function AmountInput({ symbol, decimals, value, onChange }: AmountInputProps) {
  const parsed = parseAmount(value, decimals);
  const invalid = parsed === null || parsed === 0n;

  return (
    <div className="b-amount">
      <Field
        label={`Amount in (${symbol})`}
        htmlFor="intent-amount"
        hint={
          <span className="ui-mono">
            {symbol} · {decimals} decimals
          </span>
        }
      >
        <input
          id="intent-amount"
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          className={fieldControlClass("b-amount__input")}
          value={value}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </Field>
      {invalid ? (
        <Alert tone="warn" title="Amount not usable">
          Enter a positive decimal amount of {symbol}, at most {decimals} decimal places.
        </Alert>
      ) : (
        <p className="b-readout">
          <span className="b-readout__label">In base units</span>
          <span className="ui-mono">
            {formatAmount(parsed, decimals)} {symbol} = {parsed.toString()}
          </span>
        </p>
      )}
    </div>
  );
}
