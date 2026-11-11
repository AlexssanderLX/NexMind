"""Ponte MCP entre o Nex e a extensão no Chrome já aberto. Não lança Chrome."""

from __future__ import annotations

import asyncio
import itertools
import json

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("nex-browser")

_PORT = 9334
_reader = None
_writer = None
_pending: dict[int, asyncio.Future] = {}
_ids = itertools.count(1)
_server_started = False

_MAX_TOKENS = 1500
_CHARS_PER_TOKEN = 4

_MISSING = (
    "A extensão Nex não está ligada ao Chrome aberto. "
    "Carregue uma vez a pasta extension/chrome em chrome://extensions, modo do desenvolvedor. "
    "O Chrome chama o host com.nex.chrome. Não abra outro navegador e não reinicie este."
)


def _clip(text: str) -> str:
    limit = _MAX_TOKENS * _CHARS_PER_TOKEN
    if len(text) <= limit:
        return text
    return text[:limit].rsplit("\n", 1)[0] + "\n[truncado em 1500 tokens]"


async def _read_exact(reader: asyncio.StreamReader, n: int) -> bytes:
    data = await reader.readexactly(n)
    return data


async def _read_frame(reader: asyncio.StreamReader) -> str | None:
    try:
        header = await _read_exact(reader, 4)
    except asyncio.IncompleteReadError:
        return None
    length = int.from_bytes(header, "little")
    if length <= 0 or length > 1024 * 1024:
        return None
    try:
        payload = await _read_exact(reader, length)
    except asyncio.IncompleteReadError:
        return None
    return payload.decode("utf-8", "replace")


async def _send_frame(writer: asyncio.StreamWriter, payload: bytes) -> None:
    if writer is None:
        return
    writer.write(len(payload).to_bytes(4, "little") + payload)
    await writer.drain()


async def _client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    global _reader, _writer
    _reader, _writer = reader, writer
    try:
        while True:
            frame = await _read_frame(reader)
            if frame is None:
                break
            data = json.loads(frame)
            fut = _pending.get(data.get("id"))
            if fut is not None and not fut.done():
                fut.set_result(data)
    finally:
        if _writer is writer:
            _reader = None
            _writer = None
        writer.close()


async def _ensure_server() -> None:
    global _server_started
    if _server_started:
        return
    await asyncio.start_server(_client, "127.0.0.1", _PORT)
    _server_started = True


async def _call(op: str, **args):
    await _ensure_server()
    for _ in range(30):
        if _writer is not None:
            break
        await asyncio.sleep(0.1)
    if _writer is None:
        raise RuntimeError(_MISSING)
    call_id = next(_ids)
    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    _pending[call_id] = fut
    try:
        await _send_frame(_writer, json.dumps({"id": call_id, "op": op, **args}).encode())
        data = await asyncio.wait_for(fut, 20)
    finally:
        _pending.pop(call_id, None)
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "A extensão recusou a operação.")
    return data.get("result")


@mcp.tool()
async def browser_navigate(url: str) -> str:
    """Abre a URL numa aba nova do grupo Nex, no Chrome já aberto. Não relança o Chrome."""
    result = await _call("navigate", url=url)
    return f"Aberto no grupo Nex, sem fechar o Chrome: {result.get('url')}"


@mcp.tool()
async def browser_get_dom() -> str:
    """Lê o texto visível da última aba do grupo Nex. Não mexe nas outras abas."""
    payload = await _call("get_dom")
    items = payload.get("items") or []
    lines = [f"[{item['id']}] {item['tag']} {item['label']}".strip() for item in items]
    text = (payload.get("text") or "").strip()
    if not text and not lines:
        return "Nenhum texto visível no grupo Nex."
    body = "Texto visível:\n" + (text or "(vazio)")
    if lines:
        body += "\n\nInterativos:\n" + "\n".join(lines)
    return _clip(body)


@mcp.tool()
async def browser_click(element_id: int) -> str:
    """Clica um elemento da última aba do grupo Nex."""
    await _call("click", elementId=element_id)
    return f"Clique em [{element_id}] no grupo Nex."


@mcp.tool()
async def browser_type(element_id: int, text: str, press_enter: bool = False) -> str:
    """Digita num campo da última aba do grupo Nex."""
    await _call("type", elementId=element_id, text=text, pressEnter=press_enter)
    return f"Texto digitado em [{element_id}] no grupo Nex."


@mcp.tool()
async def browser_close() -> str:
    """Solta o debugger das abas do grupo Nex. Não fecha o Chrome."""
    try:
        await _call("release")
    except RuntimeError:
        return "Extensão desconectada. O Chrome continua aberto."
    return "Debugger solto no grupo Nex. O Chrome continua aberto."


if __name__ == "__main__":
    mcp.run()
