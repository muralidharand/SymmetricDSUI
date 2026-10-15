@echo off
rem STOP: stops all containers, keeps all data. Use start.bat to resume.
call "%~dp0config.bat"
call "%~dp0_ensure-docker.bat" || goto :end
wsl %WSLD% -e bash -lc "cd %REPO% && scripts/stop.sh"
:end
echo.
pause
