import { Button } from "@/components/ui";
import { useApp, useDispatch } from "@/app/AppProvider";

/**
 * Wave 2, seat F owns this file.
 *
 * Stub: replace the body, keep the export names.
 *
 * The two signatures are not interchangeable (docs/06). The UserOp signature is the trust root; the
 * EIP-712 intent is presentation, expiry and replay scoping. The relayer must submit the batch
 * derived from the UserOp the account signed, and discard the intent if they disagree.
 *
 * Signing is enabled only from `previewing` with a successful, current simulation.
 */
export function SignButton() {
  const { phase, simulation } = useApp();
  const dispatch = useDispatch();
  const ready = phase === "previewing" && simulation?.ok === true;

  return (
    <Button
      variant="acid"
      size="lg"
      block
      disabled={!ready}
      onClick={() => dispatch({ type: "sign/start" })}
    >
      Sign and submit
    </Button>
  );
}
