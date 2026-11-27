"""Physical Nex sessions and the live screen of each terminal tab."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b.")
_ID = re.compile(r"^sessao-\d+$")
_TAB = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
ROOT = Path(r"C:\Users\Alexssander\Tools\nex-re\sessions")
CATALOG = Path(r"C:\Users\Alexssander\Tools\nex-re\backend_v2\sessions.json")
INDEX = Path(r"C:\Users\Alexssander\Tools\nex-re\backend_v2\mcp_index.json")
_LOCK = threading.Lock()
_SESSIONS: dict[str, dict[str, dict]] = {}


def _sid(session_id: str | None) -> str:
    return session_id if session_id and _ID.match(session_id) else "_"


def _slot(session_id: str | None, tab_id: str) -> dict:
    bucket = _SESSIONS.setdefault(_sid(session_id), {})
    return bucket.setdefault(tab_id, {"pty_pid": None, "buffer": deque(maxlen=100), "partial": ""})


def register_tab(session_id: str | None, tab_id: str, pid: int | None) -> None:
    if not tab_id or not _TAB.match(tab_id):
        return
    with _LOCK:
        slot = _slot(session_id, tab_id)
        if pid:
            slot["pty_pid"] = int(pid)


def drop_tab(session_id: str | None, tab_id: str) -> None:
    """Kill the PTY and delete that tab's buffer. A new tab never sees it."""
    if not tab_id or not _TAB.match(tab_id):
        return
    with _LOCK:
        bucket = _SESSIONS.get(_sid(session_id))
        slot = bucket.pop(tab_id, None) if bucket else None
        if bucket is not None and not bucket:
            _SESSIONS.pop(_sid(session_id), None)
    pid = (slot or {}).get("pty_pid")
    if not pid:
        return
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)


_STATUS_MARK = (b"execute_kali_command", b"execute_powershell_command")
_CURSOR_SMASH = re.compile(rb"\x1b\[[0-9;]*[A-GKHf]")


def xterm_chunk(data: bytes) -> bytes:
    """Status lines go out as their own CRLF lines. No cursor-up or erase that paints over the prompt."""
    raw = bytes(data)
    if not any(mark in raw for mark in _STATUS_MARK):
        return raw
    cleaned = _CURSOR_SMASH.sub(b"", raw)
    text = cleaned.decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if not text:
        return b""
    return ("\r\n" + text + "\r\n").encode("utf-8")


def note_pty_output(tab_id: str, data: bytes | str, session_id: str | None = None) -> None:
    """Keep finished lines for this tab only. cls/clear wipes that tab, not the session."""
    if not tab_id or not _TAB.match(tab_id):
        return
    raw = data.decode("utf-8", "replace") if isinstance(data, bytes) else data
    text = _ANSI.sub("", raw)
    with _LOCK:
        slot = _slot(session_id, tab_id)
        if "\x1b[2J" in raw or "\x1b[3J" in raw or "\x1bc" in raw:
            slot["buffer"].clear()
            slot["partial"] = ""
        line = slot["partial"]
        buf = slot["buffer"]
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "\r" and i + 1 < len(text) and text[i + 1] == "\n":
                if _CLEAR_CMD.match(line.strip()):
                    buf.clear()
                elif line.strip():
                    buf.append(line)
                line = ""
                i += 2
                continue
            if ch == "\n":
                if _CLEAR_CMD.match(line.strip()):
                    buf.clear()
                elif line.strip():
                    buf.append(line)
                line = ""
            elif ch == "\r":
                line = ""
            elif ch >= " " or ch == "\t":
                line += ch
            i += 1
        slot["partial"] = line


def screen_text(tab_id: str, limit: int = 100, session_id: str | None = None) -> str:
    if not tab_id or not _TAB.match(tab_id):
        return ""
    with _LOCK:
        slot = None
        if session_id:
            slot = _SESSIONS.get(_sid(session_id), {}).get(tab_id)
        if slot is None:
            for bucket in _SESSIONS.values():
                if tab_id in bucket:
                    slot = bucket[tab_id]
                    break
        lines = list(slot["buffer"]) if slot else []
    return "\n".join(lines[-limit:])


_CLEAR_CMD = re.compile(r"^(?:cls|clear|clear-host)$", re.I)


def _screen_path(sid: str) -> Path | None:
    if not _ID.match(sid or ""):
        return None
    folder = ROOT / sid
    return folder / "screen.txt" if folder.is_dir() else None


def _wipe_screen(sid: str) -> None:
    path = _screen_path(sid)
    if path is not None:
        path.write_text("", encoding="utf-8")


def _append_screen(sid: str, line: str) -> None:
    path = _screen_path(sid)
    if path is None:
        return
    if _CLEAR_CMD.match(line.strip()):
        path.write_text("", encoding="utf-8")
        return
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    if path.stat().st_size > 1_000_000:
        kept = path.read_text(encoding="utf-8", errors="replace")[-400_000:]
        path.write_text(kept, encoding="utf-8")


def read_screen_file(sid: str, limit: int = 8000) -> str:
    path = _screen_path(sid)
    if path is None or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")[-limit:]


def _clip(body: str, code: int) -> tuple[str, int]:
    text = body.strip()
    if len(text) > 4000:
        text = text[:4000] + "\n…[saída cortada]"
    return (text or f"(sem saída, código {code})"), code


def execute_kali_command(command: str) -> tuple[str, int]:
    """Run one command in the local Kali distro. WSL interop, no TCP between Windows and Linux."""
    text = (command or "").strip()
    if not text:
        return "comando vazio", 2
    try:
        proc = subprocess.run(
            ["wsl.exe", "-d", "kali-linux", "--", "bash", "-lc", text],
            capture_output=True,
            timeout=90,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return "o comando no Kali passou de 90s e foi interrompido", 124
    except OSError as exc:
        return f"não foi possível chamar o Kali: {exc}", 1
    chunks = [proc.stdout or "", proc.stderr or ""]
    body = "\n".join(part.strip() for part in chunks if part.strip())
    return _clip(body, int(proc.returncode))


def _workspace(sid: str) -> Path | None:
    folder = _folder(sid)
    if folder is None:
        return None
    space = folder / "workspace"
    return space if space.is_dir() else None


def _inside_workspace(sid: str, raw: str) -> Path | None:
    space = _workspace(sid)
    if space is None:
        return None
    candidate = (space / raw).resolve() if not Path(raw).is_absolute() else Path(raw).resolve()
    try:
        candidate.relative_to(space.resolve())
    except ValueError:
        return None
    return candidate


def execute_powershell_command(command: str, sid: str = "") -> tuple[str, int]:
    text = (command or "").strip()
    if not text:
        return "comando vazio", 2
    cwd = str(_workspace(sid) or Path.cwd())
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", text],
            capture_output=True,
            timeout=60,
            cwd=cwd,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return "o PowerShell passou de 60s e foi interrompido", 124
    except OSError as exc:
        return f"não foi possível chamar o PowerShell: {exc}", 1
    body = "\n".join(part.strip() for part in (proc.stdout, proc.stderr) if part and part.strip())
    return _clip(body, int(proc.returncode))


def web_search(query: str) -> tuple[str, int]:
    """Public web lookup for documentation. No local shell."""
    from urllib.parse import urlencode
    from urllib.request import Request, urlopen

    text = " ".join((query or "").split())
    if not text:
        return "consulta vazia", 2
    url = "https://html.duckduckgo.com/html/?" + urlencode({"q": text})
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"})
    try:
        with urlopen(req, timeout=20) as resp:
            html = resp.read().decode("utf-8", "replace")
    except OSError as exc:
        return f"busca indisponível: {exc}", 1
    titles = re.findall(r'class="result__a"[^>]*>(.*?)</a>', html, flags=re.S)
    snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</(?:a|td|div)>', html, flags=re.S)
    lines = []
    for index, title in enumerate(titles[:5]):
        clean_title = re.sub(r"<[^>]+>", "", title)
        clean_title = " ".join(clean_title.split())
        snippet = ""
        if index < len(snippets):
            snippet = " ".join(re.sub(r"<[^>]+>", "", snippets[index]).split())
        if clean_title:
            lines.append(f"{clean_title} — {snippet}".strip(" —"))
    if not lines:
        return "nenhum resultado na busca", 0
    return _clip("\n".join(lines), 0)


def read_file(path: str, sid: str = "") -> str:
    target = _inside_workspace(sid, path)
    if target is None or not target.is_file():
        return "arquivo fora do workspace da sessão"
    data = target.read_text(encoding="utf-8", errors="replace")
    return data[:4000]


def write_file(path: str, content: str, sid: str = "") -> str:
    target = _inside_workspace(sid, path)
    if target is None:
        return "caminho fora do workspace da sessão"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"gravado {target.name}"


def search_mcp_rag(query: str, sid: str = "") -> str:
    hits = tool_hits(query) or "Nenhuma ferramenta com esse nome. A tela desta aba está em screen.txt."
    screen = read_screen_file(sid)
    where = str(_screen_path(sid) or "sessão sem arquivo de tela")
    return f"Consulta: {query}\nArquivo da tela: {where}\n\n{hits}\n\nTela agora:\n{screen}"


def _load() -> dict:
    if not CATALOG.is_file():
        return {"sessions": []}
    try:
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"sessions": []}
    data.setdefault("sessions", [])
    return data


def _save(data: dict) -> None:
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def list_sessions() -> list[dict]:
    with _LOCK:
        return list(_load()["sessions"])


def _high_water(data: dict) -> int:
    """Highest session number ever used, including ones already deleted."""
    nums = [int(data.get("next_number") or 0)]
    for row in data.get("sessions") or []:
        sid = str(row.get("id") or "")
        if _ID.match(sid):
            nums.append(int(sid.split("-")[1]))
    if ROOT.is_dir():
        for child in ROOT.iterdir():
            if child.is_dir() and _ID.match(child.name):
                nums.append(int(child.name.split("-")[1]))
    return max(nums)


def create_session() -> dict:
    with _LOCK:
        data = _load()
        number = _high_water(data) + 1
        while (ROOT / f"sessao-{number}").exists():
            number += 1
        sid = f"sessao-{number}"
        folder = ROOT / sid
        workspace = folder / "workspace"
        workspace.mkdir(parents=True)
        meta = {
            "id": sid,
            "title": f"Sessão {number}",
            "path": str(workspace),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "history": [],
            "terminals": [{"kind": "powershell", "cwd": str(workspace)}],
        }
        (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        (folder / "evidence.jsonl").write_text("", encoding="utf-8")
        (folder / "desk.jsonl").write_text("", encoding="utf-8")
        (folder / "screen.txt").write_text("", encoding="utf-8")
        (folder / "activity.jsonl").write_text("", encoding="utf-8")
        data["next_number"] = number
        data["sessions"].append(meta)
        _save(data)
        return meta


def rename_session(sid: str, title: str) -> dict | None:
    title = title.strip()[:80]
    if not title:
        return None
    with _LOCK:
        data = _load()
        for row in data["sessions"]:
            if row.get("id") == sid:
                row["title"] = title
                _save(data)
                folder = _folder(sid)
                if folder:
                    (folder / "meta.json").write_text(json.dumps(row, ensure_ascii=False), encoding="utf-8")
                return row
    return None


def delete_session(sid: str) -> bool:
    if not _ID.match(sid or ""):
        return False
    with _LOCK:
        data = _load()
        kept = [row for row in data["sessions"] if row.get("id") != sid]
        if len(kept) == len(data["sessions"]):
            return False
        data["next_number"] = max(int(data.get("next_number") or 0), _high_water(data))
        data["sessions"] = kept
        _save(data)
    folder = ROOT / sid
    if folder.is_dir():
        shutil.rmtree(folder)
    return True


def _folder(sid: str) -> Path | None:
    if not _ID.match(sid or ""):
        return None
    folder = ROOT / sid
    return folder if folder.is_dir() else None


def tool_hits(prompt: str, limit: int = 3) -> str:
    if not INDEX.is_file():
        return ""
    try:
        rows = json.loads(INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return ""
    words = {word.lower() for word in re.findall(r"[A-Za-z0-9_]+", prompt) if len(word) > 2}
    hits = []
    for row in rows:
        blob = " ".join(str(row.get(key, "")) for key in ("name", "tags", "run")).lower()
        if words & set(re.findall(r"[a-z0-9_]+", blob)):
            hits.append(f"{row.get('name')}: {row.get('run')}")
        if len(hits) >= limit:
            break
    return "\n".join(hits)


def remember(sid: str, prompt: str, answer: str, screen: str) -> None:
    folder = _folder(sid)
    if folder is None:
        return
    stamp = datetime.now(timezone.utc).isoformat()
    with _LOCK:
        data = _load()
        for row in data["sessions"]:
            if row.get("id") == sid:
                history = row.setdefault("history", [])
                history.append({"role": "user", "text": prompt, "at": stamp})
                history.append({"role": "assistant", "text": answer, "at": stamp})
                del history[:-80]
                _save(data)
                break
    with (folder / "desk.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"role": "user", "text": prompt, "at": stamp}, ensure_ascii=False) + "\n")
        handle.write(json.dumps({"role": "assistant", "text": answer, "at": stamp}, ensure_ascii=False) + "\n")
    excerpt = "\n".join(screen.splitlines()[-20:])
    with (folder / "evidence.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"at": stamp, "prompt": prompt, "screen": excerpt, "answer": answer}, ensure_ascii=False) + "\n")


def note_activity(sid: str, phase: str, tool: str, detail: str) -> None:
    folder = _folder(sid)
    if folder is None:
        return
    row = {
        "at": datetime.now(timezone.utc).isoformat(),
        "phase": phase,
        "tool": tool[:80],
        "detail": " ".join(detail.split())[:400],
    }
    with (folder / "activity.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_activity(sid: str, limit: int = 40) -> list[dict]:
    folder = _folder(sid)
    if folder is None:
        return []
    path = folder / "activity.jsonl"
    if not path.is_file():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]:
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def evidence(sid: str, limit: int = 6) -> str:
    folder = _folder(sid)
    if folder is None:
        return ""
    rows = (folder / "evidence.jsonl").read_text(encoding="utf-8", errors="replace").splitlines()
    chunks = []
    for line in rows[-limit:]:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        chunks.append(f"pedido: {row.get('prompt', '')}\ntela: {row.get('screen', '')}\nresposta: {row.get('answer', '')}")
    return "\n---\n".join(chunks)


def desk(sid: str) -> list[dict]:
    folder = _folder(sid)
    if folder is None:
        return []
    out = []
    for line in (folder / "desk.jsonl").read_text(encoding="utf-8", errors="replace").splitlines()[-40:]:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out
