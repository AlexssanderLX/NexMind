# Playbook de OSINT passivo

Classifique o alvo antes de buscar.

- Pessoa ou username: nome próprio, apelido ou handle. Não há ponto de domínio.
- Domínio ou organização: host público (`exemplo.com.br`). A coleta fica em fontes abertas. Não varre porta nem envia pedido ao servidor do alvo.

## Busca passiva

Pessoa: `"Nome Completo" site:github.com`, `"Nome Completo" developer`, e o mesmo padrão em GitLab, LinkedIn, Dev.to, Twitter/X, Medium e Stack Overflow.

Domínio: `site:dominio`, mais a lista de nomes em Certificate Transparency (`https://crt.sh/?q=dominio&output=json`). Só a API pública do crt.sh. Nenhum request ao host do alvo.

Dorks curtos, um operador por consulta. Sem cadeia enorme.

## Relatório técnico (formato obrigatório)

🧭 Resumo do Alvo & Classificação
Uma linha: quem ou o que é, e se é pessoa ou domínio.

🌐 Presença Digital & Perfis Encontrados
Cada item com a URL direta que a busca devolveu. Sem URL, não é perfil.

📌 Fatos Confirmados (Persistidos na Memória)
Só o que entrou em facts.md nesta rodada. Se a busca veio vazia, diga que não houve fato confirmado.

💡 Próximos Passos de Reconhecimento
No máximo três, ainda passivos (outro dork, outro registrador público, outro perfil). Sem exploração.
