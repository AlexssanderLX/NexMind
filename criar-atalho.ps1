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

Write-Host "Atalho criado: $desktop\Nex.lnk"
