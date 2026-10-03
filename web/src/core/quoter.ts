import type { Address, PublicClient } from "viem";

/**
 * Uniswap V3 Quoter ABI (quoteExactInputSingle).
 * Matches Uniswap v3-periphery v1.0.0 and selector 0xf7729d43.
 */
export const UNISWAP_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export const BPS_DENOMINATOR = 10_000n;

/**
 * Calculate the minimum acceptable amount out given a slippage tolerance in basis points.
 * minOut = floor(amountOut * (10_000 - slippageBps) / 10_000).
 */
export function calculateMinOut(amountOut: bigint, slippageBps: bigint): bigint {
  if (slippageBps < 0n || slippageBps >= BPS_DENOMINATOR) {
    throw new Error(`Invalid slippage: ${slippageBps.toString()} bps (must be 0 <= bps < 10000)`);
  }
  return (amountOut * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR;
}

export interface OffchainQuoteParams {
  readonly quoter: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly fee?: number;
  readonly amountIn: bigint;
  readonly slippageBps: bigint;
  readonly sqrtPriceLimitX96?: bigint;
}

export interface OffchainQuoteResult {
  readonly amountOut: bigint;
  readonly minAmountOut: bigint;
}

/**
 * Derives a swap quote off-chain via eth_call against the deployed Uniswap Quoter.
 *
 * Per ADR-0006 and V-25, Uniswap's Quoter cannot be called via on-chain STATICCALL
 * because IUniswapV3Pool.swap emits a Swap event (LOG is illegal in static context).
 * Over eth_call (readContract), it simulates statefully without committing state.
 */
export async function getOffchainQuote(
  client: PublicClient,
  params: OffchainQuoteParams,
): Promise<OffchainQuoteResult> {
  const {
    quoter,
    tokenIn,
    tokenOut,
    fee = 3000,
    amountIn,
    slippageBps,
    sqrtPriceLimitX96 = 0n,
  } = params;

  const amountOut = await client.readContract({
    address: quoter,
    abi: UNISWAP_QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96],
  });

  const minAmountOut = calculateMinOut(amountOut, slippageBps);

  return {
    amountOut,
    minAmountOut,
  };
}