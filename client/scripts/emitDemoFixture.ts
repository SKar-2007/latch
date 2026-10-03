/**
 * Writes the demo batch's calldata to `test/fixtures/demo-batch.abi.json`.
 *
 * Run with `npm run emit:demo`. Deliberately not a test: a test that regenerates its own fixture
 * always passes and leaves the working tree dirty, so the fork test would stop being able to notice
 * a change in what the batch actually says.
 *
 * The Solidity side (`test/fork/DemoBatch.t.sol`) reads the same file, so the batch the fork test
 * executes is byte-for-byte the batch the client builds.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoBatch, buildFailingDemoBatch, BASE_SEPOLIA } from "../src/demoBatch";
import { encodeBatch } from "../src/builder";

/**
 * The account the fork test funds and spends.
 *
 * A fixed address, because it is baked into the batch's `STATIC_CALL` fetches. Changing it means
 * regenerating the fixture, which is the correct outcome: the batch really would encode differently.
 */
const ACCOUNT = "0x1234567890123456789012345678901234567890";

/**
 * Where `FeedGuard` is expected to live on the fork.
 *
 * The fork test etches the guard's runtime code here rather than deploying it, so the address in the
 * batch is stable across runs and the fixture does not have to be regenerated per run.
 */
const FEED_GUARD = "0x00000000000000000000000000000000000000AA";

/**
 * 0.001 WETH.
 *
 * @dev Unreachable on purpose for the failing variant, and deliberately far below any real quote for
 *      the working one. A floor derived from a live quote would make the fixture depend on pool state
 *      at generation time, which is not reproducible. The point of the working batch is that the swap
 *      clears the bound, not that the bound was well chosen; docs/04 covers how a real client would
 *      derive it.
 */
const MIN_AMOUNT_OUT = 1_000_000_000_000_000n;

const options = { account: ACCOUNT, feedGuard: FEED_GUARD, minAmountOut: MIN_AMOUNT_OUT };

const working = buildDemoBatch(options);
const failing = buildFailingDemoBatch(options);

const payload = {
  account: ACCOUNT,
  feedGuard: FEED_GUARD,
  minAmountOut: `0x${MIN_AMOUNT_OUT.toString(16)}`,
  addresses: BASE_SEPOLIA,
  working: encodeBatch(working),
  failing: encodeBatch(failing),
  stepCount: working.length,
};

const target = fileURLToPath(new URL("../test/fixtures/demo-batch.abi.json", import.meta.url));
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`wrote ${target}`);
console.log(`  entries       ${working.length}`);
console.log(`  working bytes ${(payload.working.length - 2) / 2}`);
console.log(`  failing bytes ${(payload.failing.length - 2) / 2}`);