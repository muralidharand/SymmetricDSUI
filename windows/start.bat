@echo off
rem START: first run = restore DBs + configure + initial load; later runs = resume (data kept).
call "%~dp0config.bat"
call "%~dp0_ensure-docker.bat" bak || goto :end
wsl %WSLD% -e bash -lc "cd %REPO% && scripts/up.sh"
if errorlevel 1 (
  echo.
  echo *** start failed - see messages above. Try status.bat, and docs/LOCAL-SETUP-WINDOWS11.md section 8 ***
) else (
  echo.
  echo Opening the monitor...
  start "" http://localhost:8080
)
:end
echo.
pause
