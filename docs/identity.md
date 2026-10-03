---
title: Identity
status: draft
project: LATCH
last_reviewed: 2026-10-03
sources: appendix/sources.md (P1), appendix/design-tokens.md, 00-deck-analysis.md, 11-demo-script.md, ../web/src/styles/tokens.css
---

# Identity

How LATCH looks, sounds, and signs its name. This file is the contract for the strings, colours and
marks that the frontend and the deck share. Behaviour lives in
[06-frontend-blueprint.md](06-frontend-blueprint.md); the values themselves live in
[`web/src/styles/tokens.css`](../web/src/styles/tokens.css), which is the single source of truth.

## Name

**LATCH: it holds.** The name states the guarantee, not the mechanism. A latch either holds the load
or it does not; there is no third state, which is the same shape as an atomic batch.

LATCH is a product name. It is deliberately **not** a backronym — nothing is spelled out, and no
expansion should be invented for a slide, a caption or a repository description.

The team is **TEAM CHICKEN ROLL**. The product name is serious and the team name is not, and the
contrast is intentional: the thing being evaluated is the guarantee, and the people behind it do not
need the name of the work to be funny as well.

| Element | Value |
|---|---|
| Product | **LATCH** |
| Backronym | None. LATCH stands for nothing |
| Team | **TEAM CHICKEN ROLL** |
| Track | Open Innovation |
| Network | Base Sepolia, chain ID 84532 |
| Title line | `TEAM CHICKEN ROLL presents LATCH` |

## Voice

Imperative and declarative. State what the system does, then state the number that proves it.
Numbers over adjectives: "six steps, one signature, every value gated on-chain" is a sentence; "a
seamless signing experience" is not.

- **Sentence case everywhere except display type.** Document headings are sentence case (convention
  [C4](../README.md#documentation-conventions)). UI display headings are uppercase, set in the
  display face, because that is the register of a label stamped on a machine.
- **No emoji.** A symbol that carries meaning must be a rendered value — a status word, a number, a
  comparison operator — not a pictograph.
- **Every claim must survive one probing question.** If the honest answer is "it depends", the claim
  is not ready to ship. This is the same test the
  [deck analysis](00-deck-analysis.md) applied to six slides.

**Banned words.**

| Word | Why it is banned |
|---|---|
| seamless | Describes a joint no test can see. Name the boundary instead: one signature for six steps |
| effortless | An adjective about feeling. We count steps and signatures instead of rating them |
| magic | The product exists to remove magic. Every value on screen says where it came from |
| revolutionary | A claim about history that nothing in this repository can support |
| next-gen | Relative to an unnamed previous generation, so nothing can check it |
| trustless | We are precise about trust: the UserOp signature is the trust root, the EIP-712 intent is presentation. Using the word loosely blurs the one distinction the security model rests on |

## Signature vocabulary

The product's own nouns are the brand. Use these words and no synonyms; if a second word appears for
the same thing, this file or the [glossary](appendix/glossary.md) is wrong.

| Word | Means | Never means |
|---|---|---|
| `PLAN` | The decoded batch: the numbered steps a human reviews before signing | A draft, a suggestion, a quote |
| `GATE` | One constraint checked against one resolved value | The whole batch, or a UI section |
| `SIGN` | The single authorisation that covers the plan | Approving a screen, confirming a transaction |
| `HOLD` | A failed gate that stops the entire batch | A pause, a queue, a retry |

**Status words.** Exactly three verdicts, rendered uppercase in the mono face:

| Word | Colour token | When it may appear |
|---|---|---|
| `PASS` | `--c-pass` | Only after the chain has produced an outcome |
| `BLOCKED` | `--c-block` | Only after the chain has produced an outcome |
| `NOT CHECKED` | `--c-unchecked` | Whenever a constraint has not been evaluated |

`NOT CHECKED` is grey, never green. An unevaluated constraint is not a passing one, and a green tick
on a field that was never validated is worse than no tick at all (rule
[D1](../web/AGENTS-BRIEF.md#4-the-rules-that-make-this-product-honest)).

**The rule.** `PASS` and `BLOCKED` are outcomes and may only be rendered once a simulation result or
a receipt exists. Before that, the decoder may describe a comparison — `GATE`, `ANY OF`,
`UNDECODABLE` — but it may not render a verdict. Nothing has passed before it has run.

## Tagline

**Sign a plan. Not a guess.**

Two words the product already owns: the *plan* is the decoded batch, and the *guess* is the static
parameter signed before the value existed. It is a pair of short declarative sentences, so it reads
in the product's own voice.

| Candidate | Verdict | Reason |
|---|---|---|
| Sign a plan. Not a guess. | **Chosen** | Names both halves of the product: legible decode, runtime-resolved values. Two sentences, no adjectives, survivable under one probing question |
| Read what you sign. | Rejected | True of the decoder only. A wallet rendering hex also lets you read it; the sentence claims legibility without claiming the guarantee |
| Every value gated on-chain. | Rejected | It is the demo's closing line in [11](11-demo-script.md), where it summarises a receipt. As a tagline it leads with an absolute and buries the signature |

## Marks

The mark is a latch/bracket glyph built from the letter **L**: a corner stroke whose top arm is
short and whose foot is long, so it reads as a bracket closing a frame and as an L at the same time.
It sits on a latch-red field inside a black keyline, with a cream letterform.

**Construction.**

| Property | Value |
|---|---|
| Canvas | 64 x 64 |
| Field | `#D43A1C`, `--c-latch`, full bleed |
| Keyline | `#0B0B0B`, `--c-ink`, 6 units, inset 4 |
| Letterform | `#FFFDF7`, cream, `--c-surface`, stroke 8, square caps, mitred joins |
| Glyph path | `M34 16 H20 V48 H48` — vertical stroke, short top arm, long foot |
| Clear space | 1 x keyline width (6 units) on all four sides |
| Minimum size | 24 px on screen |
| Prohibited | Gradients, rotation, soft shadows, opacity fades, recolouring the field, keyline or letterform |

The short top arm is what keeps the glyph reading as an L rather than as a bracket. At 16 px the
same path with heavier weights still holds, so `favicon.svg` is not a different drawing: keyline 8,
letterform stroke 10, glyph path `M33 18 H20 V46 H46`.

The mark is never a background texture, never a watermark, and never sits on a photograph. If it
cannot be legible at the size offered, the size is wrong, not the mark.

**Wordmark.** **LATCH**, Archivo Black, uppercase, tight tracking (`--ls-tight`, -0.02em), ink on
transparent. No tagline inside the wordmark box, no outline, no lockup with the team name — the team
credit belongs to the deck title line, not to the logo.

Files: [`mark.svg`](../web/public/mark.svg), [`wordmark.svg`](../web/public/wordmark.svg),
[`favicon.svg`](../web/public/favicon.svg), [`og.svg`](../web/public/og.svg).

## Colour and type

[`web/src/styles/tokens.css`](../web/src/styles/tokens.css) is the single source of truth. Hex
values are not repeated here; a component that declares a colour of its own is a review failure.

| Role | Token | Use |
|---|---|---|
| Paper | `--c-paper` | Page background. Warm, not white |
| Ink | `--c-ink` | Text and every border. Soft steps are hierarchy only |
| Acid | `--c-acid` | Primary action, the one thing to press |
| Latch | `--c-latch` | The mark, destructive emphasis |
| Sky | `--c-sky` | Eyebrows and highlights only. Continuity with the source deck's accent |
| Signal | `--c-pass`, `--c-block`, `--c-unchecked` | One token per gate verdict |

`NOT CHECKED` is `--c-unchecked`. It is grey by definition; a second tone that reads as green is a
defect, not a style choice.

Type: `--font-display` (Archivo Black) for uppercase display headings, `--font-body` (Inter) for
prose, `--font-mono` (IBM Plex Mono) for every address, hash, selector, amount and enum member.

**Not carried into the product.** The source deck's `#090D16` dark palette and its Rajdhani body
type are not used. [design-tokens.md](appendix/design-tokens.md) documents the deck as it exists, and
the legibility defect it records — Rajdhani at 13.5 pt step body, close to illegible on a projector —
is the reason. A product whose claim is legibility cannot inherit the one defect its own analysis
found.

## Style directions considered

| Direction | Verdict | Reason |
|---|---|---|
| Neo-brutalism | **Chosen** | The product's claim is legibility, so the interface must look like it is showing you everything. Hard borders and zero radius leave nowhere for a value to hide |
| Swiss / International | Strong runner-up | The natural second theme, since every value is already a custom property and a grid is half the work |
| Terminal / devtool | Conditional | Excellent for the execution tracker alone, weak for onboarding: a first-time user cannot read a console |
| Bauhaus / constructivist | Rejected | Warm and geometric, but its primaries compete with the three signal colours that must stay unambiguous |
| Dark aurora / glass fintech | Rejected | The default crypto look carries no identity, and a glass wash puts text behind a blur |
| Y2K chrome / Memphis | Rejected | Legibility risk in a product whose claim is legible |

A second theme is `[data-theme]` over the same property names — a stylesheet, not a rewrite. Swiss
and terminal remain available precisely because nothing outside `tokens.css` holds a raw value.

## Copy deck

Approved wording. Anything else in the UI is a defect against this table. Beat language matches
[11-demo-script.md](11-demo-script.md): plan, gate, revert, nothing moved.

| Surface | Approved wording | Rule |
|---|---|---|
| Empty plan | `No batch built yet. Configure an intent and build it to see the decoded plan.` | Never an empty box with a spinner |
| Not simulated yet | `Not simulated yet. Run the simulation before signing.` | Absence of a simulation is not a result |
| Simulation unavailable | `Simulation unavailable. Nothing has been checked, so nothing has passed.` | An RPC failure renders `NOT CHECKED`, never `PASS` |
| Wrong chain | `Wrong chain. This plan signs for Base Sepolia (84532). Switch the network to continue.` | Name the expected chain id, then the action |
| Module unknown | `Module unknown. The composability module has not been read on this account yet.` | Chip reads `module unknown`. Never infer installed |
| Not configured | `not configured` | Rule D10. An unconfigured deployment never renders a plausible address |
| Skip-call confirmation | `Skip this call? Step 4 router.exactInputSingle(USDC to WETH) will not run. The rest of the segment still runs, and a skipped segment that would have written a slot a later segment reads still reverts the batch.` | Rule D6. Names what is skipped. Actions: `Skip the call` / `Keep REVERT_BATCH` |
| Gate statuses | `PASS` · `BLOCKED` · `NOT CHECKED` | Exactly these three words, uppercase, mono. See [signature vocabulary](#signature-vocabulary) |

## Where it appears

| Surface | Asset | Note |
|---|---|---|
| App chrome | `mark.svg` + `wordmark.svg` | Header lockup; tagline beneath as text |
| Favicon | `favicon.svg` | Weighted variant of the mark, readable at 16 px |
| Open Graph | `og.png` (rendered from `og.svg`) | 1200 x 630: mark, wordmark, tagline |
| README header | `mark.svg`, `wordmark.svg` | Assets are ready; the README header is text today |
| Deck | `mark.svg`, `wordmark.svg` | Title slide: `TEAM CHICKEN ROLL presents LATCH` |

## Follow-ups

| Item | Status | Note |
|---|---|---|
| `og.png` | **Shipped** | 1200 x 630, cut from `og.svg` with Archivo Black and IBM Plex Mono resolved, so the raster carries the real type rather than a fallback. Re-render with `rsvg-convert -w 1200 -h 630 web/public/og.svg -o web/public/og.png`; a cut taken without those fonts installed is the one failure mode worth checking |
| Absolute `og:image` / `og:url` | Not shipped | No deployment host is recorded in the repository, so no absolute URL is asserted. Add both once the host is known |
| README header image | Not shipped | The README header block is unchanged by this pass; the mark and wordmark are ready to drop in |

## Related documents

| Document | Covers |
|---|---|
| [06](06-frontend-blueprint.md) | Behaviour: what the decoder and the state machine do |
| [00](00-deck-analysis.md) | The source deck, its corrections, its closing line |
| [11](11-demo-script.md) | The spoken register this copy matches |
| [design-tokens.md](appendix/design-tokens.md) | The deck's own palette and type, recorded not used |
| [glossary.md](appendix/glossary.md) | Vocabulary for the whole set |
| [`tokens.css`](../web/src/styles/tokens.css) | The values, single source of truth |
