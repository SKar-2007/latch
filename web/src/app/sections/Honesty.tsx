import { Eyebrow } from "@/components/ui";

/**
 * docs/11 beat 6, on the landing page rather than only in the presenter's closing line.
 *
 * The product's claim is honesty, so the page states its own limits in the same voice as the
 * rest of the copy: short, specific, no hedging and no reassurance. Each item is something the
 * build actually does not do — not a disclaimer written to be skipped.
 */
export function Honesty() {
  return (
    <section className="app-limits" id="limits" aria-labelledby="limits-title">
      <div className="page app-limits__inner">
        <div className="app-section__head">
          <Eyebrow tone="ink">The honest limits</Eyebrow>
          <h2 id="limits-title">What LATCH does not do</h2>
        </div>

        <ul className="app-limits__list">
          <li className="app-limits__item">
            <Eyebrow tone="muted">Does not</Eyebrow>
            <p>
              <strong>Detect oracle manipulation.</strong> A fresh price inside the band passes
              every on-chain check, ERC-8211's and ours. Detecting that needs off-chain monitoring.
            </p>
          </li>
          <li className="app-limits__item">
            <Eyebrow tone="muted">Does not</Eyebrow>
            <p>
              <strong>Park a failed batch.</strong> A failed constraint reverts; it does not wait.
              A conditional batch still needs a relayer to trigger it.
            </p>
          </li>
          <li className="app-limits__item">
            <Eyebrow tone="latch">Ships disabled</Eyebrow>
            <p>
              <strong>Partial failure by default.</strong> Two of our three contracts are unaudited,
              and partial failure is the riskiest of them, so it stays off until they are reviewed.
            </p>
          </li>
        </ul>

        <p className="app-limits__close ui-mono">
          Base Sepolia · six steps · one signature · every value gated on-chain
        </p>
      </div>
    </section>
  );
}
