$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$helper=Join-Path $root 'build/lyric-helper/FloatingCloudLyrics.exe'
if(-not (Test-Path $helper)){throw 'Missing offline lyric helper exe'}
$dir=Join-Path $env:TEMP ('fc-offline-test-'+[guid]::NewGuid().ToString('N'))
New-Item -Path $dir -ItemType Directory -Force | Out-Null
try {
  $lyrics=Join-Path $dir 'FloatingCloud QA Artist - Offline Test Song.lrc'
  $content=('[00:01.000]First line','[00:04.200]Second line') -join [Environment]::NewLine
  [System.IO.File]::WriteAllText($lyrics,$content,[System.Text.UTF8Encoding]::new($false))
  $output=Join-Path $dir 'result.json'
  $request=@{
    TrackKey='local:qa-offline'
    Title='Offline Test Song'
    Artist='FloatingCloud QA Artist'
    Album=''
    DurationMs=180000
    Mode='local-only'
    LocalFolders=@($dir)
    OfflineHint=$true
  }
  $data=$request | ConvertTo-Json -Compress
  $base64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($data))
  & $helper $base64 $output
  if($LASTEXITCODE -ne 0){throw 'Offline helper crashed'}
  $result=Get-Content -Path $output -Raw -Encoding utf8 | ConvertFrom-Json
  if($result.provider -ne 'Local'){throw "Expected Local provider: $($result.provider), error: $($result.error)"}
  if($result.lines.Count -ne 2){throw "Expected two timed lines; got $($result.lines.Count)"}
  if([math]::Abs($result.lines[0].time - 1000) -gt 1){throw 'First timestamp mismatch'}
  if([math]::Abs($result.lines[1].time - 4200) -gt 1){throw 'Second timestamp mismatch'}
  if($result.lines[0].words.Count -ne 0){throw 'Untimed LRC must not report fabricated word timings'}
  Write-Host 'PASS: fully offline local LRC lookup, both timestamps, no invented words'
  $request.Mode='online-first'
  $data=$request | ConvertTo-Json -Compress
  $base64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($data))
  & $helper $base64 $output
  if($LASTEXITCODE -ne 0){throw 'Auto-offline helper crashed'}
  $result=Get-Content -Path $output -Raw -Encoding utf8 | ConvertFrom-Json
  if($result.provider -ne 'Local' -or $result.lines.Count -ne 2){
    throw 'Auto-offline should skip remote and retrieve local lyrics'
  }
  Write-Host 'PASS: automatically bypass online providers when offline hint is true'
} finally {
  Remove-Item -LiteralPath $dir -Force -Recurse -ErrorAction SilentlyContinue
}
