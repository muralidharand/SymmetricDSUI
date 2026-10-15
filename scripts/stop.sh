#!/bin/bash
# Stop all containers, KEEP data (databases + sync state). Resume with scripts/up.sh.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
docker compose stop
echo "Stopped. Data kept. Start again with scripts/up.sh"
