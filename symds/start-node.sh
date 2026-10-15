#!/bin/sh
# Container entrypoint for a SymmetricDS node: render engines/<name>.properties from the template
# (replacing CHANGE_ME with $SYMDS_DB_PASSWORD) and run the server in the foreground.
set -e
name="$1"
awk 'BEGIN{pw=ENVIRON["SYMDS_DB_PASSWORD"]} {while((i=index($0,"CHANGE_ME"))>0) $0=substr($0,1,i-1) pw substr($0,i+9); print}' \
  "/symds/engines/$name.properties.example" | tr -d '\r' > "/opt/symmetric-ds/engines/$name.properties"
exec /opt/symmetric-ds/bin/sym
