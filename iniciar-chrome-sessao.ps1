# Este script não abre e não fecha o Chrome.
# A porta 9222 faz o Chrome tratar o perfil como instância de automação:
# os sites marcam a sessão como robô e o Chrome derruba abas e logins.
Write-Host "Nada foi feito. O Chrome aberto continua como está." -ForegroundColor Yellow
Write-Host "Abrir a porta de depuração reseta a sessão e os sites bloqueiam como bot. Esse caminho foi desligado." -ForegroundColor Yellow
exit 0
