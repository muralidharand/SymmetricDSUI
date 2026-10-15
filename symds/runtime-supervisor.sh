#!/bin/sh
# Container entrypoint of "sym-runtime": runs the SymmetricDS server for the sync pairs created in the monitor UI.
# The UI writes engine files (<engine>.properties) into the shared volume mounted at the engines folder.
# SymmetricDS reads engine files only at startup, so this supervisor restarts the server whenever the set/content of
# the files changes (a few seconds of interruption), and stops it when there are no engines.
ENG=/opt/symmetric-ds/engines
pid=""
last="none"

stop_server() {
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "[supervisor] stopping SymmetricDS (pid $pid)"
    kill "$pid" 2>/dev/null
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  fi
  pid=""
}
trap 'stop_server; exit 0' TERM INT

sig() { for f in "$ENG"/*.properties; do [ -f "$f" ] && { echo "$f"; cat "$f"; }; done 2>/dev/null | cksum; }
count() { n=0; for f in "$ENG"/*.properties; do [ -f "$f" ] && n=$((n+1)); done; echo $n; }

chmod 0777 "$ENG" 2>/dev/null   # the monitor container (user node) writes engine files here
echo "[supervisor] watching $ENG"
while true; do
  cur=$(sig); n=$(count)
  if [ "$cur" != "$last" ]; then
    last="$cur"
    stop_server
    if [ "$n" -gt 0 ]; then
      echo "[supervisor] $n engine file(s) -> starting SymmetricDS"
      /opt/symmetric-ds/bin/sym &
      pid=$!
    else
      echo "[supervisor] no engines configured - idle"
    fi
  elif [ "$n" -gt 0 ] && { [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; }; then
    echo "[supervisor] SymmetricDS is not running - restarting in 10s"
    sleep 10
    /opt/symmetric-ds/bin/sym &
    pid=$!
  fi
  sleep 3 &
  wait $! 2>/dev/null
done
