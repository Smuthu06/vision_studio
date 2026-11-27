@echo off
rem ===========================================================================
rem  Vision Studio - Windows build script
rem
rem  Builds VisionStudio.exe and places it next to its configuration file
rem  VisionStudio.ini, whose [app] mode setting selects how it runs:
rem      mode = desktop   the editor opens in its own window
rem      mode = web       the editor is served to your browser (tray icon)
rem
rem  Usage:   build-windows.bat [installer] [skiptests] [clean] [nopause]
rem      installer   also build the NSIS setup.exe and MSI installers
rem      skiptests   do not run the unit tests before building
rem      clean       delete previous build output first (full rebuild)
rem      nopause     never wait for a key press (for CI / scripts)
rem
rem  Output:  release\VisionStudio\VisionStudio.exe
rem           release\VisionStudio\VisionStudio.ini
rem           release\VisionStudio\README.txt
rem           release\VisionStudio-portable.zip
rem           release\installers\...              (with "installer")
rem
rem  Needs:   Node.js 18+, Rust (rustup, MSVC toolchain) and the
rem           "Desktop development with C++" workload of Visual Studio
rem           Build Tools. WebView2 is preinstalled on Windows 10/11.
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "WANT_INSTALLER=0"
set "SKIP_TESTS=0"
set "CLEAN=0"
set "NOPAUSE=0"
for %%A in (%*) do (
    if /i "%%~A"=="installer" set "WANT_INSTALLER=1"
    if /i "%%~A"=="skiptests" set "SKIP_TESTS=1"
    if /i "%%~A"=="clean"     set "CLEAN=1"
    if /i "%%~A"=="nopause"   set "NOPAUSE=1"
    if /i "%%~A"=="help"      goto :usage
    if /i "%%~A"=="/?"        goto :usage
)

rem Pause at the end only when the script was started by double-click.
set "DOUBLECLICK=0"
for %%X in (%cmdcmdline%) do if /i "%%~X"=="/c" set "DOUBLECLICK=1"
if "%NOPAUSE%"=="1" set "DOUBLECLICK=0"

set "OUT=release\VisionStudio"
set "EXE_SRC=src-tauri\target\release\vision-studio.exe"

echo.
echo  ==========================================
echo   Vision Studio - Windows build
echo  ==========================================
echo.

rem ---------------------------------------------------------------- 1. tools
echo [1/6] Checking prerequisites...
call :require node  "Node.js 18 or newer"       "https://nodejs.org/"  || goto :fail
call :require npm   "npm (installed with Node)" "https://nodejs.org/"  || goto :fail
call :require cargo "Rust"                      "https://rustup.rs/"   || goto :fail

set "NODE_MAJOR=0"
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if !NODE_MAJOR! LSS 18 (
    echo [ERROR] Node.js !NODE_MAJOR! found - version 18 or newer is required.
    goto :fail
)
where rustup >nul 2>nul
if not errorlevel 1 (
    set "TOOLCHAIN="
    for /f "delims=" %%T in ('rustup show active-toolchain 2^>nul') do set "TOOLCHAIN=%%T"
    rem substring test without a pipe (pipes do not see delayed variables)
    if "!TOOLCHAIN:msvc=!"=="!TOOLCHAIN!" (
        echo [WARN] The active Rust toolchain is not MSVC: !TOOLCHAIN!
        echo        Run:  rustup default stable-msvc
    )
)
for /f "delims=" %%V in ('node -p "process.versions.node"') do echo        Node.js %%V
for /f "delims=" %%V in ('cargo --version') do echo        %%V

rem ---------------------------------------------------------------- 2. clean
if "%CLEAN%"=="1" (
    echo [2/6] Cleaning previous build output...
    if exist dist rmdir /s /q dist
    if exist "%OUT%\VisionStudio.exe" del /q "%OUT%\VisionStudio.exe"
    if exist release\installers rmdir /s /q release\installers
    pushd src-tauri
    cargo clean
    popd
) else (
    echo [2/6] Keeping previous build output ^(use "clean" for a full rebuild^)
)

rem ---------------------------------------------------------------- 3. deps
echo [3/6] Installing npm packages...
call npm ci --no-audit --no-fund
if errorlevel 1 (
    echo [ERROR] npm ci failed. Check your network / proxy settings.
    goto :fail
)

rem ---------------------------------------------------------------- 4. tests
if "%SKIP_TESTS%"=="1" (
    echo [4/6] Skipping tests
) else (
    echo [4/6] Running unit tests...
    call npm test
    if errorlevel 1 (
        echo [ERROR] Unit tests failed - not building. Use "skiptests" to build anyway.
        goto :fail
    )
)

rem ---------------------------------------------------------------- 5. build
if "%WANT_INSTALLER%"=="1" (
    set "BUNDLE_ARGS=--bundles nsis,msi"
    echo [5/6] Building VisionStudio.exe and installers ^(first build takes several minutes^)...
) else (
    set "BUNDLE_ARGS=--no-bundle"
    echo [5/6] Building VisionStudio.exe ^(first build takes several minutes^)...
)
call npx tauri build !BUNDLE_ARGS!
if errorlevel 1 (
    echo [ERROR] The build failed. If the linker ^(link.exe^) is missing, install
    echo         Visual Studio Build Tools with "Desktop development with C++".
    goto :fail
)
if not exist "%EXE_SRC%" (
    echo [ERROR] Expected %EXE_SRC% but it was not produced.
    goto :fail
)

rem ---------------------------------------------------------------- 6. package
echo [6/6] Packaging...
if not exist "%OUT%" mkdir "%OUT%"
copy /y "%EXE_SRC%" "%OUT%\VisionStudio.exe" >nul || goto :fail
rem Keep an existing INI so your settings survive a rebuild.
if exist "%OUT%\VisionStudio.ini" (
    echo        Kept existing %OUT%\VisionStudio.ini
) else (
    copy /y "config\vision-studio.ini" "%OUT%\VisionStudio.ini" >nul || goto :fail
)
copy /y "config\README-portable.txt" "%OUT%\README.txt" >nul

if exist "release\VisionStudio-portable.zip" del /q "release\VisionStudio-portable.zip"
where powershell >nul 2>nul
if not errorlevel 1 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%OUT%\*' -DestinationPath 'release\VisionStudio-portable.zip' -Force"
)

if "%WANT_INSTALLER%"=="1" (
    if not exist release\installers mkdir release\installers
    for %%F in ("src-tauri\target\release\bundle\nsis\*.exe" "src-tauri\target\release\bundle\msi\*.msi") do (
        copy /y "%%~F" "release\installers\" >nul
        echo        Installer: release\installers\%%~nxF
    )
)

echo.
echo  Done.
echo    Program : %CD%\%OUT%\VisionStudio.exe
echo    Settings: %CD%\%OUT%\VisionStudio.ini   ^(mode = desktop ^| web^)
if exist "release\VisionStudio-portable.zip" echo    Portable: %CD%\release\VisionStudio-portable.zip
echo.
echo  Edit VisionStudio.ini and set  mode = web  to use Vision Studio in a browser.
echo.
if "%DOUBLECLICK%"=="1" pause
exit /b 0

rem ===========================================================================
:require
rem No ( ) block here: the messages contain parentheses, which would end the block early.
where %~1 >nul 2>nul && exit /b 0
echo [ERROR] %~2 was not found on PATH.
echo         Install it from %~3 and open a new Command Prompt.
exit /b 1

:usage
echo Usage: build-windows.bat [installer] [skiptests] [clean] [nopause]
echo   installer   also build the NSIS setup.exe and MSI installers
echo   skiptests   do not run the unit tests before building
echo   clean       delete previous build output first (full rebuild)
echo   nopause     never wait for a key press (for CI / scripts)
exit /b 0

:fail
echo.
echo  Build FAILED.
if "%DOUBLECLICK%"=="1" pause
exit /b 1
