#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
pnpm exec tsx scripts/demo/05-agent-pays.mts
