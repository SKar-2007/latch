import { useCallback, useMemo, useState } from "react";
import { Alert, Button, Chip, Eyebrow, Panel } from "@/components/ui";
import { useApp, useDispatch } from "@/app/AppProvider";
import { EXPECTED_CHAIN_ID, isExpectedChain } from "@/core/chain";
import {
  buildIntent,
  intentDigest,
  isExpired,
  reconcile,
  supportsNativeComposable,
  type LatchIntent,
  type Reconciliation,
} from "@/core/intent";
import type { ComposableExecution, Hex } from "@latch/client";
import "./execute.css";

/**
 * Signature step. Seat F.
 *
 * Rule D8 is the reason this component is more than a button:
 *
 * > The EIP-712 intent is presentation, expiry and replay scoping. The **UserOp signature is the
 * > trust root**; the relayer submits the batch derived from the UserOp and discards the intent if
 * > they disagree.
 *
 * So what the user signs is not the batch, and the UI must not imply otherwise. Two signatures exist
 * and they are not interchangeable:
 *
 *   - the **intent**, an off-chain EIP-712 authorisation. Readable, expiring, replay-scoped. It is what
 *     the user is shown and what a relayer checks. It carries no authority.
 *   - the **UserOp**, signed by the account. This is the trust root. The batch that executes is
 *     decoded from its calldata, and the intent is only ever a description of it.
 *
 * The component's job is to keep that distinction visible: it shows the intent digest, shows the
 * reconciliation verdict, and when the two disagree it says the intent was discarded and the UserOp
 * stands. It never presents a green path that depends on the intent being honoured.
 */

/** How long an intent stays valid. Long enough to read, short enough to matter. */
const DEFAULT_TTL_SECONDS = 15 * 60;

export interface SignButtonProps {
  /** Supplies the signed UserOp. Absent in a build with no bundler wired up. */
  readonly buildUserOp?: (intent: LatchIntent) => Promise<Hex>;
  readonly nowSeconds?: number;
}

export function SignButton({ buildUserOp, nowSeconds }: SignButtonProps = {}) {
  const { phase, simulation, calls, policy, bounds, account, chainId, moduleInstalled } = useApp();
  const dispatch = useDispatch();

  const [deadline, setDeadline] = useState(() => Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS);
  const [nonce, setNonce] = useState(0n);
  const [verdict, setVerdict] = useState<Reconciliation | null>(null);
  const [busy, setBusy] = useState(false);

  // Signing is only offered from a preview that has just passed, on the right chain, with a module
  // that can actually compose. Each of those is a reason not to sign, and each is named.
  const blockers = useMemo(() => {
    const out: string[] = [];
    if (phase !== "previewing") out.push("Build and preview a batch first.");
    if (simulation === null) out.push("Run the simulation. It is the only place the gates are exercised.");
    else if (!simulation.ok) out.push("The last simulation failed. Fix the bound it named, then re-run.");
    if (account === null) out.push("Connect a wallet.");
    if (!isExpectedChain(chainId)) out.push(`Switch to chain ${EXPECTED_CHAIN_ID}. This wallet is on ${chainId}.`);
    if (moduleInstalled !== true) out.push("The account cannot run a batch yet.");
    return out;
  }, [phase, simulation, account, chainId, moduleInstalled]);

  const ready = blockers.length === 0;

  const onSign = useCallback(async () => {
    if (!ready || account === null) return;
    setBusy(true);
    setVerdict(null);
    dispatch({ type: "sign/start" });

    const intent = buildIntent({
      account,
      batch: calls,
      policy,
      bounds,
      deadline,
      nonce,
    });

    if (isExpired(intent, Math.floor(Date.now() / 1000))) {
      // An expired intent is refreshed rather than signed. Presenting a stale one and letting the
      // relayer refuse it would teach the user that expiry is somebody else's problem.
      setDeadline(Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS);
      setNonce((n) => n + 1n);
      dispatch({ type: "sign/rejected", message: "That intent had expired. A fresh one was prepared." });
      setBusy(false);
      return;
    }

    if (buildUserOp === undefined) {
      dispatch({
        type: "error/set",
        error: {
          code: "NO_BUNDLER",
          message:
            "No UserOp builder is configured, so there is nothing to sign against. The intent below is " +
            "what would be presented; the batch that executes always comes from the UserOp.",
        },
      });
      setBusy(false);
      return;
    }

    try {
      const userOpCallData = await buildUserOp(intent);
      const result = reconcile(intent, { callData: userOpCallData }, {
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      setVerdict(result);
      if (!result.ok) {
        dispatch({
          type: "error/set",
          error: { code: `INTENT_${result.reason.toUpperCase().replace(/-/g, "_")}`, message: result.detail },
        });
      }
    } catch (cause) {
      dispatch({
        type: "sign/rejected",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  }, [ready, account, calls, policy, bounds, deadline, nonce, buildUserOp, dispatch]);

  const intent =
    account === null
      ? null
      : buildIntent({ account, batch: calls, policy, bounds, deadline, nonce });

  return (
    <Panel
      title="Sign"
      tone={ready ? "latch" : "sunken"}
      aside={<Chip tone={ready ? "acid" : "sunken"}>{ready ? "ready" : "blocked"}</Chip>}
      className="f-panel"
    >
      <div className="f-sign">
        <Eyebrow tone="muted">Two signatures, not one authority</Eyebrow>
        <ol className="f-authority">
          <li>
            The <strong>intent</strong> is what you are shown: a readable description, with an expiry
            and a nonce. It carries no authority.
          </li>
          <li>
            The <strong>UserOp</strong> is signed by your account. It is the trust root. The batch that
            executes is decoded from it.
          </li>
        </ol>
        <p className="f-note">
          If the two disagree, the intent is discarded and the UserOp stands. The batch below is what
          the UserOp would have to contain for the intent to describe it.
        </p>

        {intent !== null && (
          <div className="f-digest">
            <Eyebrow tone="muted">Intent digest</Eyebrow>
            <code className="ui-mono">{intentDigest(intent)}</code>
            <div className="f-row">
              <Chip tone="ink">expires in {Math.max(0, deadline - Math.floor(Date.now() / 1000))}s</Chip>
              <Chip tone="ink">nonce {nonce.toString()}</Chip>
              {supportsNativeComposable(account ?? "") && <Chip tone="sky">native composable</Chip>}
            </div>
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

        {verdict !== null && !verdict.ok && (
          <Alert tone="block" title="Intent discarded">
            {verdict.detail}
          </Alert>
        )}

        <Button variant="acid" size="lg" block disabled={!ready || busy} onClick={() => void onSign()}>
          {busy ? "Signing…" : "Sign intent and build UserOp"}
        </Button>
        <p className="f-note">
          Signing the intent does not authorise the batch on its own. Only the UserOp does.
        </p>
      </div>
    </Panel>
  );
}

/** Kept for the barrel's type surface; the batch type is what a UserOp decodes to. */
export type { ComposableExecution };