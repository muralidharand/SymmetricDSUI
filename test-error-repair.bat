@echo off
rem Repairs the error created by "test-error.bat keep" and waits until source and target match again.
cd /d "%~dp0"
call "%~dp0_check.bat" || goto :end
docker compose run --rm tools chaos-repair
:end
echo.
pause
