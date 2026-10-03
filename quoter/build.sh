#!/usr/bin/env bash
# Recompile Uniswap's Quoter from the pinned v3-periphery tag into quoter/Quoter.hex.
#
# Pinned deliberately. This project is solc 0.8.23; Uniswap's Quoter is `=0.7.6`. Recompiling audited
# source under a different compiler is a quiet change that is hard to spot and worse to ship, so the
# quoter is compiled once with the compiler and settings Uniswap shipped against, and the result is
# committed. Deploy.s.sol asserts the deployed runtime carries selector 0xf7729d43, so if this is
# ever regenerated from something that is not Uniswap's Quoter, the deploy refuses.
set -euo pipefail
cd "$(dirname "$0")/.."

solc="${SOLC_0_7_6:-$HOME/.svm/0.7.6/solc-0.7.6}"
"$solc" --version | head -1

out=$("$solc" \
  --base-path . --allow-paths . \
  "@uniswap/v3-core/=lib/v3-core/" \
  --optimize --optimize-runs 1000000 --evm-version istanbul \
  --bin lib/v3-periphery/contracts/lens/Quoter.sol)

python3 - "$out" <<'PY'
import re, sys, hashlib
blocks = re.findall(r'======= (\S+) =======\nBinary:\n([0-9a-f]+)', sys.argv[1])
name = [b for b in blocks if b[0].endswith(':Quoter')]
assert len(name) == 1, f"expected exactly one Quoter, got {[b[0] for b in blocks]}"
code = name[0][1]
assert 'f7729d43' in code, "compiled code lacks quoteExactInputSingle(0xf7729d43)"
assert '1296323f' not in code, "compiled code exposes the transposed selector"
open('quoter/Quoter.hex', 'w').write("0x" + code + "\n")
print(f"wrote quoter/Quoter.hex  {len(code)//2} bytes")
print(f"sha256 {hashlib.sha256(bytes.fromhex(code)).hexdigest()}")
PY
