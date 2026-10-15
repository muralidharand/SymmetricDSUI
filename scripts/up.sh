#!/bin/bash
# Start everything (first run: full setup). SKIP_MONITOR=1 skips building the monitor image.
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
[ -f data/AdventureWorksLT2022.bak ] || { echo "ERROR: put AdventureWorksLT2022.bak in ./data/"; exit 1; }
if [ -n "$SKIP_MONITOR" ]; then docker compose up -d mssql mssql-init sym-source sym-config sym-target; else docker compose up -d --build; fi || exit 1
docker compose run --rm tools wait-parity
