@echo off
rem Called by the other launchers (no setlocal on purpose: the port variables below are used by the caller).
rem   call _check.bat [bak] [ports]     bak = require the .bak file;  ports = fail early if a host port is already in use
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
  echo Created .env from .env.example ^(edit it to change the default passwords or ports, before the first start^).
)
rem ---- read the host ports from .env (defaults match .env.example) ----
set "MSSQL_PORT=14330"
set "SYM_SOURCE_PORT=41415"
set "SYM_TARGET_PORT=41416"
set "MONITOR_PORT=18080"
set "TESTER_PORT=19090"
set "RUNTIME_PORT=41417"
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
  if /i "%%a"=="MSSQL_PORT" set "MSSQL_PORT=%%b"
  if /i "%%a"=="SYM_SOURCE_PORT" set "SYM_SOURCE_PORT=%%b"
  if /i "%%a"=="SYM_TARGET_PORT" set "SYM_TARGET_PORT=%%b"
  if /i "%%a"=="MONITOR_PORT" set "MONITOR_PORT=%%b"
  if /i "%%a"=="TESTER_PORT" set "TESTER_PORT=%%b"
  if /i "%%a"=="RUNTIME_PORT" set "RUNTIME_PORT=%%b"
)
if /i "%~1"=="bak" goto :bak
if /i "%~2"=="bak" goto :bak
goto :ports
:bak
if not exist "data\AdventureWorksLT2022.bak" (
  echo.
  echo ERROR: data\AdventureWorksLT2022.bak is missing.
  echo        Copy your AdventureWorksLT2022.bak file into the "data" folder next to this script, then run again.
  exit /b 1
)
:ports
if /i not "%~1"=="ports" if /i not "%~2"=="ports" exit /b 0
rem If this project's containers are already running, their ports are of course "in use" - skip the check.
set "RUNNING="
for /f %%i in ('docker compose ps -q --status running 2^>nul') do set "RUNNING=1"
if defined RUNNING exit /b 0
set "BUSY="
call :chk MSSQL_PORT %MSSQL_PORT%
call :chk SYM_SOURCE_PORT %SYM_SOURCE_PORT%
call :chk SYM_TARGET_PORT %SYM_TARGET_PORT%
call :chk MONITOR_PORT %MONITOR_PORT%
call :chk TESTER_PORT %TESTER_PORT%
call :chk RUNTIME_PORT %RUNTIME_PORT%
if defined BUSY (
  echo.
  echo Another program or Docker container already uses the port^(s^) above.
  echo Open the file ".env" in Notepad, change those port numbers to free ones ^(e.g. add 1000^), save, and run again.
  exit /b 1
)
exit /b 0

:chk
netstat -ano | findstr /R /C:":%2 .*LISTENING" >nul
if not errorlevel 1 (
  echo ERROR: port %2 ^(%1 in .env^) is already in use on this PC.
  set "BUSY=1"
)
exit /b 0
