@echo off
rem ---------------------------------------------------------------
rem  Double-click launcher for the game.
rem  The server runs in THIS window, so closing the window stops it.
rem
rem  This file is deliberately pure ASCII. A .bat containing non-ASCII
rem  bytes is mis-parsed by cmd.exe the moment chcp changes the code page
rem  (byte offsets and character counts stop agreeing, and Russian lines
rem  get executed as commands). All Russian text therefore lives in
rem  tools/serve.mjs, which prints UTF-8 after chcp 65001 below.
rem ---------------------------------------------------------------
chcp 65001 >nul
title Roguelike - server
cd /d "%~dp0"

rem Find Node.js: PATH first, then the default install location.
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

if not defined NODE_EXE (
  echo.
  echo   Node.js is not installed.
  echo   Install it from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "%~dp0tools\serve.mjs" --open
set "EXITCODE=%ERRORLEVEL%"

echo.
echo   Server stopped ^(exit code %EXITCODE%^).
pause
