#!/usr/bin/env bash
# Fetches contract libraries. On Windows, aave-v3-origin contains paths Windows cannot create
# (certora/**/aux), so only its src/ is extracted with git archive. See docs/DECISIONS.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
git submodule update --init packages/contracts/lib/openzeppelin-contracts packages/contracts/lib/forge-std packages/contracts/lib/aave-address-book
ORIGIN=packages/contracts/lib/aave-address-book/lib/aave-v3-origin
COMMIT=$(git -C packages/contracts/lib/aave-address-book ls-tree HEAD lib/aave-v3-origin | awk '{print $3}')
if [ ! -d "$ORIGIN/src/contracts" ]; then
  mkdir -p "$ORIGIN"
  git -C "$ORIGIN" init -q 2>/dev/null || true
  git -C "$ORIGIN" fetch -q --depth 1 https://github.com/aave-dao/aave-v3-origin "$COMMIT"
  (cd "$ORIGIN" && git archive "$COMMIT" src | tar -x)
fi
echo "libs ready (aave-v3-origin @ $COMMIT)"
