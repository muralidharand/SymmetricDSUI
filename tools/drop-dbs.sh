#!/bin/bash
# Drops AW_Source and AW_Target (used by db-restore; mssql-init restores them from the .bak on the next start).
source /tools/lib.sh
SQL -Q "
IF DB_ID('AW_Source') IS NOT NULL BEGIN ALTER DATABASE AW_Source SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE AW_Source; END
IF DB_ID('AW_Target') IS NOT NULL BEGIN ALTER DATABASE AW_Target SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE AW_Target; END" && echo "databases dropped"
