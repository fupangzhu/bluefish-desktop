@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "BLUEFISH_EDITOR_RUNTIME=%~dp0node_modules\electron\dist\electron.exe"
if exist "%~dp0..\..\..\installed\app\bluefish-desktop\node_modules\electron\dist\electron.exe" set "BLUEFISH_EDITOR_RUNTIME=%~dp0..\..\..\installed\app\bluefish-desktop\node_modules\electron\dist\electron.exe"
if not exist "%BLUEFISH_EDITOR_RUNTIME%" (
  echo Run npm ci in this folder, then open the editor again.
  pause
  exit /b 1
)
start "" "%BLUEFISH_EDITOR_RUNTIME%" "%~dp0desktop\editor.cjs"
