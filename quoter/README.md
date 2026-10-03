# Uniswap `Quoter`, compiled once and committed

`Quoter.hex` is Uniswap's own `Quoter`, compiled from `lib/v3-periphery` at tag **v1.0.0** — the
release Uniswap's Base deployment table pins for chain 84532. Rebuild it with `./build.sh`.

| | |
|---|---|
| Source | `Uniswap/v3-periphery@v1.0.0`, `contracts/lens/Quoter.sol` |
| Compiler | `solc 0.7.6+commit.7338295f` |
| Optimizer | on, 1,000,000 runs |
| EVM version | `istanbul` |
| Creation code | 4,878 bytes |
| `sha256` | `22f010280126aa9ea71c9436994ec6c2602c22ffad6c23e68930d0b5ede8780a` |
| Dispatch selector | `0xf7729d43` — `quoteExactInputSingle(address,address,uint24,uint256,uint160)` |

## Why the bytecode is committed instead of imported

`Quoter` is `pragma solidity =0.7.6`; this project is `0.8.23`. Importing it would need a second
compiler profile, and LATCH does not compile Uniswap's audited source under a different compiler than
Uniswap did. So the quoter is compiled once, with the compiler and settings Uniswap shipped against,
and the result is committed. Nothing recompiles it during a normal build, so the deploy cannot drift
with a toolchain bump.

`Deploy.s.sol` asserts the deployed runtime carries selector `0xf7729d43` and fails the deploy
otherwise, and `build.sh` asserts the same before writing the file. If this artifact is ever
regenerated from something that is not Uniswap's `Quoter`, both checks fail loudly.

## Why LATCH deploys its own quoter

V-23: no third-party address on Base Sepolia implements `quoteExactInputSingle`. Uniswap's
deployments page lists `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` as the Base Sepolia `QuoterV2`,
but its bytecode lacks both `0x1296323f` and `0x9b5e78b7` and answers to no real Uniswap signature.

Deploying here also means the address is known before the broadcast rather than discovered after, and
that no test depends on someone else's deployment staying where it was.

## And why it still is not used on-chain

V-25: Uniswap's Quoter cannot be reached through a `STATICCALL`, because `IUniswapV3Pool.swap` emits
a `Swap` event and `LOG` is illegal in a static context. Over `CALL` it works — 0.095452706967269650
WETH for 15 USDC on the fee-3000 pool — but `QuoterGuard` is `view` and takes the quoter address as an
argument, so switching to `CALL` would let an arbitrary caller-chosen contract mutate state mid-check.

Quote off-chain, enforce the bound on-chain. The batch already carries `amountOutMin`.

## Reproducing

Needs `solc 0.7.6` in `~/.svm/0.7.6/solc-0.7.6`, or set `SOLC_0_7_6`. `build.sh` prints the sha256, so
a rebuild that does not reproduce it byte-for-byte is visible immediately.