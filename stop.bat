@echo off
rem STOP: stops all containers, keeps all data. Use start.bat to resume.
cd /d "%~dp0"
docker compose stop
echo.
echo Stopped. Data is kept. Run start.bat to resume.
pause
