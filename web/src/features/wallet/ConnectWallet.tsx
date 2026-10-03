import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Chip, Eyebrow, MonoValue, Panel } from "@/components/ui";
import { useApp, useDispatch } from "@/app/AppProvider";
import { COMPOSABILITY_MODULE } from "@/core/addresses";
import { EXPECTED_CHAIN_ID } from "@/core/chain";
import { formatBps } from "@/core/format";
import { injectedConnector, useAccountProbe, type AccountProbe, type Connector } from "./useAccountProbe";
import "./wallet.css";

/**
 * Session panel. Seat C.
 *
 * Three jobs, and one rule that outranks all of them: **never report something the chain has not
 * confirmed.** An account's composability support, a module's presence, a chain id — each is shown
 * only once it has been read, and "unknown" is a real state that renders as "unknown".
 *
 * The chain guard belongs here rather than in the execute seat because this is where the account and
 * the chain id first become known. A wallet pointed at the wrong network is blocked from signing with
 * a message naming the network it wanted, not a generic failure.
 */
export interface ConnectWalletProps {
  /** Overridable so a test or an alternative wallet can supply its own connector. */
  readonly connector?: Connector;
}

export function ConnectWallet({ connector = injectedConnector }: ConnectWalletProps = {}) {
  const { phase, account, chainId, moduleInstalled, bounds } = useApp();
  const dispatch = useDispatch();

  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { probe, checking, recheck } = useAccountProbe(account);

  const onExpectedChain = chainId === EXPECTED_CHAIN_ID;

  const connect = useCallback(async () => {
    setConnecting(true);
    setFailure(null);
    try {
      const next = await connector.connect();
      dispatch({ type: "wallet/connected", account: next.account, chainId: next.chainId });
    } catch (cause) {
      // A refused prompt or a locked wallet is an ordinary outcome, not an exception worth a stack.
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  }, [connector, dispatch]);

  // Chain and account changes pushed by the wallet, not polled for.
  useEffect(() => connector.watch(({ account: next, chainId: nextChainId }) => {
    if (next === null) {
      dispatch({ type: "wallet/disconnected" });
      return;
    }
    dispatch({ type: "wallet/connected", account: next, chainId: nextChainId });
  }), [connector, dispatch]);

  // Fold the probe into the machine. Only once it has concluded, and only ever with a conclusion --
  // `moduleInstalled` stays null while the check is in flight, because a panel that fills it in
  // optimistically is the exact thing this component is written to avoid.
  useEffect(() => {
    if (probe === null) return;
    const installed = probe.outcome === "native" || probe.outcome === "module-compatible";
    if (moduleInstalled === installed) return;
    dispatch({ type: "module/status", installed });
    if (!installed && phase === "connected") {
      dispatch({ type: "module/installed" });
    }
  }, [probe, moduleInstalled, phase, dispatch]);

  const canBuild = phase !== "disconnected" && onExpectedChain && moduleInstalled === true;

  return (
    <Panel
      title="Session"
      tone="latch"
      aside={<Chip tone="acid">{phase}</Chip>}
      className="w-panel"
    >
      <div className="w-session">
        <Eyebrow tone="muted">Account</Eyebrow>
        {account === null ? (
          <p className="w-note">No wallet connected.</p>
        ) : (
          <MonoValue value={account} large />
        )}

        <Eyebrow tone="muted">Chain</Eyebrow>
        <div className="w-row">
          <Chip tone={onExpectedChain ? "acid" : "sunken"}>chain {chainId}</Chip>
          <Chip tone="ink">expected {EXPECTED_CHAIN_ID}</Chip>
        </div>

        {!onExpectedChain && account !== null && (
          <Alert tone="warn" title="Wrong network">
            This wallet is on chain {chainId}. LATCH is deployed on chain {EXPECTED_CHAIN_ID}, and a batch
            signed here would not execute against the contracts this app has verified. Switch networks
            before building. Nothing has been signed.
          </Alert>
        )}

        <Eyebrow tone="muted">Composability</Eyebrow>
        <ComposabilityStatus probe={probe} checking={checking} onRecheck={recheck} />

        {failure !== null && (
          <Alert tone="block" title="Could not connect">
            {failure}
          </Alert>
        )}

        <div className="w-actions">
          {account === null ? (
            <Button variant="acid" onClick={() => void connect()} disabled={connecting || !connector.available}>
              {connecting ? "Waiting for wallet…" : "Connect wallet"}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => dispatch({ type: "wallet/disconnected" })}>
              Disconnect
            </Button>
          )}
          {canBuild && (
            <Chip tone="acid">
              ready · {formatBps(bounds.slippageBps)} tolerance
            </Chip>
          )}
        </div>

        {!connector.available && account === null && (
          <p className="w-note">
            No injected wallet was found. LATCH needs a browser wallet that exposes an EIP-1193 provider.
          </p>
        )}
      </div>
    </Panel>
  );
}

/**
 * The composability verdict.
 *
 * Separated because it is the one row that must never lie. Each outcome gets its own wording, and
 * `inconclusive` is rendered as inconclusive rather than folded into "missing" — telling someone to
 * install a module they already have is worse than saying nothing.
 */
function ComposabilityStatus({
  probe,
  checking,
  onRecheck,
}: {
  readonly probe: AccountProbe | null;
  readonly checking: boolean;
  readonly onRecheck: () => void;
}) {
  if (probe === null) {
    return (
      <div className="w-row">
        <Chip tone="sunken">{checking ? "checking…" : "not checked"}</Chip>
      </div>
    );
  }

  const body = (() => {
    switch (probe.outcome) {
      case "native":
        return (
          <Alert tone="pass" title="Composable">
            This account implements <code>executeComposable</code> itself, so no module installation is
            needed. Nothing to install.
          </Alert>
        );
      case "module-compatible":
        return (
          <Alert tone="info" title="Needs the composability module">
            This account has code but no native <code>executeComposable</code>. It can run a batch once
            the module is installed.
            {probe.moduleDeployed === false && (
              <>
                {" "}
                The module address has no code on this chain, so it cannot be installed from here yet —
                it is not deployed.
              </>
            )}
          </Alert>
        );
      case "not-composable":
        return (
          <Alert tone="warn" title="Not an account">
            The connected address has no code, so it cannot run a batch. Connect an account — a smart
            account on chain {EXPECTED_CHAIN_ID} — rather than an externally owned address.
          </Alert>
        );
      case "inconclusive":
        return (
          <Alert tone="warn" title="Could not determine">
            The check did not conclude{probe.error === undefined ? "" : `: ${probe.error}`}. This is not
            a claim that composability is missing; the answer is unknown. Retry, and do not treat the
            absence of a warning as permission to proceed.
          </Alert>
        );
      case "no-code":
        return null;
    }
  })();

  return (
    <div className="w-probe">
      {body}
      <div className="w-row">
        <MonoValue value={COMPOSABILITY_MODULE} muted />
        <Button variant="ghost" size="sm" onClick={onRecheck} disabled={checking}>
          {checking ? "Checking…" : "Re-check"}
        </Button>
      </div>
    </div>
  );
}
