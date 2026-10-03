import { Alert, Button, Chip, Eyebrow, MonoValue, Panel } from "@/components/ui";
import { useApp } from "@/app/AppProvider";
import { CHAIN_ID, CHAIN_NAME, COMPOSABILITY_MODULE } from "@/core/addresses";
import { INTENT_NAME, INTENT_VERSION } from "@/core/intent";
import { useExecution } from "./useExecution";
import "./execute.css";

/**
 * The signature step. Seat F.
 *
 * This component renders; `useExecution` decides. Rule D8 is the reason it is more than a button:
 *
 * > The EIP-712 intent is presentation, expiry and replay scoping. The **transaction signature is
 * > the trust root**; the batch that executes is the batch the account's own signature commits to,
 * > and the intent is discarded if they disagree.
 *
 * So the panel states two signatures and names which one carries authority. What the user is about
 * to sign — domain, batch hash, expiry — is on screen before the wallet asks for it, and the active
 * execution path is named next to the button so nobody reads a raw, self-funded submission as a
 * sponsored one.
 *
 * Gating is unchanged in substance: a signature is offered only from a preview whose simulation
 * passed, on the right chain, with a wallet connected and an account that can run the batch. Every
 * missing condition is listed rather than silently disabling the control.
 */

export interface SignButtonProps {
  /** Overrides "now" when the intent's expiry is computed. */
  readonly nowSeconds?: number;
}

export function SignButton({ nowSeconds }: SignButtonProps = {}) {
  const { phase } = useApp();
  const { path, blockers, ready, busy, record, validUntil, batchHash, run } = useExecution({
    ...(nowSeconds !== undefined ? { nowSeconds } : {}),
  });

  const buttonLabel = busy
    ? phase === "submitting"
      ? "Waiting for the receipt…"
      : "Waiting for the wallet…"
    : "Sign intent and submit batch";

  return (
    <Panel
      title="Sign"
      tone={ready ? "latch" : "sunken"}
      aside={<Chip tone={ready ? "acid" : "sunken"}>{ready ? "ready" : "blocked"}</Chip>}
      className="f-panel"
      data-testid="sign-panel"
    >
      <div className="f-sign">
        <Eyebrow tone="muted">Two signatures, one authority</Eyebrow>
        <ol className="f-authority">
          <li>
            The <strong>intent</strong> is what the wallet shows you: a readable description of this
            batch, bound to this chain and this account, with an expiry. It is presentation, expiry
            and replay scoping — it carries no authority.
          </li>
          <li>
            The <strong>transaction signature</strong> is the trust root. It covers the calldata,
            the calldata contains the batch, and the batch contains every target and every
            constraint. Nothing executes without it.
          </li>
        </ol>

        <div className="f-path">
          <Eyebrow tone="muted">Execution path</Eyebrow>
          <div className="f-row">
            <Chip tone="ink">{path.id}</Chip>
            <span className="f-path__label">{path.label}</span>
            {!path.sponsored && <Chip tone="sunken">not sponsored</Chip>}
          </div>
          <p className="f-note">{path.description}</p>
        </div>

        {batchHash !== null && (
          <div className="f-digest">
            <Eyebrow tone="muted">Intent you would sign</Eyebrow>
            <code className="f-digest__domain">
              {INTENT_NAME} v{INTENT_VERSION} · chain {CHAIN_ID} · account-bound · module{" "}
              {COMPOSABILITY_MODULE}
            </code>
            <MonoValue value={batchHash} truncate={false} muted />
            <div className="f-row">
              <Chip tone="ink">validUntil {validUntil}</Chip>
              <Chip tone="ink">nonce 0</Chip>
            </div>
            <p className="f-note">
              The hash covers the encoded batch, not a summary of it, so what is signed and what is
              sent cannot drift apart.
            </p>
          </div>
        )}

        {blockers.length > 0 && (
          <Alert tone="warn" title="Not ready to sign">
            <ul className="f-blockers">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        )}

        <Button
          variant="acid"
          size="lg"
          block
          disabled={!ready || busy}
          aria-busy={busy}
          data-testid="sign-button"
          onClick={() => void run()}
        >
          {buttonLabel}
        </Button>

        <p className="f-note">
          {record.intentStatus === "signed"
            ? "The intent is signed. The transaction signature is what executes it."
            : "Signing the intent does not authorise the batch. Only the transaction signature does."}{" "}
          {blockers.length === 0 && `Every gate has been answered against ${CHAIN_NAME} in this preview.`}
        </p>
      </div>
    </Panel>
  );
}