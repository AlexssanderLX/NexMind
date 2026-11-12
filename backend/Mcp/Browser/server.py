"""Ponte MCP entre o Nex e a extensão no Chrome já aberto. Não lança Chrome.

O Chrome chama o host nativo (NexChromeHost.exe), que se conecta aqui em 127.0.0.1:9334 e prova que é ele
com o token de %LOCALAPPDATA%\\Nex\\chrome-host\\token. Sem o token a conexão é recusada.
Todo pedido passa antes por policy.py (esquema da URL, escopo e ritmo).
"""

from __future__ import annotations

import asyncio
import hmac
import itertools
import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from mcp.server.fastmcp import FastMCP

try:  # execução como pacote (python -m backend.Mcp.Browser.server)
    from .policy import Pacer, PolicyError, check_url, load_policy
except ImportError:  # execução direta do arquivo
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from policy import Pacer, PolicyError, check_url, load_policy

_PORT = int(os.environ.get("NEX_BROWSER_PORT", "9334"))
_TOKEN_FILE = Path(os.environ.get("NEX_BROWSER_TOKEN_FILE") or (Path(os.environ.get("LOCALAPPDATA", "")) / "Nex" / "chrome-host" / "token"))
_HELLO_TIMEOUT = 3.0

_writer = None
_pending: dict[int, asyncio.Future] = {}
_ids = itertools.count(1)
_server = None
_bind_error: str | None = None
_pacer: Pacer | None = None

_MAX_TOKENS = 1500
_CHARS_PER_TOKEN = 4

_MISSING = (
    "A extensão Nex não está ligada ao Chrome aberto. "
    "Carregue uma vez a pasta extension/chrome em chrome://extensions, modo do desenvolvedor. "
    "O Chrome chama o host com.nex.chrome. Não abra outro navegador e não reinicie este."
)


def _log(msg: str) -> None:
    print(f"[nex-browser] {msg}", file=sys.stderr, flush=True)


def _clip(text: str) -> str:
    limit = _MAX_TOKENS * _CHARS_PER_TOKEN
    if len(text) <= limit:
        return text
    return text[:limit].rsplit("\n", 1)[0] + "\n[truncado em 1500 tokens]"


def _token() -> str | None:
    try:
        value = _TOKEN_FILE.read_text(encoding="ascii").strip()
    except OSError:
        return None
    return value or None


async def _read_frame(reader: asyncio.StreamReader, timeout: float | None = None) -> str | None:
    async def _go() -> str | None:
        try:
            header = await reader.readexactly(4)
            length = int.from_bytes(header, "little")
            if length <= 0 or length > 1024 * 1024:
                return None
            payload = await reader.readexactly(length)
        except (asyncio.IncompleteReadError, ConnectionError):
            return None
        return payload.decode("utf-8", "replace")

    if timeout is None:
        return await _go()
    try:
        return await asyncio.wait_for(_go(), timeout)
    except asyncio.TimeoutError:
        return None


async def _send_frame(writer: asyncio.StreamWriter, payload: bytes) -> None:
    writer.write(len(payload).to_bytes(4, "little") + payload)
    await writer.drain()


def _fail_pending(reason: str) -> None:
    for fut in list(_pending.values()):
        if not fut.done():
            fut.set_exception(RuntimeError(reason))


async def _client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    global _writer
    expected = _token()
    hello = await _read_frame(reader, _HELLO_TIMEOUT)
    ok = False
    if expected and hello:
        try:
            got = json.loads(hello).get("hello")
            ok = isinstance(got, str) and hmac.compare_digest(got.encode(), expected.encode())
        except ValueError:
            ok = False
    if not ok:
        _log("conexão recusada: token ausente ou inválido")
        writer.close()
        return
    old = _writer
    _writer = writer
    if old is not None and old is not writer:
        old.close()  # o host mais novo vale; o anterior está morto ou sobrando
    try:
        while True:
            frame = await _read_frame(reader)
            if frame is None:
                break
            try:
                data = json.loads(frame)
            except ValueError:
                continue
            fut = _pending.get(data.get("id")) if isinstance(data, dict) else None
            if fut is not None and not fut.done():
                fut.set_result(data)
    finally:
        if _writer is writer:
            _writer = None
            _fail_pending("A extensão desconectou durante o pedido.")
        writer.close()


async def _ensure_server() -> None:
    global _server, _bind_error
    if _server is not None:
        return
    try:
        _server = await asyncio.start_server(_client, "127.0.0.1", _PORT)
        _bind_error = None
    except OSError as exc:
        _bind_error = f"A porta {_PORT} do Nex está ocupada por outro processo ({exc.strerror}). Feche a janela antiga do Nex e tente de novo."
        _log(_bind_error)


@asynccontextmanager
async def _lifespan(_app):
    await _ensure_server()  # já escuta ao subir, assim o host nativo conecta antes do primeiro pedido
    yield


mcp = FastMCP("nex-browser", lifespan=_lifespan)


def _get_pacer() -> Pacer:
    global _pacer
    if _pacer is None:
        _pacer = Pacer(load_policy())
    return _pacer


async def _call(op: str, **args):
    await _ensure_server()
    if _bind_error:
        raise RuntimeError(_bind_error)
    for _ in range(30):
        if _writer is not None:
            break
        await asyncio.sleep(0.1)
    writer = _writer
    if writer is None:
        raise RuntimeError(_MISSING)
    call_id = next(_ids)
    fut: asyncio.Future = asyncio.get_running_loop().create_future()
    _pending[call_id] = fut
    try:
        await _send_frame(writer, json.dumps({"id": call_id, "op": op, **args}).encode())
        data = await asyncio.wait_for(fut, 20)
    except (ConnectionError, asyncio.TimeoutError) as exc:
        raise RuntimeError("A extensão não respondeu a tempo. O Chrome continua aberto.") from exc
    finally:
        _pending.pop(call_id, None)
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "A extensão recusou a operação.")
    return data.get("result")


@mcp.tool()
async def browser_tabs() -> str:
    """
    O QUE FAZ: lista as abas do grupo Nex (número, título, site e qual é a atual).
    QUANDO USAR: no começo de qualquer tarefa no navegador, e sempre que o Alexssander disser que abriu algo ou pedir para trabalhar nas abas dele.
    COMO USAR: sem argumentos.
    NÃO FAÇA: não chame de novo sem necessidade; não procure abas fora do grupo (para você elas não existem).
    RETORNA: uma linha por aba, no formato [número] título - endereço. Esse número é o tab_id das outras ferramentas.
    SE O GRUPO ESTIVER VAZIO: abra uma página com browser_navigate.
    """
    payload = await _call("tabs")
    tabs = payload.get("tabs") or []
    if not tabs:
        return "O grupo Nex não tem abas. Abra uma URL com browser_navigate, ou peça ao Alexssander para abrir páginas dentro do grupo Nex."
    lines = [f"[{t['id']}]{' (atual)' if t.get('current') else ''} {t.get('title') or '(sem título)'} - {t.get('url')}" for t in tabs]
    return "Abas do grupo Nex:\n" + "\n".join(lines)


async def _open(url: str, tab_id: int) -> str:
    pacer = _get_pacer()
    try:
        host = check_url(url, pacer.cfg)
        waited = await pacer.before_navigate(host)
    except PolicyError as exc:
        raise RuntimeError(str(exc)) from exc
    result = await _call("navigate", url=url, tabId=int(tab_id) or None)
    note = f" (aguardei {waited:.1f} s para não acelerar o site)" if waited >= 0.5 else ""
    pending = "" if result.get("loaded", True) else " A página ainda estava carregando: chame browser_get_dom de novo em instantes."
    return f"Aberto na aba [{result.get('tabId')}] do grupo Nex, sem fechar o Chrome: {result.get('url')}{note}{pending}"


@mcp.tool()
async def browser_navigate(url: str) -> str:
    """
    O QUE FAZ: abre um endereço numa aba NOVA do grupo Nex. As outras abas não mudam.
    QUANDO USAR: para ir a um site que ainda não está aberto (exemplo: "abre o Gmail").
    COMO USAR: url completa com https:// (exemplo: https://mail.google.com/). Se o Alexssander só disse o nome do site, use o endereço principal dele.
    NÃO FAÇA: não abra várias páginas seguidas sem ler a anterior; não abra de novo um site que já está nas abas (veja browser_tabs); não use para trocar uma aba existente (use browser_reuse_tab); só aceita http e https.
    RETORNA: o número da aba aberta. Depois SEMPRE leia a página com browser_get_dom.
    SE DER ERRO: "ritmo alto", "fora do escopo" ou "bloqueado" = avise o Alexssander em uma frase e pare; "limite de abas" = peça para ele fechar abas do grupo.
    """
    return await _open(url, 0)


@mcp.tool()
async def browser_reuse_tab(tab_id: int, url: str) -> str:
    """
    O QUE FAZ: troca o endereço de uma aba que JÁ está no grupo Nex. O conteúdo atual dela é perdido.
    QUANDO USAR: só quando o Alexssander pedir para reaproveitar ou trocar uma aba, ou quando o grupo estiver cheio.
    COMO USAR: tab_id = número da aba (de browser_tabs); url completa com https://.
    NÃO FAÇA: não use para abrir um site novo (use browser_navigate); não use em aba em que o Alexssander está trabalhando sem ele pedir.
    RETORNA: o número da aba. Depois SEMPRE leia com browser_get_dom.
    SE DER ERRO: "não está no grupo Nex" = chame browser_tabs e use um número da lista.
    """
    if not int(tab_id):
        raise RuntimeError("Informe o tab_id de uma aba do grupo (veja browser_tabs).")
    return await _open(url, tab_id)


@mcp.tool()
async def browser_get_dom(tab_id: int = 0) -> str:
    """
    O QUE FAZ: lê o texto visível e a lista de itens clicáveis ([número] tipo nome) de uma aba do grupo Nex.
    QUANDO USAR: depois de abrir, trocar, clicar ou digitar, e SEMPRE antes de dizer qualquer coisa sobre uma página. Nunca responda sobre uma página sem ter lido.
    COMO USAR: sem argumentos lê a aba atual. Para outra aba, passe tab_id (de browser_tabs).
    NÃO FAÇA: não invente o que não apareceu; não reuse números de itens de uma leitura antiga ou de outra aba.
    RETORNA: "Aba [número] endereço", o texto visível (até 6000 caracteres) e "Interativos" com os números para clicar ou digitar. Página longa vem cortada: diga isso se faltar parte.
    SE VIER VAZIO: espere um instante e chame de novo uma vez.
    """
    await _get_pacer().before_action()
    # A extensão espera a SPA estabilizar (até 3 s) antes de extrair o DOM. Não há page Playwright aqui.
    payload = await _call("get_dom", tabId=int(tab_id) or None)
    items = payload.get("items") or []
    lines = [f"[{item['id']}] {item['tag']} {item['label']}".strip() for item in items]
    text = (payload.get("text") or "").strip()
    head = f"Aba [{payload.get('tabId')}] {payload.get('url')}\n"
    if not text and not lines:
        return head + "Nenhum texto visível nessa aba."
    body = head + "Texto visível:\n" + (text or "(vazio)")
    if lines:
        body += "\n\nInterativos (os números valem só para esta aba):\n" + "\n".join(lines)
    return _clip(body)


RECON_MAX_CHARS = 2500


def build_recon(payload: dict, max_chars: int = RECON_MAX_CHARS) -> str:
    """Resumo estruturado da superfície de uma página, em JSON compacto e SEMPRE válido (nunca cortado no meio).

    Se passar do limite, descarta itens inteiros do fim das listas menos importantes primeiro (links, scripts, campos soltos,
    endpoints, formulários) e registra em "omitidos" quantos saíram, para o modelo saber que há mais.
    """
    def host(url: str) -> str:
        return url.split("://", 1)[-1]

    links = [{"u": host(x["href"]), "t": x.get("label", "")} if x.get("label") else host(x["href"]) for x in payload.get("links") or [] if x.get("href")]
    forms = [
        {"action": host(f.get("action") or ""), "method": f.get("method") or "get", "fields": [f"{c.get('name')}:{c.get('type')}" for c in f.get("fields") or []]}
        for f in payload.get("forms") or []
    ]
    inputs = [f"{c.get('name')}:{c.get('type')}" for c in payload.get("inputs") or []]
    scripts = [host(s) for s in payload.get("scripts") or []]
    endpoints = list(payload.get("endpoints") or [])
    lists = {"links": links, "scripts": scripts, "inputs": inputs, "endpoints": endpoints, "forms": forms}
    omitted: dict[str, int] = {}

    def render() -> str:
        doc: dict = {"tab": payload.get("tabId"), "url": payload.get("url"), "title": payload.get("title") or ""}
        for key in ("forms", "inputs", "endpoints", "scripts", "links"):
            if lists[key]:
                doc[key] = lists[key]
        if payload.get("inlineScripts"):
            doc["inlineScripts"] = payload["inlineScripts"]
        if omitted:
            doc["omitidos"] = dict(omitted)
        return json.dumps(doc, ensure_ascii=False, separators=(",", ":"))

    order = ["links", "scripts", "inputs", "endpoints", "forms"]  # o que sai primeiro, quando falta espaço
    out = render()
    while len(out) > max_chars:
        victim = next((k for k in order if lists[k]), None)
        if victim is None:
            break
        # tira em lotes (~10% do que resta) do FIM da lista: a parte de cima é a mais relevante
        drop = max(1, len(lists[victim]) // 10)
        del lists[victim][-drop:]
        omitted[victim] = omitted.get(victim, 0) + drop
        out = render()
    if len(out) > max_chars:  # só título e url enormes: nunca devolve JSON quebrado
        out = json.dumps({"tab": payload.get("tabId"), "url": str(payload.get("url"))[:200], "omitidos": "tudo"}, ensure_ascii=False, separators=(",", ":"))
    return out


@mcp.tool()
async def browser_recon(tab_id: int = 0) -> str:
    """
    O QUE FAZ: mapeia a superfície de uma aba do grupo Nex num JSON curto (até 2500 caracteres): links, formulários (action, método, campos), campos soltos, scripts externos e endpoints /api achados em scripts. Sem CSS, SVG nem texto decorativo.
    QUANDO USAR: ao pedido de mapear, reconhecer, listar rotas, endpoints, formulários, parâmetros ou scripts de uma página, ou para entender a estrutura antes de testar. Para LER o conteúdo (texto) use browser_get_dom.
    COMO USAR: sem argumentos lê a aba atual. Para outra aba, passe tab_id (de browser_tabs). É leitura: roda direto, sem aprovação.
    NÃO FAÇA: não invente rotas que não vieram na lista; não trate "endpoints" como vulnerabilidades, são só o que a página referencia.
    RETORNA: JSON com tab, url, title, forms, inputs, endpoints, scripts, links e, se algo foi omitido por tamanho, "omitidos" com a contagem.
    SE VIER VAZIO: espere um instante e chame de novo uma vez.
    """
    await _get_pacer().before_action()
    payload = await _call("recon", tabId=int(tab_id) or None)
    return build_recon(payload)


@mcp.tool()
async def browser_click(element_id: int, tab_id: int = 0) -> str:
    """
    O QUE FAZ: clica num item da página (botão, link, aba ou menu do site). Pede autorização do Alexssander.
    QUANDO USAR: para abrir um link, apertar um botão, trocar de aba ou menu do site.
    COMO USAR: element_id = o número entre colchetes do item, na lista Interativos da ÚLTIMA leitura DA MESMA ABA. Em outra aba, passe também tab_id.
    NÃO FAÇA: não clique para digitar num campo (use browser_type); não adivinhe número; se o item não está na lista, diga que não achou; não clique em enviar, comprar, apagar ou confirmar se o Alexssander não pediu isso.
    RETORNA: só a confirmação do clique, não o resultado. Depois SEMPRE chame browser_get_dom e relate o que apareceu.
    SE DER ERRO "não está mais na aba": leia a página de novo e use o número novo.
    """
    await _get_pacer().before_action()
    await _call("click", elementId=int(element_id), tabId=int(tab_id) or None)
    return f"Clique em [{element_id}] feito no grupo Nex. A página pode ter mudado: chame browser_get_dom para ver o que apareceu antes de relatar qualquer resultado."


@mcp.tool()
async def browser_type(element_id: int, text: str, press_enter: bool = False, tab_id: int = 0) -> str:
    """
    O QUE FAZ: digita um texto num campo da página (busca, caixa de texto, formulário). Pede autorização do Alexssander.
    QUANDO USAR: para escrever num campo. Ele já foca o campo e troca o conteúdo: NÃO clique no campo antes.
    COMO USAR: element_id = número do campo na lista Interativos da última leitura da mesma aba; text = exatamente o texto; press_enter=true só para executar uma busca. Em outra aba, passe também tab_id.
    NÃO FAÇA: não digite senha, código ou dado financeiro sem perguntar antes ao Alexssander; não aperte Enter em formulário de envio sem ele pedir; não digite em campo que não está na lista.
    RETORNA: o valor que ficou no campo. Depois chame browser_get_dom para ver a reação da página (tradução, resultados) e só então relate.
    """
    await _get_pacer().before_action()
    result = await _call("type", elementId=int(element_id), text=text, pressEnter=bool(press_enter), tabId=int(tab_id) or None)
    now = (result or {}).get("value")
    shown = f" Valor que ficou no campo: {now!r}." if now is not None else ""
    return f"Texto digitado em [{element_id}] no grupo Nex.{shown} Chame browser_get_dom para ler o resultado na página antes de relatá-lo."


@mcp.tool()
async def browser_close() -> str:
    """
    O QUE FAZ: solta o controle das abas do grupo Nex (some o aviso de depuração do Chrome). Não fecha abas nem o Chrome.
    QUANDO USAR: só quando terminar o trabalho no navegador ou quando o Alexssander pedir.
    COMO USAR: sem argumentos.
    NÃO FAÇA: não use para "fechar a aba": você não fecha abas.
    RETORNA: confirmação.
    """
    try:
        await _call("release")
    except RuntimeError:
        return "Extensão desconectada. O Chrome continua aberto."
    return "Controle solto no grupo Nex. As abas e o Chrome continuam abertos."


if __name__ == "__main__":
    mcp.run()
