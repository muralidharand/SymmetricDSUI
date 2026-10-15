@echo off
rem STOP: stops all containers, keeps all data. Use start.bat to resume.
call "%~dp0config.bat"
wsl -d %DISTRO% -e bash -lc "cd %REPO% && scripts/stop.sh"
echo.
pause
