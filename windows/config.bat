@echo off
rem ---- Edit these two lines to match your machine ----------------------------------
rem WSL distro to use. Leave EMPTY to use your default distro (see: wsl -l -v, the one marked with *).
rem Otherwise put the exact name, e.g. Ubuntu or Ubuntu-22.04 or Ubuntu-24.04
set "DISTRO="
rem Folder of the cloned repo INSIDE that distro (~ = your Linux home directory)
set "REPO=~/symmetricdsui"
rem ------------------------------------------------------------------------------------
rem (do not edit below)
set "WSLD="
if defined DISTRO set "WSLD=-d %DISTRO%"
