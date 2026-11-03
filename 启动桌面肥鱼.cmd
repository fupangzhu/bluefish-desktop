@echo off
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
) else (
  echo Electron is missing. Run npm ci and node node_modules/electron/install.js first.
  pause
)
