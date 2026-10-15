@echo off
rem Called by the other launchers: checks WSL + Docker, starts Docker Desktop if it is not running.
wsl -d %DISTRO% -e true >nul 2>&1
if errorlevel 1 (
  echo ERROR: WSL distro "%DISTRO%" not found or not startable.
  echo        Run  wsl -l -q  to see your distros, then edit DISTRO in config.bat.
  exit /b 1
)
wsl -d %DISTRO% -e bash -lc "docker info >/dev/null 2>&1"
if not errorlevel 1 exit /b 0
echo Docker is not responding. Starting Docker Desktop, this can take a minute or two...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
for /l %%i in (1,1,48) do (
  timeout /t 5 /nobreak >nul
  wsl -d %DISTRO% -e bash -lc "docker info >/dev/null 2>&1" && exit /b 0
  echo   still waiting for Docker...
)
echo ERROR: Docker did not become ready. Open Docker Desktop, check Settings - Resources - WSL integration for "%DISTRO%".
exit /b 1
