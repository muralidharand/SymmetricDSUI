@echo off
rem Called by the other launchers. Checks WSL distro, Docker, repo (and optionally the .bak: call with argument  bak ).
rem Starts Docker Desktop if it is not running.

wsl %WSLD% -e bash -lc "true" >nul 2>&1
if errorlevel 1 goto :nodistro

wsl %WSLD% -e bash -lc "docker info >/dev/null 2>&1"
if not errorlevel 1 goto :dockerok
echo Docker is not responding from inside WSL. Starting Docker Desktop, this can take a minute or two...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
for /l %%i in (1,1,48) do (
  timeout /t 5 /nobreak >nul
  wsl %WSLD% -e bash -lc "docker info >/dev/null 2>&1" && goto :dockerok
  echo   still waiting for Docker...
)
goto :nodocker

:dockerok
wsl %WSLD% -e bash -lc "test -f %REPO%/scripts/up.sh"
if errorlevel 1 goto :norepo
if /i "%~1"=="bak" (
  wsl %WSLD% -e bash -lc "test -f %REPO%/data/AdventureWorksLT2022.bak"
  if errorlevel 1 goto :nobak
)
exit /b 0

:nodistro
echo.
echo ERROR: cannot start a Linux shell in WSL
if defined DISTRO (echo        Distro named "%DISTRO%" was not found.) else (echo        No usable default WSL distro. Docker Desktop alone is not enough - you need Ubuntu.)
echo.
echo   Installed distros:
wsl -l -v
echo.
echo   FIX: 1^) If only docker-desktop is listed, open PowerShell and run:  wsl --install -d Ubuntu
echo           then reboot, open Ubuntu once and create your Linux user.
echo        2^) If an Ubuntu is listed under another name, put that exact name in DISTRO in config.bat.
echo        3^) Docker Desktop - Settings - Resources - WSL integration - enable that distro - Apply.
exit /b 1

:nodocker
echo.
echo ERROR: Docker did not become ready inside WSL.
echo   Open Docker Desktop and check it says "Engine running".
echo   Docker Desktop - Settings - Resources - WSL integration - enable your distro - Apply and restart.
exit /b 1

:norepo
echo.
echo ERROR: project not found at %REPO% inside WSL.
echo   Open your Ubuntu terminal and run:
echo     git clone -b add-monitor-ui https://github.com/muralidharand/symmetricdsui.git ~/symmetricdsui
echo   or change REPO in config.bat to where you cloned it.
exit /b 1

:nobak
echo.
echo ERROR: %REPO%/data/AdventureWorksLT2022.bak is missing.
echo   Copy it in from Windows, in the Ubuntu terminal:
echo     cp "/mnt/c/Users/YOUR-USER/Downloads/AdventureWorksLT2022.bak" %REPO%/data/
exit /b 1
