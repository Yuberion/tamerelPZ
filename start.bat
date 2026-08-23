@echo off
setlocal

rem =====================================================================
rem  PZ MANAGEMENT - project launcher
rem
rem    start.bat           dev mode: electron-vite dev + hot reload
rem    start.bat build     production build into .\out
rem    start.bat prod      build, then launch the built app
rem    start.bat app       launch the already built app from .\out
rem    start.bat check     run the TypeScript typechecks
rem
rem  Dependencies are installed automatically on the first run.
rem  Set PZ_NOPAUSE=1 to never pause on errors (useful for CI / scripts).
rem =====================================================================

rem Work from the folder of this file, so double-clicking works and paths
rem containing spaces ("E:\PZ Management") are handled correctly.
cd /d "%~dp0"

rem VS Code and some terminals export these into child processes. If they
rem survive, the Electron binary boots as plain Node, require('electron')
rem returns a path string and the app dies on startup.
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="

set "MODE=%~1"
if not defined MODE set "MODE=dev"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo         Install Node.js 20+ from https://nodejs.org, then reopen the terminal.
    goto :fail
)

if not exist "node_modules\electron\package.json" (
    echo [setup] Installing dependencies, this may take a few minutes...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        goto :fail
    )
)

if /i "%MODE%"=="dev"   goto :dev
if /i "%MODE%"=="build" goto :build
if /i "%MODE%"=="prod"  goto :prod
if /i "%MODE%"=="app"   goto :app
if /i "%MODE%"=="check" goto :check

echo [ERROR] Unknown mode: %MODE%
echo         Usage: start.bat [dev ^| build ^| prod ^| app ^| check]
goto :fail

:dev
echo [run] PZ MANAGEMENT - dev mode
call npm run dev
if errorlevel 1 goto :fail
goto :done

:build
echo [run] PZ MANAGEMENT - production build
call npm run build
if errorlevel 1 goto :fail
echo [ok] Build finished: "%CD%\out"
goto :done

:prod
echo [run] PZ MANAGEMENT - build + launch
call npm run build
if errorlevel 1 goto :fail
goto :app

:app
if not exist "out\main\index.js" (
    echo [ERROR] No build found in .\out - run "start.bat build" first.
    goto :fail
)
echo [run] PZ MANAGEMENT - launching built app
call npm run start
if errorlevel 1 goto :fail
goto :done

:check
echo [run] PZ MANAGEMENT - typecheck
call npm run typecheck
if errorlevel 1 goto :fail
echo [ok] Typecheck passed.
goto :done

:fail
echo.
echo [FAILED] mode: %MODE%
call :maybe_pause
endlocal
exit /b 1

:done
endlocal
exit /b 0

:maybe_pause
if defined PZ_NOPAUSE goto :eof
pause
goto :eof
