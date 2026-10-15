@echo off
rem Called by the other launchers: makes sure Docker Desktop is running (starts it if not), .env exists, and the .bak is present.
cd /d "%~dp0"
docker info >nul 2>&1
if not errorlevel 1 goto :dockerok
echo Docker is not running. Starting Docker Desktop - this can take a minute or two...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
for /l %%i in (1,1,48) do (
  timeout /t 5 /nobreak >nul
  docker info >nul 2>&1 && goto :dockerok
  echo   still waiting for Docker...
)
echo.
echo ERROR: Docker did not become ready. Start Docker Desktop manually and wait for "Engine running", then retry.
exit /b 1
:dockerok
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Created .env from .env.example ^(edit it to change the default passwords, before the first start^).
)
if /i "%~1"=="bak" if not exist "data\AdventureWorksLT2022.bak" (
  echo.
  echo ERROR: data\AdventureWorksLT2022.bak is missing.
  echo        Copy your AdventureWorksLT2022.bak file into the "data" folder next to this script, then run again.
  exit /b 1
)
exit /b 0
