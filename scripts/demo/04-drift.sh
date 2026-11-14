#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
pnpm exec tsx scripts/demo/walkthrough.mts 04
