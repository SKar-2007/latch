import { describe, expect, it, vi } from "vitest";
import { calculateMinOut, getOffchainQuote, UNISWAP_QUOTER_ABI } from "../src/core/quoter";
import type { Address, PublicClient } from "viem";

describe("calculateMinOut", () => {
  it("computes exact slippage bounds correctly", () => {
    // 100 WETH (100e18) with 50 bps (0.5%) slippage -> 99.5 WETH
    const amountOut = 100_000_000_000_000_000_000n;
    const minOut = calculateMinOut(amountOut, 50n);
    expect(minOut).toBe(99_500_000_000_000_000_000n);
  });

  it("handles 0 bps slippage (exact quote)", () => {
    const amountOut = 50_000_000n;
    expect(calculateMinOut(amountOut, 0n)).toBe(50_000_000n);
  });

  it("rejects invalid slippage values >= 10000 or negative", () => {
    expect(() => calculateMinOut(100n, 10_000n)).toThrow();
    expect(() => calculateMinOut(100n, -1n)).toThrow();
  });
});

describe("getOffchainQuote", () => {
  it("calls quoteExactInputSingle via client.readContract and returns floored minAmountOut", async () => {
    const mockClient = {
      readContract: vi.fn().mockResolvedValue(100_000_000_000_000_000n), // 0.1 WETH
    } as unknown as PublicClient;

    const result = await getOffchainQuote(mockClient, {
      quoter: "0x1111111111111111111111111111111111111111" as Address,
      tokenIn: "0x2222222222222222222222222222222222222222" as Address,
      tokenOut: "0x3333333333333333333333333333333333333333" as Address,
      fee: 3000,
      amountIn: 15_000_000n, // 15 USDC
      slippageBps: 50n,
    });

    expect(mockClient.readContract).toHaveBeenCalledWith({
      address: "0x1111111111111111111111111111111111111111",
      abi: UNISWAP_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        "0x2222222222222222222222222222222222222222",
        "0x3333333333333333333333333333333333333333",
        3000,
        15_000_000n,
        0n,
      ],
    });

    expect(result.amountOut).toBe(100_000_000_000_000_000n);
    expect(result.minAmountOut).toBe(99_500_000_000_000_000n);
  });
});