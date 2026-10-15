@echo off
rem STATUS: containers, nodes, batch counts, failing batches, parity.
call "%~dp0config.bat"
call "%~dp0_ensure-docker.bat" || goto :end
wsl %WSLD% -e bash -lc "cd %REPO% && scripts/status.sh"
:end
echo.
pause
