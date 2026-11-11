"""Reescreve as descrições (docstrings) das ferramentas do Nex num formato único e explícito, para o modelo pequeno.

Formato: O QUE FAZ / QUANDO USAR / COMO USAR / NÃO FAÇA / RETORNA (e SE DER ERRO quando importa).
As descrições dos arquivos (servidor de terceiros) ficam em backend/mcp_servers.json, chave "descriptions".
Rodar a partir da raiz do repositório: python scripts/gerar-descricoes-tools.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

BROWSER = {
    "browser_tabs": """O QUE FAZ: lista as abas do grupo Nex (número, título, site e qual é a atual).
QUANDO USAR: no começo de qualquer tarefa no navegador, e sempre que o Alexssander disser que abriu algo ou pedir para trabalhar nas abas dele.
COMO USAR: sem argumentos.
NÃO FAÇA: não chame de novo sem necessidade; não procure abas fora do grupo (para você elas não existem).
RETORNA: uma linha por aba, no formato [número] título - endereço. Esse número é o tab_id das outras ferramentas.
SE O GRUPO ESTIVER VAZIO: abra uma página com browser_navigate.""",
    "browser_navigate": """O QUE FAZ: abre um endereço numa aba NOVA do grupo Nex. As outras abas não mudam.
QUANDO USAR: para ir a um site que ainda não está aberto (exemplo: "abre o Gmail").
COMO USAR: url completa com https:// (exemplo: https://mail.google.com/). Se o Alexssander só disse o nome do site, use o endereço principal dele.
NÃO FAÇA: não abra várias páginas seguidas sem ler a anterior; não abra de novo um site que já está nas abas (veja browser_tabs); não use para trocar uma aba existente (use browser_reuse_tab); só aceita http e https.
RETORNA: o número da aba aberta. Depois SEMPRE leia a página com browser_get_dom.
SE DER ERRO: "ritmo alto", "fora do escopo" ou "bloqueado" = avise o Alexssander em uma frase e pare; "limite de abas" = peça para ele fechar abas do grupo.""",
    "browser_reuse_tab": """O QUE FAZ: troca o endereço de uma aba que JÁ está no grupo Nex. O conteúdo atual dela é perdido.
QUANDO USAR: só quando o Alexssander pedir para reaproveitar ou trocar uma aba, ou quando o grupo estiver cheio.
COMO USAR: tab_id = número da aba (de browser_tabs); url completa com https://.
NÃO FAÇA: não use para abrir um site novo (use browser_navigate); não use em aba em que o Alexssander está trabalhando sem ele pedir.
RETORNA: o número da aba. Depois SEMPRE leia com browser_get_dom.
SE DER ERRO: "não está no grupo Nex" = chame browser_tabs e use um número da lista.""",
    "browser_get_dom": """O QUE FAZ: lê o texto visível e a lista de itens clicáveis ([número] tipo nome) de uma aba do grupo Nex.
QUANDO USAR: depois de abrir, trocar, clicar ou digitar, e SEMPRE antes de dizer qualquer coisa sobre uma página. Nunca responda sobre uma página sem ter lido.
COMO USAR: sem argumentos lê a aba atual. Para outra aba, passe tab_id (de browser_tabs).
NÃO FAÇA: não invente o que não apareceu; não reuse números de itens de uma leitura antiga ou de outra aba.
RETORNA: "Aba [número] endereço", o texto visível (até 6000 caracteres) e "Interativos" com os números para clicar ou digitar. Página longa vem cortada: diga isso se faltar parte.
SE VIER VAZIO: espere um instante e chame de novo uma vez.""",
    "browser_click": """O QUE FAZ: clica num item da página (botão, link, aba ou menu do site). Pede autorização do Alexssander.
QUANDO USAR: para abrir um link, apertar um botão, trocar de aba ou menu do site.
COMO USAR: element_id = o número entre colchetes do item, na lista Interativos da ÚLTIMA leitura DA MESMA ABA. Em outra aba, passe também tab_id.
NÃO FAÇA: não clique para digitar num campo (use browser_type); não adivinhe número; se o item não está na lista, diga que não achou; não clique em enviar, comprar, apagar ou confirmar se o Alexssander não pediu isso.
RETORNA: só a confirmação do clique, não o resultado. Depois SEMPRE chame browser_get_dom e relate o que apareceu.
SE DER ERRO "não está mais na aba": leia a página de novo e use o número novo.""",
    "browser_type": """O QUE FAZ: digita um texto num campo da página (busca, caixa de texto, formulário). Pede autorização do Alexssander.
QUANDO USAR: para escrever num campo. Ele já foca o campo e troca o conteúdo: NÃO clique no campo antes.
COMO USAR: element_id = número do campo na lista Interativos da última leitura da mesma aba; text = exatamente o texto; press_enter=true só para executar uma busca. Em outra aba, passe também tab_id.
NÃO FAÇA: não digite senha, código ou dado financeiro sem perguntar antes ao Alexssander; não aperte Enter em formulário de envio sem ele pedir; não digite em campo que não está na lista.
RETORNA: o valor que ficou no campo. Depois chame browser_get_dom para ver a reação da página (tradução, resultados) e só então relate.""",
    "browser_close": """O QUE FAZ: solta o controle das abas do grupo Nex (some o aviso de depuração do Chrome). Não fecha abas nem o Chrome.
QUANDO USAR: só quando terminar o trabalho no navegador ou quando o Alexssander pedir.
COMO USAR: sem argumentos.
NÃO FAÇA: não use para "fechar a aba": você não fecha abas.
RETORNA: confirmação.""",
}

DESKTOP = {
    "desktop_list_windows": """O QUE FAZ: lista os títulos das janelas abertas e visíveis no Windows (texto, sem imagem).
QUANDO USAR: antes de qualquer ação num aplicativo do Windows, para saber o título exato da janela.
COMO USAR: sem argumentos.
NÃO FAÇA: não use para ler páginas da web (para isso são as ferramentas browser_*); não chute títulos.
RETORNA: até 40 títulos, um por linha.""",
    "desktop_inspect_window": """O QUE FAZ: traz uma janela para o foco e lista os botões e controles dela (tipo e nome).
QUANDO USAR: antes de clicar em algo num aplicativo, para descobrir os nomes dos controles.
COMO USAR: title = parte do título da janela, como apareceu em desktop_list_windows.
NÃO FAÇA: não use em navegador para ler página (use browser_*); não repita sem necessidade.
RETORNA: até 60 linhas no formato tipo + nome.
SE DER ERRO "janela não encontrada": chame desktop_list_windows e use o título certo.""",
    "desktop_click_element": """O QUE FAZ: acha um controle pelo nome dentro de uma janela, move o mouse até ele e clica. Pede autorização do Alexssander.
QUANDO USAR: para apertar um botão ou item de um aplicativo do Windows.
COMO USAR: window_title = parte do título da janela; element_name = nome do controle EXATAMENTE como apareceu em desktop_inspect_window.
NÃO FAÇA: não adivinhe nomes; não use em sites dentro do navegador; não clique em fechar, apagar ou enviar sem o Alexssander pedir.
RETORNA: confirmação do clique. Depois inspecione a janela de novo para conferir o resultado.""",
    "desktop_mouse_click": """O QUE FAZ: move o mouse para uma posição da tela (x, y) e clica. Pede autorização do Alexssander.
QUANDO USAR: só como último recurso, quando o controle não tem nome em desktop_inspect_window.
COMO USAR: x e y em pixels da tela; button = left, right ou middle; clicks = 1 a 3.
NÃO FAÇA: não chute coordenadas; não use se desktop_click_element resolve.
RETORNA: confirmação, ou aviso de que a posição está fora da tela.""",
    "desktop_type": """O QUE FAZ: digita um texto na janela ou campo que está em foco (aceita acentos; quebra de linha vira Enter). Pede autorização do Alexssander.
QUANDO USAR: para escrever num aplicativo do Windows (Bloco de Notas, por exemplo).
COMO USAR: antes, garanta o foco com desktop_inspect_window ou desktop_click_element. Máximo de 2000 caracteres por chamada.
NÃO FAÇA: não use para sites no navegador (use browser_type); não digite sem ter certeza de qual janela está em foco.
RETORNA: quantos caracteres foram digitados.""",
    "desktop_press_hotkey": """O QUE FAZ: aperta uma tecla ou combinação de teclas. Pede autorização do Alexssander.
QUANDO USAR: para atalhos (salvar, copiar, trocar de janela) ou teclas como Enter e Esc.
COMO USAR: keys = lista de teclas em minúsculas, por exemplo ["ctrl","s"], ["alt","tab"], ["enter"].
NÃO FAÇA: não use combinações destrutivas (alt+f4, ctrl+w, win+l, ctrl+alt+del) sem o Alexssander pedir; não invente nomes de teclas.
RETORNA: confirmação, ou a lista de teclas desconhecidas.""",
    "desktop_take_screenshot": """O QUE FAZ: captura a tela inteira e salva num arquivo PNG.
QUANDO USAR: só quando o Alexssander pedir uma captura.
COMO USAR: filename opcional.
NÃO FAÇA: não use para "ver" a tela: você não lê imagens (use desktop_list_windows e desktop_inspect_window).
RETORNA: só o caminho do arquivo e o tamanho da imagem.""",
}

FILES = {
    "read_text_file": """O QUE FAZ: lê um arquivo de texto (código, .md, .txt, .json, .csv...) de qualquer pasta do PC.
QUANDO USAR: quando o Alexssander pedir para ler, resumir ou analisar um arquivo.
COMO USAR: path = caminho completo do Windows. Em arquivo grande, use head (primeiras N linhas) ou tail (últimas N linhas).
NÃO FAÇA: não leia PDF, DOCX, planilha ou imagem por aqui (o Alexssander anexa esses pelo clipe do chat); não leia arquivo inteiro se ele for gigante; não invente caminho (use list_directory ou search_files).
RETORNA: o texto do arquivo. Caminhos de chaves e credenciais são recusados.""",
    "list_directory": """O QUE FAZ: lista os arquivos e pastas de uma pasta, marcando [FILE] ou [DIR].
QUANDO USAR: para descobrir o que existe numa pasta antes de ler ou editar.
COMO USAR: path = caminho completo da pasta.
NÃO FAÇA: não use para ler conteúdo (use read_text_file); não liste a pasta raiz inteira do disco sem necessidade.
RETORNA: uma linha por item.""",
    "search_files": """O QUE FAZ: procura arquivos pelo nome dentro de uma pasta e das subpastas.
QUANDO USAR: quando o Alexssander disser o nome (ou parte) de um arquivo e você não souber onde está.
COMO USAR: path = pasta onde começar; pattern = parte do nome (exemplo: relatorio). excludePatterns é opcional.
NÃO FAÇA: não procure pelo conteúdo do arquivo (só pelo nome); não comece de uma pasta enorme sem necessidade.
RETORNA: a lista de caminhos encontrados.""",
    "get_file_info": """O QUE FAZ: mostra tamanho, datas e tipo de um arquivo ou pasta, sem ler o conteúdo.
QUANDO USAR: para saber se um arquivo existe e o tamanho dele antes de ler.
COMO USAR: path = caminho completo.
NÃO FAÇA: não use para ler o conteúdo (use read_text_file).
RETORNA: tamanho, datas e permissões.""",
    "write_file": """O QUE FAZ: cria um arquivo ou SUBSTITUI POR COMPLETO o conteúdo de um existente. Pede autorização do Alexssander, com aviso das consequências.
QUANDO USAR: para criar um arquivo novo ou reescrever um arquivo inteiro a pedido do Alexssander.
COMO USAR: path = caminho completo (a pasta segura é backend/data/workspace); content = o texto completo do arquivo.
NÃO FAÇA: não use para mudar só um trecho (use edit_file); não sobrescreva um arquivo que você não leu antes; não escreva fora da pasta de trabalho sem o Alexssander pedir.
RETORNA: confirmação.""",
    "edit_file": """O QUE FAZ: troca trechos exatos de texto dentro de um arquivo existente. Pede autorização do Alexssander, com aviso das consequências.
QUANDO USAR: para corrigir ou alterar parte de um arquivo, sem reescrever tudo.
COMO USAR: edits = lista de {oldText, newText}; oldText deve ser IGUAL ao trecho do arquivo (leia antes com read_text_file). dryRun=true só mostra a mudança, sem gravar.
NÃO FAÇA: não edite sem ler o arquivo antes; não use oldText aproximado; não use para criar arquivo (use write_file).
RETORNA: o diff (o que mudou).""",
}


def rewrite_docstrings(path: Path, docs: dict[str, str]) -> None:
    src = open(path, encoding="utf-8", newline="").read()
    for name, text in docs.items():
        pat = re.compile(r'(def ' + re.escape(name) + r'\([^\n]*\n)    """[^\n]*"""\n')
        body = "\n".join(("    " + l) if l else "" for l in text.split("\n"))
        repl = r'\g<1>    """' + "\n" + body.replace("\\", "\\\\") + '\n    """\n'
        src, n = pat.subn(lambda m: m.group(1) + '    """\n' + body + '\n    """\n', src, count=1)
        assert n == 1, f"{path.name}: docstring de {name} não encontrada"
    open(path, "w", encoding="utf-8", newline="").write(src)


rewrite_docstrings(ROOT / "backend/Mcp/Browser/server.py", BROWSER)
rewrite_docstrings(ROOT / "backend/Mcp/Desktop/server.py", DESKTOP)

cfg_path = ROOT / "backend/mcp_servers.json"
cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
cfg["mcpServers"]["arquivos"]["descriptions"] = FILES
cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="")
print("ok:", len(BROWSER), "browser,", len(DESKTOP), "desktop,", len(FILES), "arquivos")
