@echo off
rem SAMPLE-DATABASES: creates two extra sample databases (Shop_A with data, Shop_B empty) on the SQL Server in Docker,
rem so you can try the "Sync jobs" wizard on a database other than AdventureWorks. Safe to run again.
cd /d "%~dp0"
call "%~dp0_check.bat" || goto :end
docker compose up -d mssql
docker compose run --rm tools sample-shop
echo.
echo In the monitor: Connections - Add connection (host mssql, port 1433, user shopsync, password Shop_Sync_Str0ng!1), once for Shop_A and once for Shop_B.
echo Then Sync jobs - New sync.   Details: docs\ADD-YOUR-OWN-DATABASE.md
:end
echo.
pause
