$ErrorActionPreference = "Stop"
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$outDir = "$env:LOCALAPPDATA\Nex\chrome-host"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
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
