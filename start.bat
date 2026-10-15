@echo off
rem START: first run = build, restore databases, configure sync, initial load. Later runs = resume (data kept).
cd /d "%~dp0"
call "%~dp0_check.bat" bak || goto :end
echo Starting SQL Server, SymmetricDS nodes and the monitor ^(first run downloads images, ~10 min^)...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo *** start failed - see the messages above. To see logs:  docker compose logs ***
  goto :end
)
docker compose run --rm tools wait-parity
echo.
echo Monitor UI : http://localhost:8080
echo SQL Server : localhost,14330  login sa  ^(password in .env^)
start "" http://localhost:8080
:end
echo.
pause
