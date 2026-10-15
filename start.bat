@echo off
rem START: first run = build, restore databases, configure sync, initial load. Later runs = resume (data kept).
cd /d "%~dp0"
call "%~dp0_check.bat" bak ports || goto :end
echo Starting SQL Server, SymmetricDS nodes and the monitor ^(first run downloads images, ~10 min^)...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo *** start failed - see the messages above. To see logs:  docker compose logs ***
  goto :end
)
docker compose run --rm tools wait-parity
echo.
echo Monitor UI : http://localhost:%MONITOR_PORT%   ^(sign in: user "admin", password = MONITOR_ADMIN_PASSWORD in .env^)
echo SSMS       : server name  localhost,%MSSQL_PORT%   ^(comma^), SQL Server Authentication, login sa, password = MSSQL_SA_PASSWORD in .env,
echo              Options - tick "Trust server certificate"
start "" http://localhost:%MONITOR_PORT%
:end
echo.
pause
