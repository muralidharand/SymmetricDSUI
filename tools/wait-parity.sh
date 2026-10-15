#!/bin/bash
# Wait (default 5 min) until the target equals the source (initial load finished).
source /tools/lib.sh
limit=${1:-60}
echo -n "waiting for the initial load to finish"
for i in $(seq 1 "$limit"); do
  if bash /tools/parity.sh --quiet >/dev/null 2>&1; then echo; bash /tools/parity.sh; exit 0; fi
  echo -n .; sleep 5
done; echo
echo "WARNING: source and target not identical after $((limit*5))s. Run status and see README troubleshooting."
bash /tools/parity.sh; exit 1
