import { Phase, type AppState } from "@/app/state";

/**
 * The six beats of docs/11-demo-script.md, as data the panel can render and check.
 *
 * Each beat carries the rule that marks it done, printed in the row itself. A stage prop that
 * says "done" without saying what done means is a prop the presenter has to remember the
 * semantics of, and nobody remembers anything at minute two of a three-minute run.
 *
 * The rules are deliberately split between the shared machine and the panel's own demo-only
 * state:
 *
 *   - Beats 1 to 4 are facts about the machine. A plan exists, a signature went out, a receipt
 *     came back one way or the other. Nothing here is inferred or optimistic.
 *   - Beat 5 is the price push this panel performs. It cannot live in the machine: moving a
 *     price is not a step in the build/sign/submit flow, and pretending otherwise would put a
 *     demo-only action into a reducer that has to stay pure (docs/06).
 *   - Beat 6 has no machine state at all — "I said the limits out loud" is a human act — so it
 *     is derived from what has to be on record before it *can* be said: the refusal (beat 4)
 *     and a freshness answer (beat 5, or the fact that beat 5 could not run).
 */

export interface Beat {
  readonly id: number;
  readonly title: string;
  /** Timebox from the beat sheet. The presenter is on a three-minute clock. */
  readonly budget: string;
  /** Printed in the row. The literal condition, not a paraphrase of it. */
  readonly rule: string;
  /** The line to read. Short enough to say in one breath. */
  readonly cue: string;
}

export const DEFAULT_BEAT: Beat = {
  id: 1,
  title: "The plan",
  budget: "0:30",
  rule: "calls.length > 0",
  cue:
    "Steps 3 and 6 take amounts that did not exist when this was signed. If any gate fails, " +
    "nothing in this list executes.",
};

export const BEATS: readonly Beat[] = [
  DEFAULT_BEAT,
  {
    id: 2,
    title: "The signature",
    budget: "0:15",
    rule: "txHash, or phase submitting",
    cue:
      "One signature. The swap output, the approval amount and the deposit amount were all " +
      "unknown until execution, and none of them needed a second signature.",
  },
  {
    id: 3,
    title: "The success",
    budget: "0:30",
    rule: 'receiptStatus === "success"',
    cue:
      "Six entries, each with its resolved value and each gate's verdict — the exact balance " +
      "approved, the full amount deposited, no dust left behind.",
  },
  {
    id: 4,
    title: "The failure",
    budget: "1:00",
    rule: 'receiptStatus === "reverted"',
    cue:
      "The batch was well-formed and still refused to execute. No balance moved, no approval " +
      "was left behind, no position exists — there is no partial outcome to clean up.",
  },
  {
    id: 5,
    title: "The freshness gate",
    budget: "0:45",
    rule: "oracle push confirmed",
    cue:
      "A price moved out of band between signing and execution, and the batch stopped before " +
      "any value moved. This is the part ERC-8211 cannot do on its own.",
  },
  {
    id: 6,
    title: "The honesty",
    budget: "0:15",
    rule: "refusal + freshness on record",
    cue:
      "No oracle-manipulation detection, no parking of a failed batch, two of three contracts " +
      "unaudited — then the one-line close.",
  },
];

export interface BeatFacts {
  readonly state: AppState;
  /** True only after a push transaction was mined successfully. Never optimistic. */
  readonly oraclePushed: boolean;
  readonly oracleConfigured: boolean;
}

/**
 * Whether a beat has been demonstrated.
 *
 * Every branch is a fact that can be pointed at. Beats 3 and 4 are mutually exclusive on
 * purpose: one receipt holds one status, so the row showing the outcome of *this* run flips
 * back to pending when the other run replaces it. That is the honest reading — a success
 * receipt from the happy path says nothing about the plan now loaded in the decoder.
 */
export function isBeatDone(id: number, facts: BeatFacts): boolean {
  const { state, oraclePushed, oracleConfigured } = facts;
  switch (id) {
    case 1:
      return state.calls.length > 0;
    case 2:
      // A signature exists once something was submitted against it: `sign/start` only means the
      // wallet was asked. The signature the demo can show is the one a receipt followed.
      return (
        state.txHash !== null ||
        state.phase === Phase.Submitting ||
        state.phase === Phase.Confirmed ||
        state.phase === Phase.Failed
      );
    case 3:
      return state.receiptStatus === "success";
    case 4:
      return state.receiptStatus === "reverted";
    case 5:
      return oraclePushed;
    case 6:
      // An unconfigured MockOracle cannot make this beat unreachable: the limits are still worth
      // saying, and "beat 5 could not run" is itself on the record.
      return isBeatDone(4, facts) && (oraclePushed || !oracleConfigured);
    default:
      return false;
  }
}

/**
 * Where the flow is, in words, for beat 2.
 *
 * The signature beat is SignButton's; this panel only reports the phase rather than restate
 * what the signature does, because two components narrating the same step is how a live demo
 * starts contradicting itself.
 */
export function phaseSentence(phase: Phase): string {
  switch (phase) {
    case Phase.Disconnected:
      return "no session yet — connect the demo account first";
    case Phase.Connected:
      return "account connected, no plan loaded";
    case Phase.ModuleMissing:
      return "the account cannot run a batch: the composability module is missing";
    case Phase.Building:
      return "the intent is being edited, nothing is previewable yet";
    case Phase.Previewing:
      return "plan loaded and readable — SignButton takes it from here";
    case Phase.Simulating:
      return "simulating the exact bytes that would be signed";
    case Phase.AwaitingSignature:
      return "signature requested — one prompt covers every runtime value";
    case Phase.Submitting:
      return "submitted, waiting for the receipt";
    case Phase.Confirmed:
      return "receipt in: the batch executed, every gate passed";
    case Phase.Failed:
      return "receipt in: the batch refused, nothing was committed";
    default:
      return "unknown phase";
  }
}
