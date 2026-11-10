@echo off
cd /d "%~dp0"
title Buscador Equipos (cerrar esta ventana para apagar)
set NODE=node
if exist "%~dp0node.exe" set NODE="%~dp0node.exe"
start "" http://localhost:3000
:loop
%NODE% server.js
rem Exit code 3 = the app updated itself; start it again with the new code.
if %ERRORLEVEL%==3 goto loop
pause
