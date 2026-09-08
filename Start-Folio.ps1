[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNode = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $taskNode) { throw 'Install Node.js 22 or newer, then run Start-Folio.ps1 again.' }

$folioQwenUrl = 'http://127.0.0.1:8080/v1/models'
$folioQwenModelPath = '/root/models/Qwen3.8-27B-UD-IQ3_XXS.gguf'
$folioQwenProjectorPath = '/root/models/mmproj-F16.gguf'
$folioData = Join-Path $PSScriptRoot '.data'
function Test-FolioLocalModel {
    try {
        $folioProbe = Invoke-RestMethod -Uri $folioQwenUrl -TimeoutSec 2
        return [bool](@($folioProbe.data).Count)
    } catch { return $false }
}
function Test-FolioPort {
    param([int]$Port)
    $folioClient = New-Object System.Net.Sockets.TcpClient
    try {
        $folioConnect = $folioClient.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $folioConnect.AsyncWaitHandle.WaitOne(500)) { return $false }
        $folioClient.EndConnect($folioConnect)
        return $true
    } catch { return $false }
    finally { $folioClient.Dispose() }
}
function Ensure-FolioLocalModel {
    if (Test-FolioLocalModel) { return $true }
    if (Test-FolioPort 8080) {
        for ($folioAttempt = 0; $folioAttempt -lt 45; $folioAttempt++) {
            Start-Sleep -Seconds 1
            if (Test-FolioLocalModel) { return $true }
        }
        return $false
    }
    $folioWsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $folioWsl) { return $false }
    try {
        & $folioWsl.Source -d Ubuntu -- sh -lc "test -f $folioQwenModelPath && test -f $folioQwenProjectorPath" 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        New-Item -ItemType Directory -Path $folioData -Force | Out-Null
        $folioQwenOut = Join-Path $folioData 'qwen-autostart-output.log'
        $folioQwenErr = Join-Path $folioData 'qwen-autostart-error.log'
        $folioQwenArgs = @(
            '-d', 'Ubuntu', '--', '/root/llama.cpp/build/bin/llama-server',
            '-m', $folioQwenModelPath,
            '--mmproj', $folioQwenProjectorPath,
            '--host', '0.0.0.0', '--port', '8080',
            '--n-gpu-layers', '99', '--ctx-size', '8192', '--parallel', '1',
            '--flash-attn', 'on', '--jinja', '--no-context-shift'
        )
        $folioQwenProcess = Start-Process -FilePath $folioWsl.Source -ArgumentList $folioQwenArgs -WindowStyle Hidden -RedirectStandardOutput $folioQwenOut -RedirectStandardError $folioQwenErr -PassThru
        for ($folioAttempt = 0; $folioAttempt -lt 45; $folioAttempt++) {
            Start-Sleep -Seconds 1
            if (Test-FolioLocalModel) { return $true }
            if ($folioQwenProcess.HasExited) { break }
        }
    } catch { return $false }
    return $false
}
$folioLocalModelReady = Ensure-FolioLocalModel
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependencies could not be installed.' }
}
$folioDistIndex = Join-Path $PSScriptRoot 'dist\index.html'
$folioBuildNeeded = -not (Test-Path -LiteralPath $folioDistIndex)
if (-not $folioBuildNeeded) {
    $folioBuildTime = (Get-Item -LiteralPath $folioDistIndex).LastWriteTimeUtc
    $folioSourceFiles = @(
        (Join-Path $PSScriptRoot 'src'),
        (Join-Path $PSScriptRoot 'server'),
        (Join-Path $PSScriptRoot 'public'),
        (Join-Path $PSScriptRoot 'index.html'),
        (Join-Path $PSScriptRoot 'vite.config.ts'),
        (Join-Path $PSScriptRoot 'package.json'),
        (Join-Path $PSScriptRoot 'package-lock.json')
    ) | Where-Object { Test-Path -LiteralPath $_ } |
        ForEach-Object {
            $folioPath = Get-Item -LiteralPath $_
            if ($folioPath.PSIsContainer) {
                Get-ChildItem -LiteralPath $folioPath.FullName -File -Recurse
            } else {
                $folioPath
            }
        }
    $folioNewestSource = $folioSourceFiles |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($folioNewestSource -and $folioNewestSource.LastWriteTimeUtc -gt $folioBuildTime) {
        $folioBuildNeeded = $true
    }
}
if ($folioBuildNeeded) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Folio could not build. Review the error above.' }
}
$taskUrl = 'http://127.0.0.1:3001'
$taskReady = $false
$folioServerPidPath = Join-Path $folioData 'folio-server.pid'
$folioServerPid = 0
$folioServerProcess = $null
try {
    if (Test-Path -LiteralPath $folioServerPidPath) {
        $folioServerPid = [int](Get-Content -LiteralPath $folioServerPidPath -TotalCount 1)
    }
} catch { $folioServerPid = 0 }
if ($folioServerPid -gt 0) {
    $folioServerProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $folioServerPid) -ErrorAction SilentlyContinue
    if (-not $folioServerProcess -or $folioServerProcess.CommandLine -notmatch 'server[\\/]index\.ts') {
        $folioServerProcess = $null
        $folioServerPid = 0
    }
}
try {
    $taskHealth = Invoke-RestMethod -Uri ($taskUrl + '/api/health') -TimeoutSec 2
    $taskReady = $taskHealth.application -eq 'folio-writing-studio'
} catch {}
if ($taskReady -and -not $folioServerProcess) {
    $folioCandidates = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server[\\/]index\.ts'
        })
    if ($folioCandidates.Count -eq 1) {
        $folioServerProcess = $folioCandidates[0]
        $folioServerPid = [int]$folioServerProcess.ProcessId
    }
}
if ($taskReady -and $folioServerProcess) {
    $folioNewestServer = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'server') -File -Recurse |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    try {
        $folioServerStart = (Get-Process -Id $folioServerPid -ErrorAction Stop).StartTime.ToUniversalTime()
        if ($folioNewestServer -and $folioNewestServer.LastWriteTimeUtc -gt $folioServerStart) {
            Stop-Process -Id $folioServerPid -ErrorAction SilentlyContinue
            for ($folioStopAttempt = 0; $folioStopAttempt -lt 20; $folioStopAttempt++) {
                if (-not (Get-Process -Id $folioServerPid -ErrorAction SilentlyContinue)) { break }
                Start-Sleep -Milliseconds 150
            }
            $taskReady = $false
            $folioServerProcess = $null
            $folioServerPid = 0
        }
    } catch {
        $taskReady = $false
    }
}
if (-not $taskReady) {
    New-Item -ItemType Directory -Path $folioData -Force | Out-Null
    $taskServer = Start-Process -FilePath $taskNode.Source -ArgumentList @('--import', 'tsx', 'server/index.ts') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $folioData 'server-output.log') -RedirectStandardError (Join-Path $folioData 'server-error.log') -PassThru
    $folioServerPid = $taskServer.Id
    Set-Content -LiteralPath $folioServerPidPath -Value $folioServerPid -Encoding ascii
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        Start-Sleep -Milliseconds 400
        try {
            $taskHealth = Invoke-RestMethod -Uri ($taskUrl + '/api/health') -TimeoutSec 2
            if ($taskHealth.application -eq 'folio-writing-studio') { $taskReady = $true; break }
        } catch {}
        if ($taskServer.HasExited) { break }
    }
    if (-not $taskReady) { throw 'The local writing studio did not start. Check .data\server-error.log; port 3001 may already be occupied.' }
}
if ($taskReady -and $folioServerPid -gt 0) {
    New-Item -ItemType Directory -Path $folioData -Force | Out-Null
    Set-Content -LiteralPath $folioServerPidPath -Value $folioServerPid -Encoding ascii
}
Write-Host ''
Write-Host 'Folio is ready.' -ForegroundColor Green
Write-Host ('Open ' + $taskUrl + ' in Chrome.')
Write-Host ('Your books are saved in ' + (Join-Path $PSScriptRoot '.data'))
if ($folioLocalModelReady) { Write-Host 'Free local Qwen writing is ready automatically.' -ForegroundColor Green }
Write-Host 'Automatic local Qwen writing (when available), bundled browser writing, free browser art generation, summaries and offline art studies work without a provider. Connection settings is optional for hosted generation.'
