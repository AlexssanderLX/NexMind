# Testa a decisão de partida do atalho (open / wait / restart) com cenários fictícios.
# Não encerra nem inicia nada: carrega só as funções de iniciar-nex.ps1 (carregar com ponto não executa o Nex).
# Rodar: powershell -NoProfile -ExecutionPolicy Bypass -File tests\launcher\test-decisao.ps1
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\..\..\iniciar-nex.ps1"

$falhas = 0
$total = 0
function Check($nome, $obtido, $esperado) {
    $script:total++
    $ok = ($obtido -eq $esperado)
    if (-not $ok) { $script:falhas++ }
    Write-Host ("{0} {1}  (obtido: {2}, esperado: {3})" -f $(if ($ok) { "OK   " } else { "FALHA" }), $nome, $obtido, $esperado)
}

$agora = Get-Date "2026-11-11 18:00:00"
$build = $agora.AddMinutes(-10)        # código/build mais recente: 17:50
$rodandoDepois = $agora.AddMinutes(-5) # Nex iniciado 17:55, depois do build
$rodandoAntes = $agora.AddMinutes(-20) # Nex iniciado 17:40, antes do build
$novo = @($agora.AddSeconds(-30))      # outro launcher começou há 30 s
$velho = @($agora.AddMinutes(-10))     # outro launcher antigo (já deveria ter terminado)

function D($saudavel, $desde, $build, $outros, $force = $false) {
    Get-LaunchDecision -Healthy $saudavel -RunningSince $desde -BuiltAt $build -OtherLauncherStarts $outros -Now $agora -ForceRestart $force
}

Check "saudável e mais novo que o código: só abre a tela" (D $true $rodandoDepois $build @()) "open"
Check "saudável mas o código mudou depois: reinicia" (D $true $rodandoAntes $build @()) "restart"
Check "-Force reinicia mesmo saudável e atualizado" (D $true $rodandoDepois $build @() $true) "restart"
Check "fora do ar e sem outro launcher: reinicia" (D $false $null $build @()) "restart"
Check "fora do ar com outro launcher subindo há 30 s: espera" (D $false $null $build $novo) "wait"
Check "fora do ar com outro launcher de 10 min: reinicia" (D $false $null $build $velho) "restart"
Check "saudável e atualizado, mesmo com outro launcher novo: abre (não espera)" (D $true $rodandoDepois $build $novo) "open"
Check "código mudou e outro launcher subindo: espera em vez de derrubar" (D $true $rodandoAntes $build $novo) "wait"
Check "API responde mas o processo não é deste build (desconhecido): reinicia" (D $true $null $build @()) "restart"
Check "sem data de build: nunca abre" (D $true $rodandoDepois $null @()) "restart"
Check "vários launchers, um deles novo: espera" (D $false $null $build @($velho[0], $novo[0])) "wait"
Check "exatamente no limite de espera (240 s): reinicia" (D $false $null $build @($agora.AddSeconds(-240))) "restart"
Check "logo antes do limite (239 s): espera" (D $false $null $build @($agora.AddSeconds(-239))) "wait"
Check "mesma hora de início e de build: conta como atualizado" (D $true $build $build @()) "open"

Write-Host ("`n{0}/{1} verificações ok" -f ($total - $falhas), $total)
exit $(if ($falhas -eq 0) { 0 } else { 1 })
