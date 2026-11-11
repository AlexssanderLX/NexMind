# Liga o Chrome na porta 9222 sem matar uma janela que já está aberta.
# Fechar o Chrome da pessoa apaga a sessão no meio do trabalho e o site trata o retorno como robô.
param([switch]$ForceRestart)

function Test-Port9222 {
    $r = curl.exe -s -m 1 "http://127.0.0.1:9222/json/version" 2>$null
    return ($LASTEXITCODE -eq 0 -and $r)
}

if (Test-Port9222 -and -not $ForceRestart) {
    Write-Host "O Chrome já está na porta 9222. Nada foi fechado." -ForegroundColor Green
    exit 0
}

$running = Get-Process chrome -ErrorAction SilentlyContinue
if ($running -and -not $ForceRestart) {
    Write-Host "O Chrome está aberto. Não vou fechar suas abas nem o login." -ForegroundColor Yellow
    Write-Host "O Nex usa essa janela se a porta 9222 estiver ativa. Se não estiver, feche o Chrome você mesmo e rode este script de novo." -ForegroundColor Yellow
    exit 0
}

$chromeExe = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chromeExe) { Write-Error "Google Chrome não encontrado."; exit 1 }

if ($ForceRestart -and $running) {
    Write-Host "Reinício pedido explicitamente. Fechando o Chrome..." -ForegroundColor Cyan
    Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

$profile = "$env:LOCALAPPDATA\nex-chrome-profile"
$realProfile = "$env:LOCALAPPDATA\Google\Chrome\User Data"
if (-not (Test-Path $profile)) {
    cmd /c mklink /J "$profile" "$realProfile" | Out-Null
}

Write-Host "Abrindo o Chrome na porta 9222, porque não havia nenhum aberto." -ForegroundColor Green
Start-Process $chromeExe -ArgumentList "--remote-debugging-port=9222", "--remote-allow-origins=*", "--user-data-dir=$profile", "--restore-last-session"
