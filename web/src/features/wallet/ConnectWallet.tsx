import { useApp } from "@/app/AppProvider";
import { Alert, Button, Chip, Eyebrow, MonoValue, Panel } from "@/components/ui";
import { CHAIN_NAME } from "@/core/addresses";
import { EXPECTED_CHAIN_ID, isExpectedChain } from "@/core/chain";
import { useWallet } from "./useWallet";
import "./wallet.css";

/**
 * Wallet session panel (docs/06, `<ConnectWallet>`): account, chain, module status.
 *
 * Presentational: every side effect — the EIP-1193 calls, the listeners, the module pre-flight —
 * lives in `useWallet`. Two rules shape what is rendered here:
 *
 * - **No wallet, no connect button.** A button that throws when pressed teaches the user that the
 *   app is broken rather than that a wallet is missing, so the missing-wallet state names wallets
 *   to install instead.
 * - **The wrong chain blocks signing.** The expected chain is named, with its id, and the switch is
 *   one click away. `moduleInstalled` renders exactly as the machine holds it: `unknown` while the
 *   check has not answered, never optimistically either way.
 */
export function ConnectWallet() {
  const { phase, account, chainId, moduleInstalled } = useApp();
  const wallet = useWallet();

  const onExpectedChain = isExpectedChain(chainId);
  const wrongChain = account !== null && !onExpectedChain;

  const chainLabel = `${onExpectedChain ? CHAIN_NAME : "chain"} ${chainId}`;
  const moduleLabel =
    moduleInstalled === null
      ? "module: unknown"
      : moduleInstalled
        ? "module: installed"
        : "module: not installed";

  return (
    <Panel title="Wallet" tone="latch" aside={<Chip tone="acid">{phase}</Chip>}>
      <div className="stack">
        {!wallet.hasWallet && (
          <Alert tone="warn" title="No wallet detected">
            No wallet extension is injected in this browser. Install one before trying to connect:
            MetaMask, Rabby, Coinbase Wallet or Brave Wallet all work with LATCH. The session opens
            through <span className="ui-mono">window.ethereum</span>, and there is none.
          </Alert>
        )}

        <div className="w-facts">
          <div className="w-fact">
            <Eyebrow>Account</Eyebrow>
            {account === null ? (
              <span className="w-fact__empty">not connected</span>
            ) : (
              <MonoValue value={account} truncate />
            )}
          </div>
          <div className="w-fact">
            <Eyebrow>Chain</Eyebrow>
            <Chip tone={wrongChain ? "ink" : "default"}>{chainLabel}</Chip>
          </div>
          <div className="w-fact">
            <Eyebrow>Module</Eyebrow>
            <Chip tone={moduleInstalled === true ? "acid" : "sunken"}>{moduleLabel}</Chip>
          </div>
        </div>

        {wrongChain && (
          <Alert tone="block" title="Wrong network">
            This wallet is on chain {chainId}. LATCH runs on {CHAIN_NAME} ({EXPECTED_CHAIN_ID}), so
            nothing can be signed until the wallet is on that chain.
          </Alert>
        )}

        {wallet.error !== null && (
          <Alert tone="block" title="Wallet">
            {wallet.error}
          </Alert>
        )}

        <div className="row w-actions">
          {wallet.hasWallet && account === null && (
            <Button
              variant="acid"
              onClick={() => void wallet.connect()}
              disabled={wallet.connecting}
            >
              {wallet.connecting ? "Connecting…" : "Connect wallet"}
            </Button>
          )}
          {wrongChain && (
            <Button variant="ink" onClick={() => void wallet.switchChain()}>
              Switch to {CHAIN_NAME}
            </Button>
          )}
          {account !== null && (
            <Button variant="ghost" onClick={wallet.disconnect}>
              Disconnect
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
