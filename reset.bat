@echo off
rem RESET: removes all containers AND the SQL Server data volume. Next start.bat rebuilds everything from the .bak.
cd /d "%~dp0"
echo This deletes everything this project created in Docker (databases, sync state).
set "CONFIRM="
set /p "CONFIRM=Type YES to continue: "
if /i not "%CONFIRM%"=="YES" (echo Aborted. & goto :end)
docker compose down -v
:end
echo.
pause
