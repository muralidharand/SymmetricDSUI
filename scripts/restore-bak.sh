#!/bin/bash
# Restore a .bak from ./data:  scripts/restore-bak.sh AdventureWorks2022.bak [DatabaseName] [--replace] [--no-grant]
cd "$(dirname "$0")/.."
docker compose up -d mssql >/dev/null && docker compose run --rm tools restore-bak "$@"
