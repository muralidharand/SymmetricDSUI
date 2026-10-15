@echo off
rem DB-RESTORE: drops AW_Source + AW_Target, restores both again from data\AdventureWorksLT2022.bak, re-runs the initial load.
cd /d "%~dp0"
echo.
echo  This will DELETE both databases (AW_Source, AW_Target) and the sync state,
echo  restore them from data\AdventureWorksLT2022.bak and run the initial load again.
echo.
set "CONFIRM="
set /p "CONFIRM=Type YES to continue: "
if /i not "%CONFIRM%"=="YES" (
  echo Aborted.
  goto :end
)
call "%~dp0_check.bat" bak || goto :end
docker compose rm -sf monitor sym-target sym-config sym-source
docker compose up -d mssql
docker compose run --rm tools drop-dbs
if errorlevel 1 goto :failed
docker compose up -d --build
if errorlevel 1 goto :failed
docker compose run --rm tools wait-parity
start "" http://localhost:8080
goto :end
:failed
echo.
echo *** restore failed - see the messages above ***
:end
echo.
pause
