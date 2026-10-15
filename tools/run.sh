#!/bin/bash
# Dispatcher: docker compose run --rm tools <command> [args]
cmd="$1"; shift
[ -f "/tools/$cmd.sh" ] || { echo "unknown command '$cmd'. Available:"; ls /tools | sed -n 's/\.sh$//p' | grep -vE '^(lib|run)$'; exit 2; }
exec bash "/tools/$cmd.sh" "$@"
