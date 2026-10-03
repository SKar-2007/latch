import { Button, Chip, Panel } from "@/components/ui";
import { useApp, useDispatch } from "@/app/AppProvider";

/**
 * Wave 1, seat C owns this file (and the whole `features/wallet/` folder).
 *
 * Stub: replace the body, keep the export names.
 *
 * What the real component must do (docs/06):
 * - Show account, chain, and whether the composability module is installed.
 * - `isInitialized` false moves the machine to `moduleMissing`; installing dispatches
 *   `module/installed`. Never report the module as installed before the call returns.
 * - Chain guard: a wallet on the wrong chain is blocked from signing, with the expected chain id
 *   named in the message.
 */
export function ConnectWallet() {
  const { phase, account, chainId, moduleInstalled } = useApp();
  const dispatch = useDispatch();

  return (
    <Panel title="Session" tone="latch">
      <div className="stack">
        <div className="row">
          <Chip tone="acid">{phase}</Chip>
          <Chip>chain {chainId}</Chip>
          <Chip>module {moduleInstalled === null ? "unknown" : moduleInstalled ? "yes" : "no"}</Chip>
        </div>
        <p className="ui-mono" style={{ fontSize: "var(--t-sm)" }}>
          {account ?? "no wallet connected"}
        </p>
        <div className="row">
          <Button
            variant="acid"
            onClick={() =>
              dispatch({
                type: "wallet/connected",
                account: "0x0000000000000000000000000000000000000001",
                chainId: 84532,
              })
            }
          >
            Connect
          </Button>
          <Button variant="ghost" onClick={() => dispatch({ type: "wallet/disconnected" })}>
            Disconnect
          </Button>
        </div>
      </div>
    </Panel>
  );
}
