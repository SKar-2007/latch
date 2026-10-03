---
title: Parallel build brief
status: draft
project: LATCH
last_reviewed: 2026-10-03
sources: ../docs/06-frontend-blueprint.md
---

# Web build brief

This file is the contract for every agent working on `web/` in this session. Read it before you
touch a file. It exists so five seats can work at once without stepping on each other.

## 1. What we are building

`web/` is the LATCH frontend: it builds an ERC-8211 batch, decodes it so a human can review it,
simulates it, and collects the signature. The two source documents are
[docs/06-frontend-blueprint.md](../docs/06-frontend-blueprint.md) (behaviour) and
[docs/identity.md](../docs/identity.md) (how it looks and sounds).

`client/` is pure logic with 80 passing tests. Import it as `@latch/client`; never reach into
`client/src/*` by relative path.

## 2. Ownership

**Edit only the paths listed for your seat.** Everything else is read-only, including files that
look like they need a one-line fix — report it instead, because a second writer on the same file is
how a parallel session loses work.

| Seat | Paths you may edit |
|---|---|
| A — Shell | `src/app/AppShell.tsx`, `src/app/shell.css`, `src/app/App.tsx`, `src/main.tsx`, `src/app/sections/**` |
| B — Decoder | `src/features/decoder/**` |
| C — Chain | `src/features/wallet/**` |
| D — Identity | `docs/identity.md`, `web/public/**`, `web/index.html`, `README.md` |
| E — Builder | `src/features/builder/**` |
| F — Execute | `src/features/execute/**`, `src/core/intent.ts` |
| G — Demo | `src/features/demo/**` |
| H — Tests | `test/**` |

**Frozen — nobody edits these after Wave 0.** They are the shared contract; if you need something
that is not here, ask for it rather than adding your own:

```
src/styles/**            tokens, base layer
src/components/ui/**     the primitive set
src/app/state/**         the state machine
src/app/AppProvider.tsx  useApp / useDispatch
src/core/addresses.ts    pinned addresses
src/core/chain.ts        viem clients
src/core/format.ts       display formatting
vite.config.ts, tsconfig.json, package.json
```

Feature barrels (`src/features/<x>/index.ts`) belong to that feature's seat.

## 3. Design direction

Neo-brutalism. Warm paper, black ink, hard offset shadows, zero radius, heavy display type against
a monospace data face. Full reasoning and the alternative directions are in
[docs/identity.md](../docs/identity.md).

Hard rules:

1. **No raw colours, radii, shadows or font sizes in a component.** Everything comes from a
   `--c-*`, `--t-*`, `--s-*`, `--bw*`, `--shadow*` or `--font-*` custom property in
   `src/styles/tokens.css`. A hex literal outside that file is a review failure.
2. **Primitives are frozen.** Use `Button`, `Panel`, `Eyebrow`, `Chip`, `MonoValue`, `GateBadge`,
   `Alert`, `Field` from `@/components/ui`. Do not build a second button.
3. **Uppercase display headings, sentence-case prose.** Document headings in Markdown are
   sentence-case (convention C4).
4. **Every address, hash, selector, amount and enum member renders through `MonoValue` or a
   `ui-mono` class.** Tabular numerals keep columns aligned.
5. **No emoji anywhere.**

## 4. The rules that make this product honest

These come from [docs/06](../docs/06-frontend-blueprint.md) and are not stylistic preferences.
Each one is a test.

| # | Rule | Where |
|---|---|---|
| D1 | `SKIP` renders as **not checked**, never as a pass. A green tick on an unvalidated field is worse than no tick. | `features/decoder` |
| D2 | Show the constraint's **actual operator**. `GTE 1000` and `LTE 1000` must not look the same. | `features/decoder` |
| D3 | A `STATIC_CALL` fetcher renders **the call that will produce the value**, never a value — even when a simulation has produced one. Simulated values are labelled *simulated*. | `features/decoder` |
| D4 | **Green (`GateTone "pass"`) is only legal after the chain has produced an outcome.** The decoder emits `checked` / `not-checked` / `any-of` / `undecodable`. Nothing has passed before it has run. | everyone |
| D5 | Slippage is **presets only**. No free-text field. The numeric value of the chosen preset is always visible. | `features/builder` |
| D6 | `REVERT_BATCH` is the default on every segment. Selecting `SKIP_CALL` opens a confirmation that names what will be skipped. | `features/builder` |
| D7 | A revert reason is **mapped to an actionable sentence**. A bare `ConstraintNotMet` selector is not an error message. | `features/wallet` |
| D8 | The EIP-712 intent is presentation, expiry and replay scoping. The **UserOp signature is the trust root**; the relayer submits the batch derived from the UserOp and discards the intent if they disagree. | `features/execute` |
| D9 | Never retry a **write** on timeout without first checking whether it landed. Reads fall back; writes do not. | `core/chain.ts` |
| D10 | Addresses are **pinned configuration**, never discovered at runtime. An unconfigured deployment shows `not configured`, never a plausible address. | `core/addresses.ts` |

## 5. State machine

`src/app/state/types.ts` holds `Phase`, `TRANSITIONS`, `AppAction` and `AppState`.
`reducer.ts` is pure — it performs no I/O.

- Read with `useApp()`, write with `useDispatch()`. Never keep a second copy of phase, batch or
  simulation in a component.
- An illegal transition is rejected, not applied. If your feature needs a new move, ask for it.
- Anything that edits the batch, its bounds or its policy clears the simulation. A simulation
  belongs to the exact bytes that were simulated.

Phases: `disconnected → connected → (moduleMissing) → building → previewing → simulating →
awaitingSignature → submitting → confirmed | failed`.

Legal flow: `build/ready` lands in `previewing`; `simulate/start` → `simulating`;
`simulate/done` → `previewing` carrying the result; `sign/start` → `awaitingSignature`;
`submit/start` → `submitting`; `submit/receipt` → `confirmed` or `failed`.

## 6. Feature contracts

Stubs exist so the tree compiles from the first minute. Replace the body; keep the export name and
its props.

```ts
// features/decoder — seat B
BatchPreview({ calls, names?, policy?, simulation?, onEdit? })

// features/builder — seat E
IntentBuilder({ bounds, policy, onBoundsChange, onPolicyChange, onBuild, busy? })

// features/wallet — seat C
ConnectWallet()
SimulationPanel()

// features/execute — seat F
SignButton()
ExecutionTracker()

// features/demo — seat G
DemoPanel({ onFailingBatch?, onReset? })
```

`names` is an address-to-display-name table. It is supplied, never inferred: an unknown address
renders as literal hex.

## 7. Environment

| Variable | Purpose |
|---|---|
| `VITE_RPC_PRIMARY`, `VITE_RPC_SECONDARY`, `VITE_RPC_TERTIARY` | Public RPC endpoints. An unset slot is skipped, never substituted |
| `VITE_FEED_GUARD`, `VITE_QUOTER_GUARD`, `VITE_FAILSAFE` | LATCH-owned deployments. Empty means **not configured** |
| `VITE_MOCK_ORACLE` | Demo oracle. Empty means the driver disables itself |
| `VITE_EXPLORER_URL` | Explorer base URL for receipt links. Empty means the hash is printed to paste |

`chainId` is not an environment variable: `84532` is a constant in `src/core/addresses.ts`, along
with the composability module and composable storage. Configuration that lives in source is reviewable;
configuration that lives in a deployment's `.env` is not.

## 8. Verification

Run before you hand your seat back. All four must pass.

```bash
cd web
npm run typecheck     # tsc --noEmit, strict, exactOptionalPropertyTypes
npm test              # vitest
npm run build         # typecheck then vite build
cd ../client && npm test   # 80 tests. You must not have touched client/
```

If a check fails in a file you do not own, report it in your final message instead of fixing it.

## 9. Documentation conventions

Anything you write under `docs/` obeys the rules in [README.md](../README.md):

- Front matter: `title`, `status`, `project`, `last_reviewed`. Everything ships as `draft`.
- C4: no emoji, sentence-case headings, heading depth at most 3, tables for normative data.
- C7: relative links only, every file reachable from `README.md`, zero orphans.
