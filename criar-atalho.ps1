# Cria o atalho "Nex" na Área de Trabalho. Rode uma vez: .\criar-atalho.ps1
$root = $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$desktop\Nex.lnk")
$lnk.TargetPath = "powershell.exe"
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$root\iniciar-nex.ps1`""
$lnk.WorkingDirectory = $root
$lnk.IconLocation = "$root\assets\nex.ico"
$lnk.WindowStyle = 1 # janela normal: mostra cada passo (limpeza, Ollama, Nex); fechar a janela para o Nex
$lnk.Description = "Inicia o Nex (Ollama + app) e o Chrome na porta 9222, com a sessão do usuário"
$lnk.Save()

$chromeExe = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$chrome = $ws.CreateShortcut("$desktop\Google Chrome (Nex Automação).lnk")
$chrome.TargetPath = "powershell.exe"
$chrome.Arguments = "-ExecutionPolicy Bypass -File `"$root\iniciar-chrome-sessao.ps1`""
$chrome.WorkingDirectory = $root
if ($chromeExe) { $chrome.IconLocation = "$chromeExe,0" }
$chrome.WindowStyle = 1
$chrome.Description = "Abre o Chrome com a sessão logada e a porta 9222 para o Nex"
$chrome.Save()

Write-Host "Atalho criado: $desktop\Nex.lnk"
Write-Host "Atalho criado: $desktop\Google Chrome (Nex Automação).lnk"
