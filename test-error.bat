@echo off
rem TEST-ERROR: deliberately breaks the target to show an error in the monitor, then repairs it.
rem   Default: injects the error, shows it, repairs it.    test-error.bat keep  = leave the error in place (look at the monitor), then run test-error-repair.bat
cd /d "%~dp0"
call "%~dp0_check.bat" || goto :end
if /i "%~1"=="keep" (docker compose run --rm tools chaos --keep) else (docker compose run --rm tools chaos)
:end
echo.
pause
