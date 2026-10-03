/**
 * Limits and defaults for the client.
 */

/**
 * The most entries one batch may contain.
 *
 * This is a reviewability limit, not a protocol limit. The engine imposes no cap that the client
 * could discover, so a cap has to come from somewhere, and the question to ask is not "what will the
 * chain accept" but "how many steps can a person actually check before they sign".
 *
 * The demo is six entries, which fits one screen with every gate visible. Ten is the point past
 * which the list needs scrolling, and a gate the user has to scroll to find is a gate that gets
 * approved unread. A larger batch is not rejected outright by this library; call
 * `BatchBuilder.encode` with an explicit `maxEntries` to raise the limit deliberately, so the
 * decision is recorded rather than silently taken.
 */
export const MAX_ENTRIES = 10;

/** Canonical 3000, the Uniswap V3 default. Zero means "unset" to the module. */
export const DEFAULT_FEE = 3000;