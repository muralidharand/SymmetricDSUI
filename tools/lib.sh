#!/bin/bash
# Helpers for the "tools" container. Connects to the SQL Server service "mssql" as sa.
SQL() { /opt/mssql-tools18/bin/sqlcmd -C -I -S "${MSSQL_HOST:-mssql}" -U sa -P "$MSSQL_SA_PASSWORD" -W -b "$@"; }
SQLQ() { SQL -h -1 "$@" | tr -d '[:space:]'; }   # single value, no whitespace
