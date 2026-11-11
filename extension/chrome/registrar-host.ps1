$ErrorActionPreference = "Stop"
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$outDir = "$env:LOCALAPPDATA\Nex\chrome-host"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
# Troca o host em uso: so o NexChromeHost (o Chrome sobe outro sozinho). O Chrome em si nao e tocado.
Get-Process NexChromeHost -ErrorAction SilentlyContinue | Stop-Process -Force
$tokenPath = "$outDir\token"
if (-not (Test-Path $tokenPath)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [IO.File]::WriteAllText($tokenPath, (($bytes | ForEach-Object { $_.ToString("x2") }) -join ""), [Text.Encoding]::ASCII)
}
& $csc /nologo /out:"$outDir\NexChromeHost.exe" "$PSScriptRoot\host\NexChromeHost.cs"
$jsonPath = "$outDir\com.nex.chrome.json"
@{
    name = "com.nex.chrome"
    description = "Nex Chrome native messaging host"
    path = "$outDir\NexChromeHost.exe"
    type = "stdio"
    allowed_origins = @("chrome-extension://dpnekndbnecjfpnfbmbcfblcpickpcjf/")
} | ConvertTo-Json | Set-Content -Path $jsonPath -Encoding ascii
New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nex.chrome" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nex.chrome" -Name "(default)" -Value $jsonPath
Write-Host "Host com.nex.chrome registrado. O Chrome aberto não foi fechado."
