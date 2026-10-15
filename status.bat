@echo off
rem STATUS: containers, nodes, batch counts, failing batches, parity.
cd /d "%~dp0"
call "%~dp0_check.bat" || goto :end
docker compose ps
docker compose run --rm tools status
:end
echo.
pause
