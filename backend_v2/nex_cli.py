"""nex <texto> — pergunta ao modelo ativo e imprime a resposta."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"


def _dashboard_token() -> str:
    """Loopback dashboard embeds its session token in the page. A bare shell has no env var."""
    try:
        page = urlrequest.urlopen(f"http://{_nex_host()}:9119/", timeout=5)
        html = page.read().decode("utf-8", "replace")
    except (OSError, URLError):
        return ""
    match = re.search(r"__HERMES_SESSION_TOKEN__=.([A-Za-z0-9_\-]+)", html)
    return match.group(1) if match else ""


def _inside_wsl() -> bool:
    try:
        with open("/proc/version", encoding="utf-8", errors="replace") as handle:
            return "microsoft" in handle.read().lower()
    except OSError:
        return False


_IN_WSL = _inside_wsl()


def _nex_host() -> str:
    """Inside WSL, 127.0.0.1 is the Linux VM. The dashboard listens on Windows."""
    if not _IN_WSL:
        return "127.0.0.1"
    host = subprocess.getoutput("ip route | awk '/default/ {print $3; exit}'").strip()
    return host or "127.0.0.1"


def _active_shell() -> str:
    """Requisito 1: identifica a aba ativa para o modelo nunca confundir Windows com Kali."""
    return "KALI_LINUX_WSL" if _IN_WSL else "POWERSHELL_WINDOWS"


HOST = _nex_host()
URL = f"http://{HOST}:9119/api/chat"


def _headers() -> dict:
    headers = {"Content-Type": "application/json", "User-Agent": _UA}
    token = os.environ.get("HERMES_DASHBOARD_TOKEN", "") or _dashboard_token()
    if token:
        headers["X-Hermes-Session-Token"] = token
    return headers


def _screen() -> str:
    tab = os.environ.get("NEX_TAB_ID", "").strip()
    if not tab:
        return os.environ.get("NEX_TAIL", "")
    req = urlrequest.Request(
        f"http://{HOST}:9119/api/terminals/{tab}/buffer",
        headers=_headers(),
        method="GET",
    )
    try:
        with urlrequest.urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, OSError, json.JSONDecodeError):
        return os.environ.get("NEX_TAIL", "")
    return str(payload.get("text") or "")


def _activity(sid: str) -> list[dict]:
    if not sid:
        return []
    req = urlrequest.Request(f"http://{HOST}:9119/api/nex/activity/{sid}", headers=_headers(), method="GET")
    try:
        with urlrequest.urlopen(req, timeout=4) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, OSError, json.JSONDecodeError):
        return []
    events = payload.get("events")
    return events if isinstance(events, list) else []


_LOCK = threading.Lock()
_GRAY = "\033[38;2;139;148;158m"


def _write(text: str) -> None:
    with _LOCK:
        sys.stdout.buffer.write(text.encode("utf-8", "replace"))
        sys.stdout.buffer.flush()


def _box_rows(text: str, color: str = _GRAY) -> None:
    words = text.split()
    rows: list[str] = []
    current = ""
    for word in words:
        trial = word if not current else current + " " + word
        if len(trial) > 72 and current:
            rows.append(current)
            current = word
        else:
            current = trial
    if current:
        rows.append(current)
    for row in rows or [""]:
        _write(f"\r\n{color}│ {row}\033[0m")


def _open_box() -> None:
    _write(f"\r\n{_GRAY}┌ pensamento\033[0m\r\n{_GRAY}│ \033[0m")


class _Live:
    def __init__(self) -> None:
        self.col = 0
        self.open = False

    def start(self) -> None:
        with _LOCK:
            if self.open:
                return
            sys.stdout.buffer.write(f"\r\n{_GRAY}┌ pensamento\033[0m\r\n{_GRAY}│ \033[0m".encode("utf-8"))
            sys.stdout.buffer.flush()
            self.col = 0
            self.open = True

    def think(self, text: str) -> None:
        with _LOCK:
            if not self.open:
                sys.stdout.buffer.write(f"\r\n{_GRAY}┌ pensamento\033[0m\r\n{_GRAY}│ \033[0m".encode("utf-8"))
                self.col = 0
                self.open = True
            for char in text.replace("\r", ""):
                if char == "\n" or self.col >= 72:
                    sys.stdout.buffer.write(f"\r\n{_GRAY}│ \033[0m".encode("utf-8"))
                    self.col = 0
                    if char == "\n":
                        continue
                sys.stdout.buffer.write(f"{_GRAY}{char}\033[0m".encode("utf-8"))
                self.col += 1
            sys.stdout.buffer.flush()

    def close(self) -> None:
        with _LOCK:
            if not self.open:
                return
            sys.stdout.buffer.write(f"\r\n{_GRAY}└\033[0m\r\n".encode("utf-8"))
            sys.stdout.buffer.flush()
            self.open = False

    def pause(self) -> None:
        """Fecha a caixa antes de uma linha de ferramenta, para ela não pintar por cima do pensamento."""
        self.close()


_LIVE = _Live()


def _close_box() -> None:
    _write(f"\r\n{_GRAY}└\033[0m\r\n")


_PLAN_ITEM = re.compile(r"^\s*-\s*\[([ xX>])\]\s*(.+?)\s*$")
_PLAN_NAME = "plan.md"


def _plan_mtime(cwd: str) -> float:
    try:
        return os.path.getmtime(os.path.join(cwd, _PLAN_NAME))
    except OSError:
        return 0.0


def _render_plan_panel(cwd: str) -> None:
    """Requisito: painel visual compacto do plan.md quando o agente o cria/atualiza no turno."""
    path = os.path.join(cwd, _PLAN_NAME)
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            lines = handle.readlines()
    except OSError:
        return
    items: list[tuple[str, str]] = []
    for line in lines:
        match = _PLAN_ITEM.match(line)
        if match:
            items.append((match.group(1).lower() or " ", match.group(2)))
    if not items:
        return
    width = 50
    _write(f"\r\n{_GRAY}┌ plano de execução " + "─" * max(0, width - 20) + f"\033[0m")
    for mark, label in items:
        glyph = "x" if mark == "x" else ">" if mark == ">" else " "
        color = "\033[32m" if glyph == "x" else "\033[33m" if glyph == ">" else _GRAY
        _write(f"\r\n{_GRAY}│ {color}[{glyph}] {label}\033[0m")
    _write(f"\r\n{_GRAY}└" + "─" * width + "\033[0m")


_CODE_RE = re.compile(r"-?\d+")


def _paint_status(row: dict, progress: set[str]) -> None:
    """Requisito 3: telemetria visível em tempo real de cada ferramenta disparada pelo modelo."""
    tool = str(row.get("tool") or "")
    phase = str(row.get("phase") or "")
    detail = " ".join(str(row.get("detail") or "").split())
    if phase == "think":
        return
    if tool in {"agente", "raciocínio"}:
        return
    if phase == "run":
        _LIVE.pause()
        _write(f"\r\n\033[33m⚡ [Executando: {tool}] -> {detail}\033[0m\r\n")
        _write("\033[90m… [em execução: aguardando resposta do sistema/rede...]\033[0m\r\n")
        progress.add(str(row.get("at") or tool))
    elif phase == "done":
        _LIVE.pause()
        match = _CODE_RE.search(detail)
        code = match.group(0) if match else detail or "0"
        _write(f"\033[32m✓ [Concluído: código {code}]\033[0m\r\n\r\n")
        progress.discard(str(row.get("at") or ""))
    elif phase == "error":
        _LIVE.pause()
        _write(f"\033[31m✗ [Falhou: {tool}] -> {detail}\033[0m\r\n\r\n")
    else:
        return


def _watch(sid: str, stop: threading.Event, started: str, seen: set[str]) -> None:
    """Print thought and commands under the question while the chat call is still open."""
    while not stop.is_set():
        for row in _activity(sid):
            stamp = str(row.get("at") or "")
            if started and stamp <= started:
                continue
            tool = str(row.get("tool") or "")
            phase = str(row.get("phase") or "")
            key = stamp + phase + tool
            if key in seen:
                continue
            seen.add(key)
            _paint_status(row, set())
        stop.wait(0.4)


def _reply(payload: dict, prompt: str) -> str:
    """Only the model's final text. Never the question, and never a cached prompt field."""
    text = ""
    for key in ("response", "content"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            text = value.strip()
            break
    message = payload.get("message")
    if not text and isinstance(message, dict) and isinstance(message.get("content"), str):
        text = message["content"].strip()
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"<think>[\s\S]*$", "", text).strip()
    asked = " ".join(prompt.casefold().split())
    said = " ".join(text.casefold().split())
    if not said or said == asked or (len(said) >= 8 and said in asked):
        return ""
    return text


def main() -> int:
    text = " ".join(sys.argv[1:]).strip()
    if not text:
        print("uso: nex <texto>", file=sys.stderr)
        return 2
    tab_uuid = os.environ.get("NEX_TAB_ID", "")
    body = json.dumps({
        "session_id": os.environ.get("NEX_SESSION_ID", ""),
        "prompt": text,
        "tab_uuid": tab_uuid,
        "tab_id": tab_uuid,
        "cwd": os.getcwd(),
        "shell": _active_shell(),
        "stream": True,
    }).encode("utf-8")
    headers = _headers()
    headers["Cache-Control"] = "no-store"
    req = urlrequest.Request(URL, data=body, headers=headers, method="POST")
    cwd = os.getcwd()
    plan_before = _plan_mtime(cwd)
    sid = os.environ.get("NEX_SESSION_ID", "")
    prior = _activity(sid)
    started = str(prior[-1].get("at") or "") if prior else ""
    stop = threading.Event()
    seen: set[str] = set()
    watcher = threading.Thread(target=_watch, args=(sid, stop, started, seen), daemon=True)
    watcher.start()
    failed = ""
    answer = ""
    try:
        try:
            with urlrequest.urlopen(req, timeout=150) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8", "replace").strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(event, dict):
                        continue
                    kind = str(event.get("t") or "")
                    if kind == "think":
                        _LIVE.think(str(event.get("d") or ""))
                    elif kind == "answer":
                        answer = str(event.get("d") or "")
                    elif kind == "error":
                        failed = str(event.get("d") or "erro")
                    elif event.get("response"):
                        answer = str(event.get("response") or "")
                        _LIVE.think(str(event.get("reasoning") or ""))
        except HTTPError as exc:
            failed = exc.read().decode("utf-8", errors="replace")[:500]
        except URLError as exc:
            failed = f"Nex Core indisponível em {URL}: {exc.reason}"
    finally:
        stop.set()
        watcher.join(timeout=1.5)
        for row in _activity(sid):
            stamp = str(row.get("at") or "")
            if started and stamp <= started:
                continue
            key = stamp + str(row.get("phase") or "") + str(row.get("tool") or "")
            if key in seen:
                continue
            seen.add(key)
            _paint_status(row, set())
    _LIVE.close()
    if _plan_mtime(cwd) != plan_before:
        _render_plan_panel(cwd)
    _write("\r\n")
    if failed:
        print(failed, file=sys.stderr)
        _write("\r\n")
        return 1
    reply = _reply({"response": answer}, text)
    if not reply:
        print("o modelo não respondeu", file=sys.stderr)
        _write("\r\n")
        return 1
    _write("\r\n\033[38;2;189;147;249m" + reply.replace("\r", "") + "\033[0m\r\n\r\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
