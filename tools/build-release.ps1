# Build every Windows artifact for one release: launcher, portable zip, PNG layers,
# preview gif, checksums and the single-file installer.
#
# Usage (from anywhere, Windows PowerShell 5.1+ or pwsh):
#   powershell -ExecutionPolicy Bypass -File tools/build-release.ps1
#   pwsh tools/build-release.ps1 -Python "C:\Python313\python.exe" -ReleaseDir "D:\share\release"
#   pwsh tools/build-release.ps1 -SkipTests -NoInstaller
#
# Requirements:
#   node + npm (Node 22+), node_modules installed (`npm ci`)
#   git on PATH (package_portable.py uses `git ls-files`)
#   python 3.8+ on PATH or via -Python (only the standard library is used)
#   .NET Framework csc.exe (ships with Windows)
param(
  [string]$Python = "",
  [string]$ReleaseDir = "",
  [switch]$SkipTests,
  [switch]$NoInstaller
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$version = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
$dist = Join-Path $repo "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$tag = "v$version"

function Resolve-Exe([string]$Name, [string[]]$Fallbacks) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($path in $Fallbacks) { if (Test-Path $path) { return $path } }
  throw "cannot find $Name (pass it explicitly, e.g. -Python <path>)"
}

$node = Resolve-Exe "node" @()
$cscCandidates = @(
  (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "csc.exe not found (.NET Framework 4.x required)" }
if (-not $Python) { $Python = Resolve-Exe "python" @() }

# package_portable.py shells out to `git`
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  $gitCandidates = @("C:\Program Files\Git\cmd", "C:\Program Files (x86)\Git\cmd")
  foreach ($dir in $gitCandidates) { if (Test-Path (Join-Path $dir "git.exe")) { $env:PATH = "$dir;$env:PATH"; break } }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git not found on PATH" }
}

Write-Host "== bluefish $tag =="

if (-not $SkipTests) {
  Write-Host "-- tests"
  $testFiles = (Get-ChildItem "test\*.test.mjs" | ForEach-Object { $_.FullName })
  & $node --test $testFiles
  if ($LASTEXITCODE -ne 0) { throw "tests failed" }
}

Write-Host "-- launcher"
& $csc /nologo /codepage:65001 /win32icon:assets/icon.ico /target:winexe /reference:System.Windows.Forms.dll "/out:$dist\蓝色肥鱼.exe" tools/BluefishLauncher.cs
if ($LASTEXITCODE -ne 0) { throw "launcher build failed" }

Write-Host "-- portable zip"
& $Python tools/package_portable.py
if ($LASTEXITCODE -ne 0) { throw "portable package failed" }

Write-Host "-- runtime layers + preview + checksums"
Compress-Archive -Path "assets\layers\*", "assets\rig.json", "assets\master.png" -DestinationPath "$dist\bluefish-png-layers.zip" -Force
Copy-Item "docs\hero.gif" "$dist\bluefish-preview.gif" -Force
$assets = @(
  "$dist\bluefish-desktop-$tag-windows-x64.zip",
  "$dist\bluefish-png-layers.zip",
  "$dist\bluefish-preview.gif"
)

if (-not $NoInstaller) {
  Write-Host "-- installer"
  & $csc /nologo /codepage:65001 /win32icon:assets/icon.ico /target:winexe `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    /reference:System.IO.Compression.FileSystem.dll /reference:System.IO.Compression.dll `
    "/out:$dist\setup-stub.exe" tools/installer/setup-stub.cs
  if ($LASTEXITCODE -ne 0) { throw "installer stub build failed" }
  & $Python tools/installer/make_installer.py
  if ($LASTEXITCODE -ne 0) { throw "installer package failed" }
  $assets += "$dist\bluefish-setup-$tag.exe"
}

Write-Host "-- checksums"
$lines = foreach ($file in $assets) {
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
  "$hash  $(Split-Path $file -Leaf)"
}
$sums = "$dist\bluefish-$tag-SHA256SUMS.txt"
[IO.File]::WriteAllText($sums, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
$lines

if (-not $ReleaseDir) {
  $releaseRoot = Join-Path (Split-Path -Parent $repo) "release"
  if (Test-Path $releaseRoot) { $ReleaseDir = $releaseRoot }
}
if ($ReleaseDir) {
  New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
  Write-Host "-- copying shareable files to $ReleaseDir"
  Copy-Item $sums $ReleaseDir -Force
  if (-not $NoInstaller) {
    Copy-Item "$dist\bluefish-setup-$tag.exe" (Join-Path $ReleaseDir "蓝色肥鱼-安装包-$tag.exe") -Force
  }
}

Write-Host "done:"
Get-ChildItem $dist | Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-1) } | Select-Object Name, Length | Format-Table -AutoSize
