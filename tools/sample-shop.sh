#!/bin/bash
# Creates two sample databases to try the sync wizard with: Shop_A (source, with data) and Shop_B (target, empty schema),
# plus the logins used by the wizard. Usage: docker compose run --rm tools sample-shop [--second-instance]
#   --second-instance  creates Shop_B on the extra SQL Server (service mssql2, profile extra-sql) instead of the main one.
source /tools/lib.sh
two=""; [ "$1" = "--second-instance" ] && two=1
for db in Shop_A Shop_B; do
  host=${MSSQL_HOST:-mssql}; [ "$db" = Shop_B ] && [ -n "$two" ] && host=mssql2
  MSSQL_HOST=$host SQL -Q "IF DB_ID('$db') IS NULL CREATE DATABASE [$db];" || exit 1
  MSSQL_HOST=$host SQL -v db=$db -i /tools/sample-shop-schema.sql || exit 1
  # login for the wizard: db_owner on the sample DB only
  MSSQL_HOST=$host SQL -Q "IF SUSER_ID('shopsync') IS NULL CREATE LOGIN shopsync WITH PASSWORD='${SHOPSYNC_PASSWORD:-Shop_Sync_Str0ng!1}', CHECK_POLICY=OFF;"
  MSSQL_HOST=$host SQL -d "$db" -Q "IF USER_ID('shopsync') IS NULL CREATE USER shopsync FOR LOGIN shopsync; ALTER ROLE db_owner ADD MEMBER shopsync;"
done
SQL -i /tools/sample-shop-data.sql || exit 1
echo
echo "Sample databases ready."
echo "  Source: Shop_A on host 'mssql' port 1433   (user shopsync / ${SHOPSYNC_PASSWORD:-Shop_Sync_Str0ng!1})"
if [ -n "$two" ]; then echo "  Target: Shop_B on host 'mssql2' port 1433  (same login)"; else echo "  Target: Shop_B on host 'mssql' port 1433   (same login)"; fi
echo "  Tables: shop.Category, Customer, Product, Order, OrderLine (+ AuditNote with no primary key: the wizard will refuse it)"
