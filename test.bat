@echo off
rem TEST: runs the smoke test = insert/update/delete on the source, waits, proves the target matches.
cd /d "%~dp0"
call "%~dp0_check.bat" || goto :end
docker compose run --rm tools smoke
echo.
echo Watch it in the monitor: http://localhost:%MONITOR_PORT%  ^(Live feed / Batches^)
:end
echo.
pause
