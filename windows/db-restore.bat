@echo off
rem DB-RESTORE: drops AW_Source + AW_Target, re-restores them from data\AdventureWorksLT2022.bak and re-initialises the sync.
call "%~dp0config.bat"
echo.
echo  This will DELETE both databases (AW_Source, AW_Target) and all sync state,
echo  restore them from the .bak file, and run the initial load again.
echo.
set "CONFIRM="
set /p "CONFIRM=Type YES to continue: "
if /i not "%CONFIRM%"=="YES" (
  echo Aborted.
  goto :end
)
call "%~dp0_ensure-docker.bat" bak || goto :end
wsl %WSLD% -e bash -lc "cd %REPO% && scripts/restore-db.sh --yes"
if errorlevel 1 (echo. & echo *** restore failed - see messages above ***) else (start "" http://localhost:8080)
:end
echo.
pause
