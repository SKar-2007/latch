import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildDemoBatch } from "@latch/client";
import { AppProvider, useDispatch } from "@/app/AppProvider";
import { type AppAction } from "@/app/state";
import {
  CHAIN_ID,
  CHAIN_NAME,
  COMPOSABILITY_MODULE,
} from "@/core/addresses";
import {
  INTENT_NAME,
  INTENT_TYPES,
  INTENT_VERSION,
  buildDomain,
  buildIntentMessage,
  hashBatch,
  signIntent,
  type IntentSigner,
} from "@/core/intent";
import { SignButton } from "@/features/execute";
import { mapWalletError } from "@/features/execute/errors";
import { EXECUTION_PATHS, NOT_WIRED_MESSAGE, activePath, meePath, rawPath } from "@/features/execute/paths";

/**
 * Seat F's contract, asserted.
 *
 * The load-bearing distinction this file exists to protect is docs/06's: the EIP-712 intent is
 * presentation, expiry and replay scoping, and the transaction signature is the trust root. So the
 * typed-data assertions below are about *binding* — right app, right chain, right account, right
 * bytes — and never about authority. `signIntent` returning a signature is asserted to mean
 * nothing on its own.
 */

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const FEED_GUARD = "0x3333333333333333333333333333333333333333" as const;

const calls = (minAmountOut: bigint) =>
  buildDemoBatch({ account: ACCOUNT, feedGuard: FEED_GUARD, minAmountOut });

const RECORDING_SIGNER = (): IntentSigner & { seen: readonly unknown[] } => {
  const seen: unknown[] = [];
  return {
    seen,
    async signTypedData(args) {
      seen.push(args);
      return `0x${"ab".repeat(65)}` as `0x${string}`;
    },
  };
};

describe("the intent domain is bound the way docs/06 requires", () => {
  it("pins the app name, the version, the chain and the account", () => {
    const domain = buildDomain(ACCOUNT);
    expect(domain).toEqual({
      name: INTENT_NAME,
      version: INTENT_VERSION,
      chainId: CHAIN_ID,
      verifyingContract: ACCOUNT,
    });
    // Chain and account are the two bindings that matter; both come from configuration, never from
    // whatever the wallet reports at runtime.
    expect(domain.chainId).toBe(84532);
    expect(domain.name).toBe("LATCH");
  });

  it("declares the six fields of DeclarativeIntent in the documented order", () => {
    expect(INTENT_TYPES.DeclarativeIntent.map((f) => f.name)).toEqual([
      "account",
      "batchHash",
      "module",
      "chainId",
      "nonce",
      "validUntil",
    ]);
    expect(INTENT_TYPES.DeclarativeIntent.find((f) => f.name === "batchHash")?.type).toBe("bytes32");
  });

  it("binds the message to the pinned module and the chain as uint256", () => {
    const message = buildIntentMessage({
      account: ACCOUNT,
      calls: calls(10n ** 15n),
      validUntil: 1_800_000_000,
    });
    expect(message.module).toBe(COMPOSABILITY_MODULE);
    expect(message.chainId).toBe(84532n);
    expect(message.validUntil).toBe(1_800_000_000n);
    expect(message.nonce).toBe(0n);
  });
});

describe("batchHash covers the encoded batch, not a summary of it", () => {
  it("is stable across repeated hashes of the same batch", () => {
    expect(hashBatch(calls(10n ** 15n))).toBe(hashBatch(calls(10n ** 15n)));
  });

  it("changes when a single bound in the batch changes", () => {
    expect(hashBatch(calls(10n ** 15n))).not.toBe(hashBatch(calls(2n * 10n ** 15n)));
  });

  it("changes when a different account is built against", () => {
    const other = buildDemoBatch({
      account: OTHER,
      feedGuard: FEED_GUARD,
      minAmountOut: 10n ** 15n,
    });
    expect(hashBatch(other)).not.toBe(hashBatch(calls(10n ** 15n)));
  });

  it("carries no authority of its own — only the fields that scope it", async () => {
    const signer = RECORDING_SIGNER();
    const batch = calls(10n ** 15n);
    await signIntent(signer, ACCOUNT, batch, { validUntil: 1_800_000_000 });

    expect(signer.seen).toHaveLength(1);
    const seen = signer.seen[0] as {
      readonly domain: ReturnType<typeof buildDomain>;
      readonly types: typeof INTENT_TYPES;
      readonly primaryType: string;
      readonly message: { readonly batchHash: string };
    };
    expect(seen.primaryType).toBe("DeclarativeIntent");
    expect(seen.domain.name).toBe(INTENT_NAME);
    expect(seen.message.batchHash).toBe(hashBatch(batch));
  });
});

describe("wallet errors become sentences, not codes (D7 / D8)", () => {
  it("maps a refusal to something the user can act on", () => {
    const mapped = mapWalletError(Object.assign(new Error("User rejected"), { code: 4001 }));
    expect(mapped.message).toMatch(/reject/i);
    expect(mapped.message).not.toBe("4001");
    expect(mapped.message).not.toMatch(/^4001$/);
    expect(mapped.rejection).toBe(true);
  });

  it("keeps an unknown code as detail underneath a real sentence", () => {
    const mapped = mapWalletError(Object.assign(new Error("boom"), { code: -32099 }));
    expect(mapped.message.length).toBeGreaterThan(20);
    expect(mapped.message).not.toMatch(/^-32099$/);
  });

  it("surfaces the rejection out of signIntent without inventing a signature", async () => {
    const refusal = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const signer: IntentSigner = {
      signTypedData: async () => {
        throw refusal;
      },
    };
    await expect(
      signIntent(signer, ACCOUNT, calls(10n ** 15n), { validUntil: 1_800_000_000 }),
    ).rejects.toBe(refusal);
    expect(mapWalletError(refusal).rejection).toBe(true);
  });
});

describe("the execution path is named, not implied", () => {
  it("uses the raw path and does not claim sponsorship", () => {
    expect(activePath).toBe(rawPath);
    expect(activePath.id).toBe("raw");
    expect(activePath.sponsored).toBe(false);
    expect(activePath.label).toMatch(/executeComposable/i);
  });

  it("refuses the MEE paths by name rather than silently downgrading to raw", async () => {
    for (const path of EXECUTION_PATHS.filter((p) => p !== rawPath)) {
      await expect(path.execute({ account: ACCOUNT, calls: calls(1n) })).rejects.toThrow(
        NOT_WIRED_MESSAGE,
      );
      expect(path.sponsored).toBe(true);
    }
    expect(meePath.id).toBe("mee");
  });
});

/** Puts the machine in a given state before the component under test paints. */
function Seed({ actions }: { readonly actions: readonly AppAction[] }) {
  const dispatch = useDispatch();
  useEffect(() => {
    for (const action of actions) dispatch(action);
  }, [actions, dispatch]);
  return null;
}

const seedToPreview = (simulationOk: boolean): readonly AppAction[] => [
  { type: "wallet/connected", account: ACCOUNT, chainId: CHAIN_ID },
  { type: "module/status", installed: true },
  { type: "build/ready", calls: calls(10n ** 15n) },
  { type: "simulate/start" },
  { type: "simulate/done", result: { ok: simulationOk, at: 1 } },
];

function renderSign(actions: readonly AppAction[]) {
  return render(
    <AppProvider>
      <Seed actions={actions} />
      <SignButton />
    </AppProvider>,
  );
}

const signButton = () => screen.getByTestId("sign-button");

/** Assert on the whole rendered copy, so a sentence split across elements still matches once. */
const body = (): string => document.body.textContent ?? "";


describe("the sign control is gated on evidence, not on optimism", () => {
  it("offers signing only from a preview whose simulation passed", async () => {
    renderSign(seedToPreview(true));
    await waitFor(() => expect(signButton()).toBeEnabled());
    expect(body()).toMatch(/ready/i);
  });

  it("is blocked while the simulation has not run", async () => {
    const actions = seedToPreview(true).filter((a) => a.type !== "simulate/done");
    renderSign(actions);
    await waitFor(() => expect(signButton()).toBeInTheDocument());
    expect(signButton()).toBeDisabled();
    expect(body()).toMatch(/Not ready to sign/i);
    expect(body()).toMatch(/only place the gates are exercised/i);
  });

  it("is blocked when the last simulation failed", async () => {
    renderSign(seedToPreview(false));
    await waitFor(() => expect(signButton()).toBeInTheDocument());
    expect(signButton()).toBeDisabled();
    expect(body()).toMatch(/last simulation failed/i);
  });

  it("names the active path and its gas payer so raw is never mistaken for sponsored", async () => {
    renderSign(seedToPreview(true));
    await waitFor(() => expect(signButton()).toBeEnabled());
    expect(body()).toContain("raw");
    expect(body()).toMatch(/not sponsored/i);
    expect(body()).toContain(CHAIN_NAME);
  });

  it("says in plain words that the intent signature does not authorise the batch", async () => {
    renderSign(seedToPreview(true));
    await waitFor(() => expect(signButton()).toBeEnabled());
    expect(body()).toMatch(/carries no authority/i);
    expect(body()).toMatch(/trust root/i);
    expect(body()).toMatch(/Signing the intent does not authorise the batch/i);
  });
});

describe("a refused signature is reported as a refusal", () => {
  it("maps the wallet's refusal to a sentence without submitting anything", async () => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const request = vi.fn(async (args: { readonly method: string }) => {
      if (args.method === "eth_signTypedData_v4") throw refusal;
      throw new Error(`unexpected method ${args.method}`);
    });
    Object.defineProperty(window, "ethereum", { value: { request }, configurable: true });

    renderSign(seedToPreview(true));
    await waitFor(() => expect(signButton()).toBeEnabled());
    await user.click(signButton());

    const methods = (): string[] =>
      request.mock.calls.map((call) => (call[0] as { readonly method: string }).method);

    // The wallet is asked for the intent signature, and for nothing else.
    await waitFor(() => expect(methods()).toContain("eth_signTypedData_v4"));
    // No transaction is ever attempted after a refusal.
    expect(methods()).not.toContain("eth_sendTransaction");
    // And the machine is back in `building`, so the plan is still there to be edited. The refusal
    // notice itself is asserted end to end in `app.integration.test.tsx`, which renders the shell.
    await waitFor(() => expect(body()).toMatch(/Build and preview a batch first/i));

    Reflect.deleteProperty(window, "ethereum");
  });
});
