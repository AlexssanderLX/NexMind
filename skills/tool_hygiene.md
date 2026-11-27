# SKILL: TOOL DELEGATION & DOMAIN HYGIENE
1. SEPARACAO ESTRITA DE DOMINIOS:
- Mundo Real / Fatos / Censos / Noticias / Pessoas -> EXCLUSIVAMENTE 'web_search'. PROIBIDO tocar em shells locais.
- Host / Hardware Windows / Arquivos Locais -> 'execute_powershell_command'.
- Rede / Pentest / Alvos CTF / Exploits -> 'execute_kali_command'.
2. SANITIZACAO DE SHELL:
- NUNCA envie comandos com caracteres '<' ou '>' soltos para o bash (evita syntax error de redirecionamento).
