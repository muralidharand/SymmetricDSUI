@echo off
rem RESTORE-DATABASE: restores a .bak that is in the "data" folder into the SQL Server in Docker.
rem   restore-database.bat AdventureWorks2022.bak                 restore as database "AdventureWorks2022"
rem   restore-database.bat AdventureWorks2022.bak MyName          restore under another database name
rem   restore-database.bat AdventureWorks2022.bak --replace       overwrite the database if it already exists
rem   restore-database.bat                                        interactive: lists the backups and asks
cd /d "%~dp0"
call "%~dp0_check.bat" || goto :end
docker compose up -d mssql
if not "%~1"=="" (
  docker compose run --rm tools restore-bak %*
  goto :end
)
echo.
echo Backups in the "data" folder:
dir /b data\*.bak 2>nul
echo.
set "BAKFILE="
set "DBNAME="
set "REPL="
set /p "BAKFILE=Backup file name (for example AdventureWorks2022.bak): "
if "%BAKFILE%"=="" goto :end
set /p "DBNAME=Database name [Enter = same as the file name]: "
set /p "REPL=Overwrite if the database already exists? (y/N): "
set "ARGS="%BAKFILE%""
if not "%DBNAME%"=="" set "ARGS=%ARGS% "%DBNAME%""
if /i "%REPL%"=="y" set "ARGS=%ARGS% --replace"
docker compose run --rm tools restore-bak %ARGS%
:end
echo.
pause
