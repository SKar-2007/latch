import { Chip, Field, fieldControlClass } from "@/components/ui";

export interface TokenPair {
  readonly id: string;
  readonly chain: string;
  readonly chainId: number;
  readonly from: { readonly symbol: string; readonly decimals: number };
  readonly to: { readonly symbol: string; readonly decimals: number };
}

/**
 * The demo route. Pinned configuration, not a discovery result: USDC and WETH on Base Sepolia are
 * the pair the client's `buildDemoBatch` builds for, and the decimals are the tokens' own.
 */
export const DEMO_PAIR: TokenPair = {
  id: "usdc-weth",
  chain: "Base Sepolia",
  chainId: 84532,
  from: { symbol: "USDC", decimals: 6 },
  to: { symbol: "WETH", decimals: 18 },
};

/** Every pair the builder may offer. An unlisted pair is not configured, so it is not selectable. */
export const TOKEN_PAIRS: readonly TokenPair[] = [DEMO_PAIR];

export interface TokenSelectorProps {
  readonly value: string;
  readonly onChange: (pairId: string) => void;
}

/** Route picker. The demo pair is preselected; symbols and decimals are shown, never assumed. */
export function TokenSelector({ value, onChange }: TokenSelectorProps) {
  const pair = TOKEN_PAIRS.find((candidate) => candidate.id === value) ?? DEMO_PAIR;

  return (
    <div className="b-pair">
      <Field
        label="Pair"
        htmlFor="intent-pair"
        hint={`${pair.chain} · chain ${pair.chainId} · demo pair, preselected`}
      >
        <select
          id="intent-pair"
          className={fieldControlClass("b-pair__select")}
          value={pair.id}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {TOKEN_PAIRS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.from.symbol} → {candidate.to.symbol}
            </option>
          ))}
        </select>
      </Field>
      <p className="b-pair__detail">
        <Chip tone="acid">{pair.from.symbol}</Chip>
        <span className="ui-mono">{pair.from.decimals} decimals</span>
        <span className="b-pair__arrow" aria-hidden="true">
          →
        </span>
        <Chip tone="sky">{pair.to.symbol}</Chip>
        <span className="ui-mono">{pair.to.decimals} decimals</span>
      </p>
    </div>
  );
}
