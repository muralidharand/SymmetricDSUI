#!/bin/bash
# Start everything (first run: full setup). SKIP_MONITOR=1 skips building the monitor image.
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
[ -f data/AdventureWorksLT2022.bak ] || { echo "ERROR: put AdventureWorksLT2022.bak in ./data/"; exit 1; }
# port preflight (skipped when this project's containers are already running)
if [ -z "$(docker compose ps -q --status running 2>/dev/null)" ]; then
  set -a; . ./.env; set +a; busy=0
  for kv in MSSQL_PORT:14330 SYM_SOURCE_PORT:41415 SYM_TARGET_PORT:41416 MONITOR_PORT:18080 RUNTIME_PORT:41417; do
    name=${kv%%:*}; port=${!name:-${kv##*:}}
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "ERROR: port $port ($name in .env) is already in use"; busy=1; fi
  done
  [ $busy = 0 ] || { echo "Change the port(s) in .env and run again."; exit 1; }
fi
if [ -n "$SKIP_MONITOR" ]; then docker compose up -d mssql mssql-init sym-source sym-config sym-target sym-runtime; else docker compose up -d --build; fi || exit 1
docker compose run --rm tools wait-parity
