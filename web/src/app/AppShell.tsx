import { useApp, useDispatch } from "@/app/AppProvider";
import { buildDemoBatch } from "@latch/client";
import { DEPLOYMENT, isConfigured } from "@/core/addresses";
import { parseAmount } from "@/core/format";
import {
  Hero,
  HowItWorks,
  Honesty,
  SiteFooter,
  SiteHeader,
  SkipLink,
  Workbench,
} from "./sections";
import "./shell.css";

/**
 * Composition root.
 *
 * Wave 1, seat A owns this file, `shell.css` and `src/app/sections/`. It is deliberately thin:
 * landmarks, the header rule, and wiring feature components to shared state. Feature components
 * never import each other — they meet here.
 *
 * Building requires a connected account (rule D10). The batch is authored against a real address,
 * so a disconnected build would have to substitute a placeholder for one — and a placeholder that
 * looks like an address is exactly the plausible value the rule forbids. The demo panel requires
 * the same thing, for the same reason.
 *
 * `feedGuard` is pinned configuration, never discovery. When `VITE_FEED_GUARD` is unset the step
 * targets the session account and decodes as unnamed hex; `DemoPanel` states that on the page
 * rather than leaving the substitution to be inferred.
 */
export function AppShell() {
  const state = useApp();
  const dispatch = useDispatch();

  const build = () => {
    if (state.account === null) {
      dispatch({
        type: "error/set",
        error: {
          code: "NO_ACCOUNT",
          message:
            "Connect a wallet first. The plan is built against your account's address, so there is no batch to author without one.",
        },
      });
      return;
    }

    const account = state.account;
    const feedGuard = isConfigured(DEPLOYMENT.feedGuard) ? DEPLOYMENT.feedGuard : account;

    // The floor is parsed, never defaulted. A minimum output nobody chose is the exact failure the
    // batch exists to prevent, so an unreadable bound stops the build with a message instead.
    const minAmountOut = parseAmount(state.bounds.minOutput, 18);
    if (minAmountOut === null) {
      dispatch({
        type: "error/set",
        error: {
          code: "BAD_MIN_OUTPUT",
          message: `Minimum output "${state.bounds.minOutput}" is not a number. Set it before building.`,
        },
      });
      return;
    }

    dispatch({
      type: "build/ready",
      calls: buildDemoBatch({ account, feedGuard, minAmountOut }),
    });
  };

  return (
    <div className="app-shell">
      <SkipLink />
      <SiteHeader phase={state.phase} />

      <main className="app-main">
        <Hero />
        <HowItWorks />
        <Workbench onBuild={build} />
        <Honesty />
      </main>

      <SiteFooter />
    </div>
  );
}
