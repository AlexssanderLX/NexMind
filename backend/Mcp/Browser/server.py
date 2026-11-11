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
    """Lista as abas do grupo Nex (id, título, site e qual é a atual). Use para saber o que já está aberto, inclusive o que o Alexssander abriu."""
    payload = await _call("tabs")
    tabs = payload.get("tabs") or []
    if not tabs:
        return "O grupo Nex não tem abas. Abra uma URL com browser_navigate, ou peça ao Alexssander para abrir páginas dentro do grupo Nex."
    lines = [f"[{t['id']}]{' (atual)' if t.get('current') else ''} {t.get('title') or '(sem título)'} - {t.get('url')}" for t in tabs]
    return "Abas do grupo Nex:\n" + "\n".join(lines)


@mcp.tool()
async def browser_navigate(url: str, tab_id: int = 0) -> str:
    """Abre a URL em uma aba NOVA do grupo Nex (padrão). Com tab_id, troca o endereço dessa aba do grupo. Só http e https. Respeita o escopo e o ritmo definidos."""
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
async def browser_get_dom(tab_id: int = 0) -> str:
    """Lê o texto visível e os itens clicáveis de uma aba do grupo Nex (a atual, ou a indicada em tab_id). Não mexe nas abas fora do grupo."""
    await _get_pacer().before_action()
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


@mcp.tool()
async def browser_click(element_id: int, tab_id: int = 0) -> str:
    """Clica um elemento de uma aba do grupo Nex (a atual, ou a indicada em tab_id). O número vem de browser_get_dom da mesma aba."""
    await _get_pacer().before_action()
    await _call("click", elementId=int(element_id), tabId=int(tab_id) or None)
    return f"Clique em [{element_id}] feito no grupo Nex. A página pode ter mudado: chame browser_get_dom para ver o que apareceu antes de relatar qualquer resultado."


@mcp.tool()
async def browser_type(element_id: int, text: str, press_enter: bool = False, tab_id: int = 0) -> str:
    """Digita num campo de uma aba do grupo Nex (a atual, ou a indicada em tab_id). O número vem de browser_get_dom da mesma aba."""
    await _get_pacer().before_action()
    result = await _call("type", elementId=int(element_id), text=text, pressEnter=bool(press_enter), tabId=int(tab_id) or None)
    now = (result or {}).get("value")
    shown = f" Valor que ficou no campo: {now!r}." if now is not None else ""
    return f"Texto digitado em [{element_id}] no grupo Nex.{shown} Chame browser_get_dom para ler o resultado na página antes de relatá-lo."


@mcp.tool()
async def browser_close() -> str:
    """Solta o controle das abas do grupo Nex. Não fecha abas nem o Chrome."""
    try:
        await _call("release")
    except RuntimeError:
        return "Extensão desconectada. O Chrome continua aberto."
    return "Controle solto no grupo Nex. As abas e o Chrome continuam abertos."


if __name__ == "__main__":
    mcp.run()
