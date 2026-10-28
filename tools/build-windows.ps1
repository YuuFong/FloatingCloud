param([string]$Version = '1.0.3800.47')
$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$vendor=Join-Path $root 'vendor'
$null=New-Item -ItemType Directory -Force $vendor
if (-not (Get-Command nuget.exe -ErrorAction SilentlyContinue)) {
  throw '找不到 nuget.exe。使用 VS 开发者 PowerShell 或在 PATH 中安装 NuGet CLI。'
}
nuget.exe install Microsoft.Web.WebView2 -Version $Version -OutputDirectory $vendor -NonInteractive
if($LASTEXITCODE -ne 0){throw 'NuGet 安装失败'}
$sdk=Join-Path $vendor "Microsoft.Web.WebView2.$Version"
cmake -S "$root/native" -B "$root/build/native" -A x64 "-DWEBVIEW2_SDK_ROOT=$sdk"
if($LASTEXITCODE -ne 0){throw 'CMake 配置失败'}
cmake --build "$root/build/native" --config Release
if($LASTEXITCODE -ne 0){throw 'CMake 构建失败'}
python "$root/tools/generate_desktop.py"
if($LASTEXITCODE -ne 0){throw "Desktop HTML generation failed"}
python "$root/tools/smoke_desktop.py"
if($LASTEXITCODE -ne 0){throw "Desktop HTML smoke test failed"}
Copy-Item "$root/build/native/Release/native.dll" "$root/plugin/native.dll" -Force
# TBL's own QQMusic, Kugou and LRCLIB sources require Lyricify .NET.
# Build a self-contained helper so end users do not need to install .NET.
$tbl=Join-Path $vendor 'TaskbarLyrics'
if(-not (Test-Path (Join-Path $tbl 'TaskbarLyrics.Core/TaskbarLyrics.Core.csproj'))) {
  git clone --depth 1 --branch v1.7.4 https://github.com/ANYNC/TaskbarLyrics.git "$tbl"
  if($LASTEXITCODE -ne 0){throw 'TaskbarLyrics v1.7.4 source download failed'}
}
dotnet publish "$root/lyric-helper/FloatingCloudLyrics.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o "$root/build/lyric-helper"
if($LASTEXITCODE -ne 0){throw 'TaskbarLyrics .NET lyric provider build failed'}
Copy-Item "$root/build/lyric-helper/FloatingCloudLyrics.exe" "$root/plugin/FloatingCloudLyrics.exe" -Force
# End-to-end assertion: offline-only local LRC -> real timestamps, no HTTP.
& "$root/tools/test-offline.ps1"
if($LASTEXITCODE -ne 0){throw 'Offline lyrics integration test failed'}

python "$root/tools/pack_plugin.py"
Write-Host 'Completed: FloatingCloud-v0.4.20-beta-diag.plugin'
