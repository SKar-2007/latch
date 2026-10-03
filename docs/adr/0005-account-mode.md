---
title: "ADR 0005: EIP-7702 as the primary account mode"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (S5, D5, D6, D3, R7)
---

# ADR 0005: EIP-7702 as the primary account mode

- **Status:** accepted
- **Date:** 2026-10-02
- **Deciders:** LATCH team
- **Relates to:** [03-module-integration.md](../03-module-integration.md), [01-system-architecture.md](../01-system-architecture.md)

## Context

The deck's architecture slide places "ERC-7579 / EIP-7702" in a single box, STEP 2, without choosing.
LATCH supports both. The demo needs one, and the choice affects what has to be true before the demo can
run.

Two shapes are available:

| | ERC-7579 Nexus account | ERC-7702 delegation |
|---|---|---|
| Account | A counterfactual smart account at its own address | The user's EOA, delegating code |
| Deployment | None needed if counterfactual | None |
| Funding | Must be pre-funded, or sponsored | The EOA's own balance |
| Entry point | Bundler or MEE | Any client; the EOA sends its own transaction |
| Off-chain wallet support | Broad | Requires wallet-side authorization signing |
| Signature | One UserOp | Authorization plus one UserOp, on first use |
| SDK | `toNexusAccount` | `toMultichainNexusAccount` with `accountAddress` override |

## Options considered

### Option 1 — ERC-7579 Nexus account only

| | |
|---|---|
| Pros | Simplest flow. One signature. Works with any wallet via a bundler. The mode the audited module was tested against |
| Cons | A separate address to fund. A newcomer must be sponsored or sent test ETH before anything works |
| Retained as fallback | Yes, for external-wallet flows and for anyone without 7702 support |

### Option 2 — EIP-7702 as the primary path

| | |
|---|---|
| Pros | The account is the user's existing EOA. Nothing to deploy, nothing to pre-fund, one address across chains. On a fresh testnet this is the difference between a working demo and a funding detour |
| Cons | Requires a wallet that can sign an authorization. Three mandatory SDK requirements that are easy to miss. The Nexus singleton address must be confirmed |
| Retained | **Adopted** |

### Option 3 — demonstrate both

| | |
|---|---|
| Pros | Shows the range |
| Cons | Doubles the pre-demo surface. The 7702 path's first-use 412 failure mode plus the 7579 path's funding requirement is a lot of ways for a three-minute demo to break |
| Rejected because | The 7579 path remains implemented and documented. Demonstrating it live adds risk without adding a claim |

## Decision

**EIP-7702 is the primary and demonstrated mode. ERC-7579 is implemented and documented as the
fallback.**

Three mandatory requirements, each of which produces a different failure if missed:

```typescript
const account = await toMultichainNexusAccount({
  signer,
  chainConfigurations: [{
    chain: baseSepolia,
    transport: http(RPC),
    version: getMEEVersion(MEEVersion.V2_2_2),
    accountAddress: signer.address,   // REQUIRED. Signals EIP-7702 mode.
  }],
});
```

```typescript
const authorization = await walletClient.signAuthorization({
  account: eoa,
  contractAddress: NEXUS_SINGLETON,
  chainId: 0,     // valid across all chains
  nonce: 0,
});
```

1. `delegate: true` on the MEE instruction. Without it the authorization is not used.
2. The authorization must be supplied, manually or via the SDK prompt.
3. `accountAddress` must be explicitly overridden to the EOA address. Without it the SDK assumes a
   managed smart account, derives a different address, and everything downstream silently targets the
   wrong account.

Plus one expected failure: the **first** submission returns **HTTP 412** because the authorization is not
yet recorded on chain. Sign it, wait for inclusion, retry. This is the normal first-use path and the
demo script treats it as expected rather than as a fault.

## Consequences

**Positive**

- No funding step in the demo. The account holds the user's own test ETH already.
- One address across Base Sepolia and any other supported chain, which matches the deck's EIP-7702 claim
  concretely.
- The composability module is installed inside Nexus either way, so the ERC-8211 integration is
  identical in both modes.

**Negative**

- The demo depends on a wallet that can sign an authorization. Privy, Dynamic and Turnkey can. MetaMask
  and Rabby generally cannot, and need Fusion mode instead. The demo must use an embedded wallet.
- The first submission may return HTTP 412. Expected, rehearsed.

### Resolved: the delegation target is confirmed

Verification round 2 settled this by surveying deployed bytecode rather than reading documentation.

| Field | Value |
|---|---|
| Delegation target | **`0x0000000020fe2F30453074aD916eDeB653eC7E9D`** |
| `accountId()` | `biconomy.nexus.1.3.1` |
| `entryPoint()` | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Native `executeComposable` | present |
| Try-execution | present |

The address documented by Biconomy, `0x000000004F43C49e93C970E84001853a70923B03`, is a **different and
older** account: it reports `biconomy.nexus.1.2.0` and does **not** expose `executeComposable`. Delegating
to it would have produced an account unable to run a batch at all.

A correction worth recording: the `2.2.x` in Biconomy's documentation is the **MEE deployment** version.
The **Nexus account** version on Base Sepolia is `1.3.1`. These are different axes, and this ADR conflated
them until the survey forced the distinction.
- The 412 retry adds a failure mode that must be rehearsed, or it will be improvised.

**Neutral**

- Module installation is identical in both modes, because it happens inside Nexus either way.

## Open dependency

**V-16 is resolved. V-01 remains open** and concerns the MEE orchestration path, not the delegation
target. If MEE cannot be initialised against Base Sepolia, submit the UserOp through any ERC-4337
bundler instead. The batch and the account are unaffected, because neither depends on MEE.

Harden the configuration against exactly the mistake this ADR nearly made:

```bash
# Before shipping, assert the delegation target is the composable Nexus, not merely a Nexus.
ACC=0x0000000020fe2F30453074aD916eDeB653eC7E9D
curl -s -X POST "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$ACC\",\"data\":\"0x9cfd7cff\"},\"latest\"]}"
# Expect the ASCII string biconomy.nexus.1.3.1, not 1.2.0.
```

## What to do if V-04 cannot be resolved in time

Fall back to Option 1, ERC-7579, and narrate it as such:

> "This is the Nexus smart account path. The same composability module and the same constraints. We also
> support EIP-7702, where the account is the user's own EOA, which removes the funding step entirely."

That is an honest and complete statement. It loses the 7702 demonstration, not the claim.

## Revisit trigger

- MEE gains first-class 7702 support that removes the three manual requirements.
- Embedded-wallet support in the demo environment changes, making external wallets viable.
- Base Sepolia gains a documented Nexus singleton for the pinned MEE version, closing V-04.