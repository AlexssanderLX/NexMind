"""One-shot `nex <texto>` from a local shell. No tools, no session row."""

from __future__ import annotations

import json
import re
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from hermes_cli.nex_ops import (
    create_session, delete_session, desk, drop_tab, evidence, execute_kali_command,
    execute_powershell_command, list_sessions, note_activity, read_activity, read_file,
    read_screen_file, remember, rename_session, screen_text, search_mcp_rag, web_search, write_file,
)
from hermes_cli.runtime_provider import resolve_runtime_provider
from hermes_cli.web_deps import late

_GROUNDING_GATE = (
    "GROUNDING GATE (CONFIRMAÇÃO OBRIGATÓRIA — PROIBIDO DEDUZIR OU CHUTAR): "
    "Se a pergunta exigir confirmação factual, dados mutáveis, autores de teorias (ex: 'Os Quatro Amores', "
    "teses filosóficas), nomes de pessoas reais, censos ou banners de serviços: "
    "é TERMINANTEMENTE PROIBIDO responder com base na memória de treinamento estática ou inventar autores "
    "de cabeça (alucinação). Reconheça a intenção de confirmação certeira e DISPARE OBRIGATORIAMENTE a "
    "ferramenta correspondente (web_search, read_file, etc.). Nenhuma afirmação factual pode ser entregue "
    "sem que a ferramenta tenha sido executada de verdade neste turno."
)

_PACING_RULES = (
    "RITMO DINÂMICO DE EXECUÇÃO: "
    "1. Modo Sprint (perguntas diretas, saudações, comandos pontuais): Responda em 1 turno, de forma concisa e direta. "
    "2. Modo Deep (tarefas complexas, auditorias, pentest, pesquisas detalhadas, refatorações): "
    "Você DEVE abraçar a complexidade, decompor o trabalho e usar Markdown completo (títulos, listas, blocos de código). "
    "Para tarefas multietapas, crie e mantenha o arquivo 'plan.md' no workspace atual descrevendo as etapas "
    "com checkboxes (- [ ] Etapa), marcando com [x] conforme cada etapa for concluída e validada."
)

_PERSONA = (
    "Você é o Nex Core, agente operacional com capacidade de execução real de ferramentas no ambiente local. "
    "Você possui duas ferramentas de execução: execute_powershell_command e execute_kali_command. "
    + _GROUNDING_GATE + " "
    "ROTEAMENTO OBRIGATÓRIO: "
    "Para informações do sistema host, hardware (GPU, RAM, CPU), arquivos locais do Windows e tarefas do shell atual: "
    "use OBRIGATORIAMENTE execute_powershell_command (ex: Get-CimInstance, systeminfo, dir). "
    "Para ferramentas de segurança ofensiva, escaneamento de rede e tarefas Linux (nmap, gobuster, python de pentest): "
    "use execute_kali_command. "
    "NUNCA chame o Kali Linux para inspecionar hardware do Windows. "
    "O Filesystem da sessão usa read_file e write_file, só dentro da pasta da sessão. "
    "Se o usuário pedir para rodar algo no Kali, nunca diga que não consegue: chame execute_kali_command. "
    "MCPs reais desta sessão: Kali Linux (WSL), Terminal Local e Filesystem. "
    "Não invente servidores. "
    "Você POSSUI acesso à internet através da ferramenta web_search. "
    "Quando não souber informações atualizadas, bibliotecas ou ferramentas do Kali, consulte a internet antes de responder. "
    "Você possui memória do histórico desta sessão. "
    "Se o operador perguntar sobre o que foi dito na conversa (qual foi a primeira pergunta, o que eu falei antes), "
    "consulte o histórico da conversa no contexto. "
    "NUNCA use a ferramenta web_search para pesquisar sobre a própria conversa. "
    "REGRA ABSOLUTA DE CONTROLE DE FERRAMENTAS: "
    "Perguntas explicativas, comparativas ou teóricas "
    "(ex: o que uma ferramenta faz, somente isso é possível, quais opções existem, bom dia, qual comando faz X): "
    "responda exclusivamente com texto explicativo. "
    "Nunca execute execute_powershell_command ou execute_kali_command para responder teoria, e nunca rode contra alvos fictícios (ex: target.com). "
    "Só execute essas duas ferramentas quando o operador der uma ordem imperativa explícita e o alvo real já estiver na frase dele. "
    "O roteamento PowerShell versus Kali só vale depois dessa ordem. "
    "NUNCA envie comandos contendo placeholders com < ou > (ex: <ip_address>, <target>). "
    "Se faltar o IP ou o parâmetro, pergunte o alvo em texto e não execute o comando incompleto. "
    "Seja um parceiro técnico direto. Na teoria, explique o propósito em poucas frases, sem montar a linha de comando e sem executá-la. "
    + _PACING_RULES + " "
    "FORMATO: primeiro <think> com o raciocínio (breve no Sprint, decomposto no Deep), explicando o que a "
    "pergunta pede e como você chegou no resultado. Feche </think>. Depois escreva somente a resposta final, "
    "sem repetir o raciocínio."
)

_TEXTUAL_TOOLS = (
    "Este endpoint não aceita o parâmetro tools. "
    "Quando precisar rodar um comando, responda estritamente no formato: "
    "```tool:execute_powershell_command <comando>``` ou ```tool:execute_kali_command <comando>``` "
    "ou ```tool:web_search <consulta>```. "
    "Um bloco só, sem texto antes."
)

def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


_KALI = _tool(
    "execute_kali_command",
    "Executa comandos bash no Kali Linux WSL. Use para tarefas Linux e ferramentas de rede. Não use para hardware do Windows.",
    {"command": {"type": "string"}},
    ["command"],
)
_POWERSHELL = _tool(
    "execute_powershell_command",
    "Executa no PowerShell do host Windows. Obrigatório para GPU, RAM, CPU, arquivos locais e o shell atual.",
    {"command": {"type": "string"}},
    ["command"],
)
_READ = _tool(
    "read_file",
    "Lê um arquivo do workspace da sessão.",
    {"path": {"type": "string"}},
    ["path"],
)
_WRITE = _tool(
    "write_file",
    "Grava um arquivo no workspace da sessão.",
    {"path": {"type": "string"}, "content": {"type": "string"}},
    ["path", "content"],
)
_WEB = _tool(
    "web_search",
    "Pesquisa na internet por documentação, bibliotecas e informações atualizadas de ferramentas.",
    {"query": {"type": "string"}},
    ["query"],
)
_LOCAL_TOOLS = [_KALI, _POWERSHELL, _READ, _WRITE, _WEB]
_SHELL_TOOLS = {"execute_kali_command", "execute_powershell_command"}
_LOCAL_NAMES = {item["function"]["name"] for item in _LOCAL_TOOLS}

_require_token = late("_require_token")

router = APIRouter()
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"


def _post_chat(url: str, key: str, payload: dict) -> dict:
    headers = {"Content-Type": "application/json", "User-Agent": _UA, "Cache-Control": "no-store"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urlrequest.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urlrequest.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    choices = body.get("choices") or []
    return (choices[0].get("message") or {}) if choices else {}


class _ThinkStream:
    """Split a live completion into the thought, emitted as it arrives, and the answer after it."""

    def __init__(self, inside: bool, emit) -> None:
        self.inside = inside
        self.emit = emit
        self.hold = ""
        self.thought: list[str] = []
        self.answer: list[str] = []

    def feed(self, piece: str) -> None:
        if not piece:
            return
        self.hold += piece
        while self.hold:
            if self.inside:
                end = self.hold.find("</think>")
                if end < 0:
                    keep = 0
                    for size in range(1, 9):
                        if self.hold.endswith("</think>"[:size]):
                            keep = size
                    if keep >= len(self.hold):
                        return
                    self._thought(self.hold[:-keep] if keep else self.hold)
                    self.hold = self.hold[-keep:] if keep else ""
                    return
                self._thought(self.hold[:end])
                self.hold = self.hold[end + 8:]
                self.inside = False
                continue
            start = self.hold.find("<think>")
            if start < 0:
                if any(self.hold.endswith("<think>"[:i]) for i in range(1, 8)):
                    return
                self._answer(self.hold)
                self.hold = ""
                return
            self._answer(self.hold[:start])
            self.hold = self.hold[start + 7:]
            self.inside = True

    def finish(self) -> None:
        if self.inside:
            self._thought(self.hold)
        else:
            self._answer(self.hold)
        self.hold = ""

    def _thought(self, text: str) -> None:
        text = text.replace("<think>", "")
        if not text:
            return
        self.thought.append(text)
        if self.emit:
            self.emit({"t": "think", "d": text})

    def _answer(self, text: str) -> None:
        if text:
            self.answer.append(text)


def _complete(url: str, key: str, payload: dict, emit=None) -> dict:
    """Stream the completion. Thought tokens are emitted before the answer exists."""
    messages = list(payload.get("messages") or [])
    prefilled = not payload.get("tools") and (not messages or messages[-1].get("role") != "assistant")
    if prefilled:
        messages = [*messages, {"role": "assistant", "content": "<think>\n"}]
    outgoing = {**payload, "messages": messages, "stream": True}
    headers = {"Content-Type": "application/json", "User-Agent": _UA, "Cache-Control": "no-store"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urlrequest.Request(url, data=json.dumps(outgoing).encode("utf-8"), headers=headers, method="POST")
    splitter = _ThinkStream(prefilled, emit)
    content: list[str] = []
    tool_calls: dict[int, dict] = {}
    with urlrequest.urlopen(req, timeout=120) as resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8", "replace").strip()
            if not line or line.startswith(":"):
                continue
            if line.startswith("data:"):
                line = line[5:].strip()
            if line == "[DONE]":
                break
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            delta = ((data.get("choices") or [{}])[0].get("delta") or {})
            piece = str(delta.get("content") or "")
            if piece:
                content.append(piece)
                splitter.feed(piece)
            for call in delta.get("tool_calls") or []:
                index = int(call.get("index") or 0)
                slot = tool_calls.setdefault(
                    index,
                    {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
                )
                if call.get("id"):
                    slot["id"] = call["id"]
                function = call.get("function") or {}
                if function.get("name"):
                    slot["function"]["name"] += function["name"]
                if function.get("arguments"):
                    slot["function"]["arguments"] += function["arguments"]
    splitter.finish()
    full = "".join(content)
    if prefilled:
        full = "<think>\n" + full
    message: dict = {"role": "assistant", "content": full}
    if tool_calls:
        message["tool_calls"] = [tool_calls[index] for index in sorted(tool_calls)]
    return message


def _plain(message: dict) -> str:
    raw = message.get("content")
    if isinstance(raw, dict):
        raw = raw.get("content") or raw.get("response") or ""
    text = str(raw or "").strip()
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            picked = ""
            for key in ("response", "content"):
                if isinstance(data.get(key), str) and data[key].strip():
                    picked = data[key].strip()
                    break
            nested = data.get("message")
            if not picked and isinstance(nested, dict) and isinstance(nested.get("content"), str):
                picked = nested["content"].strip()
            text = picked
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"<think>[\s\S]*$", "", text).strip()
    return text.replace("**", "").replace("__", "").strip()


def _echoes_prompt(answer: str, prompt: str) -> bool:
    said = " ".join(answer.casefold().split())
    asked = " ".join(prompt.casefold().split())
    if not said:
        return True
    if said == asked:
        return True
    return len(said) >= 8 and said in asked


def _tool_leaf(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("data", "value", "command", "query"):
            found = value.get(key)
            if isinstance(found, str) and found.strip() and found not in {"string", "object"}:
                return found
    return value


def _refuses_tools(detail: str) -> bool:
    low = detail.casefold()
    return "does not support tools" in low or ("tool" in low and "support" in low)


def _fence_calls(text: str) -> list[dict]:
    """Models without native tools emit ```tool:name command```."""
    found = []
    closed = re.compile(
        r"```tool:(execute_powershell_command|execute_kali_command|web_search)\s+([\s\S]+?)```",
        re.I,
    )
    for match in closed.finditer(text):
        command = match.group(2).strip().strip("`").strip()
        if not command:
            continue
        name = match.group(1)
        key = "query" if name == "web_search" else "command"
        found.append({
            "id": name,
            "function": {"name": name, "arguments": json.dumps({key: command}, ensure_ascii=False)},
        })
    if found:
        return found
    loose = re.search(
        r"```tool:(execute_powershell_command|execute_kali_command|web_search)\s+([^\n`]+)",
        text,
        re.I,
    )
    if not loose:
        return []
    name = loose.group(1)
    command = loose.group(2).strip()
    key = "query" if name == "web_search" else "command"
    return [{
        "id": name,
        "function": {"name": name, "arguments": json.dumps({key: command}, ensure_ascii=False)},
    }]


def _text_calls(content: str) -> list[dict]:
    """Small local models often print the tool call as JSON instead of tool_calls."""
    text = content.strip()
    fenced = _fence_calls(text)
    if fenced:
        return fenced
    if not text.startswith("{") and not any(name in text for name in _LOCAL_NAMES) and "mcp__" not in text:
        return []
    spoken = re.search(
        r"(execute_kali_command|execute_powershell_command|read_file|web_search)\s*\(\s*['\"](.+?)['\"]\s*\)",
        text,
    )
    if spoken:
        name, value = spoken.group(1), spoken.group(2)
        key = "query" if name == "web_search" else ("path" if name == "read_file" else "command")
        return [{"id": name, "function": {"name": name, "arguments": json.dumps({key: value}, ensure_ascii=False)}}]
    fenced = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        data = json.loads(fenced)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", fenced, flags=re.S)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(data, dict):
        return []
    name = str(data.get("name") or "")
    if name not in _LOCAL_NAMES and name != "search_mcp_rag" and not name.startswith("mcp__"):
        return []
    args = data.get("arguments") if data.get("arguments") is not None else data.get("args") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            args = {"command": args} if name == "execute_kali_command" else {"query": args}
    if not isinstance(args, dict):
        return []
    clean = {}
    for key, value in args.items():
        clean[key] = _tool_leaf(value)
    return [{"id": name, "function": {"name": name, "arguments": json.dumps(clean, ensure_ascii=False)}}]


def _reasoning(message: dict) -> str:
    for key in ("reasoning", "reasoning_content"):
        found = str(message.get(key) or "").strip()
        if found:
            return found
    content = str(message.get("content") or "")
    tagged = re.search(r"<think>(.*?)</think>", content, flags=re.S)
    if tagged:
        return tagged.group(1).strip()
    if message.get("tool_calls") and content.strip():
        return content.strip()
    return ""


def _venice() -> dict | None:
    import os
    from pathlib import Path

    key = os.environ.get("VENICE_API_KEY", "")
    base = os.environ.get("VENICE_BASE_URL", "https://api.venice.ai/api/v1")
    model = os.environ.get("VENICE_MODEL", "abliteration-abliterated-model-large-flash")
    env_file = Path(os.environ.get("HERMES_HOME", r"C:\Users\Alexssander\Tools\nex-re\hermes\home")) / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("VENICE_API_KEY=") and not key:
                key = line.split("=", 1)[1].strip()
            elif line.startswith("VENICE_BASE_URL=") and line.split("=", 1)[1].strip():
                base = line.split("=", 1)[1].strip()
    if not key:
        return None
    root = base.rstrip("/")
    url = root if root.endswith("/chat/completions") else f"{root}/chat/completions"
    return {"url": url, "key": key, "model": model}


def _active_model() -> tuple[str, str, str]:
    from hermes_cli.config import load_config

    cfg = load_config() or {}
    model_cfg = cfg.get("model") or {}
    provider = str(model_cfg.get("provider") or "groq")
    model = str(model_cfg.get("default") or "")
    if provider == "ollama-local":
        base = str(model_cfg.get("base_url") or "http://127.0.0.1:11434/v1").rstrip("/")
        return model, base, ""
    runtime = resolve_runtime_provider(requested=provider, target_model=model or None)
    base = str(runtime.get("base_url") or model_cfg.get("base_url") or "").rstrip("/")
    key = str(runtime.get("api_key") or "")
    if not model:
        model = str(runtime.get("model") or "")
    return model, base, key


def _mounted_mcp() -> list[str]:
    try:
        from hermes_cli.mcp_startup import wait_for_mcp_discovery
        wait_for_mcp_discovery(single_query=True)
        from tools.registry import registry
        return [name for name in registry.get_all_tool_names() if name.startswith("mcp__")]
    except Exception:
        return []


def _chunk_tools(query: str, names: list[str], limit: int = 6) -> list[dict]:
    words = {word.lower() for word in re.findall(r"[A-Za-z0-9_]{3,}", query)}
    ranked = sorted(names, key=lambda name: sum(word in name.lower() for word in words), reverse=True)
    chosen = [name for name in ranked if any(word in name.lower() for word in words)][:limit]
    picked = chosen or ranked[:limit]
    if not picked:
        return []
    try:
        from tools.registry import registry
        return registry.get_definitions(set(picked), quiet=True)
    except Exception:
        return []


def _shape_call(call: dict, index: int) -> tuple[dict, str, dict]:
    fn = call.get("function") or {}
    name = str(fn.get("name") or "")
    raw = fn.get("arguments") if fn.get("arguments") is not None else "{}"
    if isinstance(raw, dict):
        args = raw
        raw = json.dumps(raw, ensure_ascii=False)
    else:
        try:
            args = json.loads(raw or "{}")
        except json.JSONDecodeError:
            args = {}
            raw = "{}"
    if not isinstance(args, dict):
        args = {}
        raw = "{}"
    call_id = str(call.get("id") or f"call_{name}_{index}")
    shaped = {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": raw},
    }
    return shaped, name, args


def _command_line(name: str, args: dict) -> str:
    if name in {"execute_kali_command", "execute_powershell_command"}:
        return str(args.get("command") or "")
    if name == "search_mcp_rag":
        return str(args.get("query") or "")
    for key in ("command", "query", "path", "name", "pattern"):
        if args.get(key):
            return f"{key}={args[key]}"
    return ""


def _run_tool(name: str, args: dict, sid: str, text: str, cwd: str = "") -> tuple[str, int]:
    if name in _SHELL_TOOLS:
        command = str(args.get("command") or "")
        missing = _shell_brake(text, command)
        if missing:
            return missing, 0
    if name == "execute_kali_command":
        return execute_kali_command(str(args.get("command") or ""))
    if name == "execute_powershell_command":
        return execute_powershell_command(str(args.get("command") or ""), sid, cwd)
    if name == "web_search":
        if _about_session(text):
            return "Isso está no histórico desta sessão. Não pesquisei na web.", 0
        return web_search(str(args.get("query") or ""))
    if name == "read_file":
        return read_file(str(args.get("path") or ""), sid, cwd), 0
    if name == "write_file":
        return write_file(str(args.get("path") or ""), str(args.get("content") or ""), sid, cwd), 0
    if name == "search_mcp_rag":
        names = _mounted_mcp()
        query = str(args.get("query") or text)
        listing = "\n".join(_chunk_tools(query, names) and [item["function"]["name"] for item in _chunk_tools(query, names)] or names[:12])
        found = search_mcp_rag(query, sid)
        return f"{found}\n\nFerramentas montadas:\n{listing or 'nenhum MCP montado'}", 0
    if name.startswith("mcp__"):
        try:
            from tools.registry import registry
            result = registry.dispatch(name, args)
        except Exception as exc:
            return f"falha ao chamar {name}: {exc}", 1
        raw = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        if len(raw) > 4000:
            raw = raw[:4000] + "\n…[resultado cortado]"
        return raw, 0
    return "ferramenta não registrada", 1


def _rea_on() -> bool:
    try:
        from hermes_cli.config import load_config
        rea = ((load_config() or {}).get("mcp_servers") or {}).get("rea") or {}
        return bool(rea.get("enabled"))
    except Exception:
        return False


def _catalog() -> str:
    lines = [
        "Kali Linux (WSL) — execute_kali_command",
        "Terminal Local — execute_powershell_command",
        "Filesystem — read_file, write_file",
        "Web — web_search",
    ]
    if _rea_on():
        lines.append("Ghidra/REA — ativo")
    return "\n".join(lines)


def _asks_catalog(text: str) -> bool:
    low = text.casefold()
    return "mcp" in low and any(word in low for word in ("quais", "lista", "liste", "acesso", "dispon"))


_CONCEPT = re.compile(
    r"qual\s+comando|que\s+comando|qual\s+ferramenta|que\s+ferramenta|melhor\s+para|"
    r"como\s+funciona|o\s+que\s+[eé]|o\s+que\s+o\b|sintaxe|me\s+explica|explica|d[uú]vida|recomend|"
    r"para\s+que\s+serve|quais\s+op|somente\s+isso|é\s+poss[ií]vel|e\s+poss[ií]vel",
    re.I,
)
_GREETING = re.compile(r"^(?:bom dia|boa tarde|boa noite|oi|ol[aá]|e a[ií]|tudo bem|hey|hello)\b", re.I)
_ORDER = re.compile(
    r"\b(?:execute|executa|executar|rode|rodar|roda|escaneie|escaneia|escanear|"
    r"crie|cria|criar|grave|grava|escreva|escreve|pesquise|pesquisa|busque|busca)\b",
    re.I,
)
_PLACEHOLDER = re.compile(r"<[^>\r\n]*>")
_FICTIONAL = re.compile(r"\b(?:target|example|exemplo|seusite|foo|bar)\.(?:com|org|net)\b", re.I)
_NET_TOOL = re.compile(r"\b(?:nmap|ffuf|gobuster|hydra|sqlmap|nikto|masscan|nuclei|ping|curl)\b", re.I)
_ABOUT_CHAT = re.compile(
    r"primeira pergunta|o que eu falei|falei antes|disse antes|eu (disse|perguntei)|"
    r"você (disse|respondeu)|na conversa|hist[oó]rico da (conversa|sess[aã]o)|o que (foi dito|falamos)",
    re.I,
)
_REAL_HOST = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[a-z0-9-]+\.)+[a-z]{2,}", re.I)


def _consulta(text: str) -> bool:
    """Theory, comparison and greetings stay text unless the operator gave an imperative order."""
    raw = " ".join((text or "").split())
    if _ORDER.search(raw) and not _CONCEPT.search(raw):
        return False
    return True


def _shell_brake(user_text: str, command: str) -> str:
    """Refuse shell execution on theory, placeholders, fictional hosts, or a network tool with no real target."""
    if _consulta(user_text) or not _ORDER.search(user_text or ""):
        return "Pergunta teórica. Não executei comando nenhum."
    if _PLACEHOLDER.search(command or "") or _FICTIONAL.search(command or "") or _FICTIONAL.search(user_text or ""):
        return "Falta um alvo real. Não executei o comando incompleto nem contra um alvo fictício."
    if _NET_TOOL.search(command or "") and not (_REAL_HOST.search(user_text or "") and _REAL_HOST.search(command or "")):
        return "Falta o IP ou o host. Diga o endereço antes de eu executar."
    return ""


def _incomplete_command(command: str) -> str:
    return _shell_brake("execute " + (command or ""), command) if (_PLACEHOLDER.search(command or "") or _FICTIONAL.search(command or "")) else ""


def _about_session(text: str) -> bool:
    return bool(_ABOUT_CHAT.search(" ".join((text or "").split())))


def _session_messages(sid: str, current: str, limit: int = 10) -> list[dict]:
    """Last 6–10 conversation turns. Skips tool notes so pronouns resolve from what was said."""
    rows = []
    skip_tool = False
    for row in desk(sid):
        role = str(row.get("role") or "")
        content = " ".join(str(row.get("text") or "").split())
        if skip_tool:
            skip_tool = False
            continue
        if role == "user" and content == "ferramenta":
            skip_tool = True
            continue
        if role not in {"user", "assistant"} or not content:
            continue
        rows.append({"role": role, "content": content[:1200]})
    if rows and rows[-1]["role"] == "user" and rows[-1]["content"] == " ".join(current.split()):
        rows.pop()
    if len(rows) > limit:
        rows = rows[-limit:]
    if rows and rows[0]["role"] != "user":
        rows = rows[1:]
    return rows


def _explicit_kali(text: str) -> str:
    match = re.search(r"(?:execute|executa|roda|rodar)\s+(.+?)\s+no\s+kali\b", text, re.I)
    return match.group(1).strip().strip("'\"") if match else ""


def _accepted_calls(text: str, message: dict) -> list:
    calls = message.get("tool_calls") or _text_calls(str(message.get("content") or ""))
    if _about_session(text):
        return []
    if not _consulta(text):
        return calls
    kept = []
    for call in calls:
        name = str((call.get("function") or {}).get("name") or "")
        if name == "web_search":
            kept.append(call)
    return kept


def _tab_screen(screen: str) -> str:
    """Drop earlier nex prompts so a new question is not answered as the old one."""
    kept = []
    for line in screen.splitlines():
        if re.search(r"(^|>\s*)nex\s+\S", line.strip(), re.I):
            continue
        kept.append(line)
    return "\n".join(kept[-40:])


def _active_tab_context(shell: str, cwd: str) -> str:
    """Tell the model which tab is answering, so a PowerShell tab is never described as Kali."""
    cwd_label = cwd or "desconhecido"
    if shell == "POWERSHELL_WINDOWS":
        return (
            "[AMBIENTE DA ABA ATUAL]: Você está no Windows PowerShell. "
            f"Diretório atual: {cwd_label}. "
            "Para checar arquivos e pastas locais, use execute_powershell_command com 'dir' ou 'Get-ChildItem'. "
            "É PROIBIDO dizer que está no Kali Linux."
        )
    if shell == "KALI_LINUX_WSL":
        return (
            "[AMBIENTE DA ABA ATUAL]: Você está no terminal Kali Linux (WSL). "
            "Use execute_kali_command para comandos bash/Linux."
        )
    if cwd:
        return f"[AMBIENTE DA ABA ATUAL]: Diretório atual: {cwd}."
    return ""


_SEARCH_INTENT = re.compile(
    r"web_search|preciso pesquisar|pesquisar na internet|buscar na (?:web|internet)|consultar a internet|"
    r"vou (?:usar|chamar) (?:a ferramenta )?web_search",
    re.I,
)


def _ground_search(text: str, message: dict, calls: list) -> list:
    """If the model says it will search and never calls the tool, run web_search on the question."""
    if _about_session(text):
        return calls
    if any(str((call.get("function") or {}).get("name") or "") == "web_search" for call in calls):
        return calls
    blob = _reasoning(message) + "\n" + str(message.get("content") or "")
    if not _SEARCH_INTENT.search(blob):
        return calls
    query = " ".join(text.split())[:240]
    if not query:
        return calls
    return [{
        "id": "web_search",
        "function": {"name": "web_search", "arguments": json.dumps({"query": query}, ensure_ascii=False)},
    }, *calls]


def ask_model(
    text: str, screen: str = "", prior: str = "", sid: str = "", emit=None,
    shell: str = "", cwd: str = "",
) -> tuple[str, str, str]:
    del prior
    model, base, key = _active_model()
    if not base or not model:
        raise RuntimeError("modelo ativo sem endpoint")
    url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
    if sid:
        note_activity(sid, "run", "agente", text[:140])
    history = _session_messages(sid, text) if sid else []
    system_content = _PERSONA
    env_context = _active_tab_context(shell, cwd)
    if env_context:
        system_content += " " + env_context
    messages = [
        {"role": "system", "content": system_content + " Responda somente a mensagem user deste turno. Use o histórico acima para pronomes. Não repita a pergunta."},
        *history,
        {"role": "user", "content": text},
    ]
    mounted = _mounted_mcp()
    consulta = _consulta(text)
    about = _about_session(text)
    payload_obj = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    }
    if about:
        messages[0]["content"] += " A pergunta é sobre esta conversa. Responda pelo histórico. Não chame web_search."
        payload_obj.pop("tools", None)
        payload_obj.pop("tool_choice", None)
    elif consulta:
        messages[0]["content"] += (
            " Responda em texto. Não chame execute_kali_command nem execute_powershell_command."
            " Se precisar confirmar um fato, uma pessoa ou um dado externo, chame web_search."
        )
        payload_obj["tools"] = [_WEB]
        payload_obj["tool_choice"] = "auto"
    else:
        payload_obj["tools"] = [*_LOCAL_TOOLS, *_chunk_tools(text, mounted)]
        payload_obj["tool_choice"] = "auto"
    groq = "groq" in base.lower() or "groq" in model.lower()
    if groq:
        payload_obj["max_tokens"] = 800

    def once(target: str, token: str, payload: dict) -> dict:
        return _complete(target, token, payload, emit)

    textual = False

    def use_textual_catalog() -> None:
        nonlocal textual
        textual = True
        payload_obj.pop("tools", None)
        payload_obj.pop("tool_choice", None)
        system = str(messages[0].get("content") or "")
        extra = (
            "Responda pelo histórico da sessão. Não chame web_search."
            if about
            else "Se precisar de documentação atual, responda estritamente ```tool:web_search consulta```. Não execute comandos."
            if consulta
            else _TEXTUAL_TOOLS
        )
        if extra not in system:
            messages[0]["content"] = system + " " + extra

    try:
        message = once(url, key, payload_obj)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        if exc.code == 400 and _refuses_tools(detail):
            use_textual_catalog()
            message = once(url, key, payload_obj)
        elif exc.code == 400:
            payload_obj.pop("tools", None)
            payload_obj.pop("tool_choice", None)
            message = once(url, key, payload_obj)
        elif exc.code in (429, 403):
            venice = _venice()
            if venice:
                payload_obj = {**payload_obj, "model": venice["model"], "max_tokens": 800}
                try:
                    message = once(venice["url"], venice["key"], payload_obj)
                    url, key = venice["url"], venice["key"]
                except HTTPError as ven_exc:
                    ven_detail = ven_exc.read().decode("utf-8", errors="replace")[:300]
                    raise RuntimeError(f"modelo indisponível ({ven_exc.code}): {ven_detail}") from ven_exc
            else:
                raise RuntimeError(f"modelo indisponível ({exc.code}): {detail}") from exc
        else:
            raise RuntimeError(f"modelo indisponível ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"modelo indisponível: {exc.reason}") from exc

    calls = _ground_search(text, message, _accepted_calls(text, message))
    notes: list[str] = []
    if sid:
        thought = _reasoning(message)
        if not thought and calls:
            planned = []
            for call in calls[:3]:
                _shaped, name, args = _shape_call(call, 0)
                planned.append(f"{name} {_command_line(name, args)}".strip())
            thought = "Vou executar: " + " | ".join(item for item in planned if item)
        if thought:
            note_activity(sid, "think", "raciocínio", thought)
    seen: set[str] = set()
    for _round in range(3):
        if not calls:
            break
        shaped_calls = []
        tool_messages = []
        repeat = False
        for index, call in enumerate(calls[:3]):
            shaped, name, args = _shape_call(call, index)
            detail = _command_line(name, args)
            signature = f"{name} {detail}"
            if signature in seen:
                repeat = True
                break
            seen.add(signature)
            refused = name in _SHELL_TOOLS and bool(_shell_brake(text, detail))
            if sid and not refused:
                note_activity(sid, "run", name, detail)
            try:
                result, code = _run_tool(name, args, sid, text, cwd)
            except Exception as exc:
                if sid:
                    note_activity(sid, "error", name, str(exc))
                raise
            if sid and not refused:
                note_activity(sid, "done", name, f"codigo {code}")
            notes.append(f"{name}: {result[:400]}")
            shaped_calls.append(shaped)
            tool_messages.append({
                "role": "tool",
                "tool_call_id": shaped["id"],
                "name": name,
                "content": result or "",
            })
        if not shaped_calls:
            break
        result_body = "\n\n".join(f"{item['name']}\n{item['content']}" for item in tool_messages)
        if textual:
            messages.append({"role": "assistant", "content": str(message.get("content") or "")})
            messages.append({
                "role": "user",
                "content": "Resultado da execução:\n" + result_body + "\nFormule a resposta final em linguagem natural.",
            })
        else:
            messages.append({"role": "assistant", "content": None, "tool_calls": shaped_calls})
            messages.extend(tool_messages)
        if repeat:
            break
        follow = {
            "model": payload_obj["model"],
            "messages": messages,
            "temperature": 0.2,
        }
        if not textual and not about:
            follow["tools"] = [_WEB] if consulta else [*_LOCAL_TOOLS, *_chunk_tools(text, mounted)]
            follow["tool_choice"] = "auto"
        if groq or "venice" in url:
            follow["max_tokens"] = 800
        try:
            message = once(url, key, follow)
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            if exc.code == 400 and _refuses_tools(detail):
                while messages and (
                    messages[-1].get("role") == "tool"
                    or (messages[-1].get("role") == "assistant" and messages[-1].get("tool_calls"))
                ):
                    messages.pop()
                use_textual_catalog()
                messages.append({"role": "assistant", "content": str(message.get("content") or "")})
                messages.append({
                    "role": "user",
                    "content": "Resultado da execução:\n" + result_body + "\nFormule a resposta final em linguagem natural.",
                })
                follow.pop("tools", None)
                follow.pop("tool_choice", None)
                follow["messages"] = messages
                message = once(url, key, follow)
            elif exc.code != 400:
                raise RuntimeError(f"modelo indisponível ({exc.code}): {detail}") from exc
            else:
                for item in messages:
                    if item.get("role") == "assistant" and item.get("tool_calls") and item.get("content") is None:
                        item["content"] = ""
                try:
                    message = once(url, key, follow)
                except HTTPError as again:
                    detail = again.read().decode("utf-8", errors="replace")[:300]
                    raise RuntimeError(f"modelo indisponível ({again.code}): {detail}") from again
        calls = _ground_search(text, message, _accepted_calls(text, message))
        thought = _reasoning(message)
        if sid and thought:
            note_activity(sid, "think", "raciocínio", thought)
    if sid:
        note_activity(sid, "done", "agente", "resposta pronta")
    answer = _plain(message)
    thought = _reasoning(message)
    if not thought:
        marked = re.search(
            r"(?:PENSAMENTO|RACIOC[IÍ]NIO)\s*:\s*(.*?)\s*RESPOSTA\s*:\s*(.*)",
            str(message.get("content") or ""),
            flags=re.S | re.I,
        )
        if marked:
            thought = marked.group(1).strip()
            answer = marked.group(2).strip()
    if notes and (not answer or _text_calls(answer)):
        answer = notes[-1].split(": ", 1)[-1]
    elif _echoes_prompt(answer, text) and not notes:
        retry = {
            "model": payload_obj["model"],
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Primeiro <think> com o raciocínio. Feche </think>. "
                        + _PACING_RULES + " Não repita a pergunta."
                    ),
                },
                {"role": "user", "content": text},
            ],
            "temperature": 0.4,
        }
        if groq:
            retry["max_tokens"] = 800
        try:
            message = once(url, key, retry)
            answer = _plain(message)
            thought = _reasoning(message) or thought
        except (HTTPError, URLError):
            answer = ""
    if _echoes_prompt(answer, text):
        answer = notes[-1].split(": ", 1)[-1] if notes else "O modelo não respondeu. A pergunta não foi repetida."
    elif notes and _text_calls(answer):
        answer = notes[-1].split(": ", 1)[-1]
    if not answer and thought:
        pieces = re.split(r"(?<=[.!?])\s+", thought, maxsplit=1)
        if len(pieces) == 2:
            thought, answer = pieces
        else:
            answer = thought
            thought = ""
    thought = " ".join(thought.split())[:500]
    return answer, "\n".join(notes), thought


@router.post("/api/chat")
async def nex_chat(request: Request) -> JSONResponse:
    _require_token(request)
    raw = await request.body()
    try:
        data = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        data = {}
    text = " ".join(str(data.get("prompt") or "").split())
    if not text:
        text = str(data.get("message") or data.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "mensagem vazia"}, status_code=400)
    sid = str(data.get("session_id") or "").strip()
    tab = str(data.get("tab_uuid") or data.get("tab_id") or "").strip()
    # Identidade da aba ativa (requisito 1): o cliente (nex_cli.py) detecta o
    # proprio ambiente (Windows nativo vs Kali/WSL) e manda junto do prompt.
    shell = str(data.get("shell") or "").strip()
    cwd = str(data.get("cwd") or "").strip()
    screen = screen_text(tab, session_id=sid) if tab else ""
    if _asks_catalog(text):
        answer = _catalog()
        if sid:
            remember(sid, text, answer, screen)
        return JSONResponse({
            "response": answer,
            "reasoning": "A pergunta pede a lista de ferramentas desta sessão. Respondo com o catálogo, sem executar comando.",
            "session_id": sid,
        })
    forced = _explicit_kali(text)
    if forced:
        missing = _shell_brake(text, forced)
        if missing:
            if sid:
                remember(sid, text, missing, screen)
            return JSONResponse({
                "response": missing,
                "reasoning": "A ordem não tem alvo real ou é só uma pergunta. Não executo o comando e peço o que falta.",
                "session_id": sid,
            })
        if sid:
            note_activity(sid, "run", "execute_kali_command", forced)
        import asyncio
        answer, code = await asyncio.to_thread(execute_kali_command, forced)
        if sid:
            note_activity(sid, "done", "execute_kali_command", f"codigo {code}")
            remember(sid, text, answer, screen)
        return JSONResponse({
            "response": answer,
            "reasoning": "Ordem explícita no Kali. O comando rodou e o resultado está abaixo.",
            "session_id": sid,
        })
    try:
        import asyncio
        if data.get("stream"):
            loop = asyncio.get_running_loop()
            queue: asyncio.Queue = asyncio.Queue()

            def emit(event: dict) -> None:
                loop.call_soon_threadsafe(queue.put_nowait, event)

            def work() -> None:
                try:
                    answer, notes, _thought = ask_model(text, screen, "", sid, emit, shell, cwd)
                    if sid:
                        remember(sid, text, answer, read_screen_file(sid) or screen)
                        if notes:
                            remember(sid, "ferramenta", notes, "")
                    emit({"t": "answer", "d": answer})
                except Exception as exc:
                    if sid:
                        note_activity(sid, "error", "agente", str(exc))
                    emit({"t": "error", "d": str(exc)})
                finally:
                    loop.call_soon_threadsafe(queue.put_nowait, None)

            import threading
            threading.Thread(target=work, daemon=True).start()

            async def events():
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    yield (json.dumps(item, ensure_ascii=False) + "\n").encode("utf-8")

            return StreamingResponse(
                events(),
                media_type="application/x-ndjson",
                headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
            )
        answer, notes, thought = await asyncio.to_thread(ask_model, text, screen, "", sid, None, shell, cwd)
    except Exception as exc:
        if sid:
            note_activity(sid, "error", "agente", str(exc))
        return JSONResponse({"error": str(exc)}, status_code=502)
    if sid:
        remember(sid, text, answer, read_screen_file(sid) or screen)
        if notes:
            remember(sid, "ferramenta", notes, "")
    return JSONResponse({"response": answer, "reasoning": thought, "session_id": sid})


@router.post("/api/sessions/create")
async def nex_create_session(request: Request) -> JSONResponse:
    _require_token(request)
    return JSONResponse(create_session())


@router.get("/api/terminals/{tab_id}/buffer")
async def nex_tab_buffer(tab_id: str, request: Request) -> JSONResponse:
    _require_token(request)
    sid = str(request.query_params.get("session") or "")
    return JSONResponse({"tab_id": tab_id, "text": screen_text(tab_id, session_id=sid or None)})


@router.delete("/api/nex/tabs/{sid}/{tab_id}")
async def nex_drop_tab(sid: str, tab_id: str, request: Request) -> JSONResponse:
    _require_token(request)
    drop_tab(sid, tab_id)
    return JSONResponse({"ok": True})


@router.get("/api/nex/sessions")
async def nex_sessions(request: Request) -> JSONResponse:
    _require_token(request)
    return JSONResponse({"sessions": list_sessions()})


@router.patch("/api/nex/sessions/{sid}")
async def nex_rename(sid: str, request: Request) -> JSONResponse:
    _require_token(request)
    try:
        data = json.loads((await request.body()).decode("utf-8") or "{}")
    except json.JSONDecodeError:
        data = {}
    row = rename_session(sid, str(data.get("title") or ""))
    if row is None:
        return JSONResponse({"error": "sessão não encontrada"}, status_code=404)
    return JSONResponse(row)


@router.delete("/api/nex/sessions/{sid}")
async def nex_delete(sid: str, request: Request) -> JSONResponse:
    _require_token(request)
    if not delete_session(sid):
        return JSONResponse({"error": "sessão não encontrada"}, status_code=404)
    return JSONResponse({"ok": True, "id": sid})


@router.get("/api/nex/desk/{sid}")
async def nex_desk(sid: str, request: Request) -> JSONResponse:
    _require_token(request)
    return JSONResponse({"messages": desk(sid)})


_PRESETS = [
    {"id": "gemini", "label": "Google AI Studio", "tag": "GRATUITO DIÁRIO", "tone": "free", "detail": "Janela longa / multimodal", "provider": "gemini", "model": "gemini-2.5-flash", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/", "key_env": "GOOGLE_API_KEY"},
    {"id": "groq", "label": "Groq Cloud", "tag": "GRATUITO DIÁRIO", "tone": "free", "detail": "Ultrarrápido", "provider": "groq", "model": "llama-3.3-70b-versatile", "base_url": "https://api.groq.com/openai/v1", "key_env": "GROQ_API_KEY"},
    {"id": "cloudflare", "label": "Cloudflare AI", "tag": "GRATUITO DIÁRIO", "tone": "free", "detail": "Cota diária", "provider": "cloudflare", "model": "@cf/meta/llama-3.1-8b-instruct", "base_url": "", "key_env": "CLOUDFLARE_API_TOKEN"},
    {"id": "venice", "label": "Venice AI", "tag": "PAGO / SALDO ATIVO", "tone": "paid", "detail": "Saldo ativo", "provider": "venice", "model": "qwen-2.5-coder-32b", "base_url": "https://api.venice.ai/api/v1", "key_env": "VENICE_API_KEY"},
    {"id": "aion", "label": "Aion Labs", "tag": "PAGO / PENTEST", "tone": "paid", "detail": "Aion Pentest Uncensored", "provider": "aion", "model": "aion-labs/aion-3.0-mini", "base_url": "https://api.aionlabs.ai/v1", "key_env": "AION_API_KEY"},
]


def _preset_base(item: dict) -> str:
    if item["base_url"]:
        return item["base_url"]
    try:
        from hermes_cli.config import load_config
        providers = (load_config() or {}).get("providers") or {}
        return str((providers.get(item["provider"]) or {}).get("base_url") or "")
    except Exception:
        return ""


def _env_key(name: str) -> str:
    import os
    from pathlib import Path
    found = os.environ.get(name, "")
    env_file = Path(os.environ.get("HERMES_HOME", r"C:\Users\Alexssander\Tools\nex-re\hermes\home")) / ".env"
    if env_file.is_file() and not found:
        for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith(f"{name}="):
                found = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    return found


def _yaml_scalar(value: str) -> str:
    if any(char in value for char in ":@#{}[]&*!|>%'\" "):
        return '"' + value.replace('"', '\\"') + '"'
    return value


def _probe(item: dict) -> str:
    from urllib import request as urlrequest
    from urllib.error import HTTPError, URLError
    if not _env_key(item["key_env"]):
        return "red"
    base = _preset_base(item).rstrip("/")
    if not base:
        return "yellow"
    url = base if base.endswith("/models") else f"{base}/models"
    req = urlrequest.Request(url, headers={"User-Agent": _UA, "Authorization": f"Bearer {_env_key(item['key_env'])}"}, method="GET")
    try:
        with urlrequest.urlopen(req, timeout=4) as resp:
            return "green" if resp.status == 200 else "yellow"
    except HTTPError as exc:
        if exc.code == 429:
            return "red"
        if exc.code in (502, 503, 504):
            return "yellow"
        return "red"
    except (URLError, TimeoutError, OSError):
        return "yellow"


@router.get("/api/models/presets")
async def nex_model_presets(request: Request) -> JSONResponse:
    _require_token(request)
    current = {"provider": "", "model": ""}
    try:
        from hermes_cli.config import load_config
        model = (load_config() or {}).get("model") or {}
        current = {"provider": str(model.get("provider") or ""), "model": str(model.get("default") or "")}
    except Exception:
        pass
    public = [{key: item[key] for key in ("id", "label", "tag", "tone", "detail", "provider", "model")} for item in _PRESETS]
    return JSONResponse({"current": current, "presets": public})


@router.get("/api/models/status")
async def nex_model_status(request: Request) -> JSONResponse:
    _require_token(request)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        colors = list(pool.map(_probe, _PRESETS))
    return JSONResponse({"statuses": {item["id"]: color for item, color in zip(_PRESETS, colors)}})


@router.post("/api/models/select")
async def nex_model_select(request: Request) -> JSONResponse:
    _require_token(request)
    try:
        data = json.loads((await request.body()).decode("utf-8") or "{}")
    except json.JSONDecodeError:
        data = {}
    if str(data.get("id") or "") == "ollama":
        local_name = str(data.get("model") or "").strip()
        if not local_name or not _ollama_up():
            return JSONResponse({"error": "Ollama desligado"}, status_code=409)
        _set_ollama_enabled(True)
        chosen = {
            "provider": "ollama-local",
            "model": local_name,
            "base_url": "http://127.0.0.1:11434/v1",
            "key_env": "",
            "label": local_name,
        }
    else:
        chosen = next((item for item in _PRESETS if item["id"] == str(data.get("id") or "")), None)
    if chosen is None:
        return JSONResponse({"error": "modelo desconhecido"}, status_code=404)
    import os
    from pathlib import Path
    path = Path(os.environ.get("HERMES_HOME", r"C:\Users\Alexssander\Tools\nex-re\hermes\home")) / "config.yaml"
    text = path.read_text(encoding="utf-8")
    base = _preset_base(chosen)
    block = (
        "model:\n"
        f"  provider: {chosen['provider']}\n"
        f"  default: {_yaml_scalar(chosen['model'])}\n"
        "  reasoning: low\n"
        f"  base_url: {_yaml_scalar(base)}\n"
        "  api_mode: chat_completions\n"
        + (f"  key_env: {chosen['key_env']}\n" if chosen.get("key_env") else "")
    )
    updated, count = re.subn(r"(?m)^model:\n(?:[ \t].*\n)*", block, text, count=1)
    if count != 1:
        return JSONResponse({"error": "não achei o bloco model no config"}, status_code=500)
    path.write_text(updated, encoding="utf-8")
    return JSONResponse({"ok": True, "provider": chosen["provider"], "model": chosen["model"], "label": chosen["label"]})


_OLLAMA = "http://127.0.0.1:11434"
_ollama_proc = None


def _config_path():
    import os
    from pathlib import Path
    return Path(os.environ.get("HERMES_HOME", r"C:\Users\Alexssander\Tools\nex-re\hermes\home")) / "config.yaml"


def _set_ollama_enabled(flag: bool) -> None:
    path = _config_path()
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(
        r"(ollama-local:\n(?:[ \t]+#.*\n)*)([ \t]+)enabled: (?:true|false)",
        lambda match: match.group(1) + match.group(2) + "enabled: " + ("true" if flag else "false"),
        text,
        count=1,
    )
    if count == 1:
        path.write_text(updated, encoding="utf-8")


def _ollama_exe() -> str:
    import os
    import shutil
    from pathlib import Path
    found = shutil.which("ollama")
    if found:
        return found
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
    return str(local) if local.is_file() else ""


def _ollama_up() -> bool:
    from urllib import request as urlrequest
    from urllib.error import URLError
    try:
        with urlrequest.urlopen(urlrequest.Request(f"{_OLLAMA}/api/tags", method="GET"), timeout=1.5) as resp:
            return resp.status == 200
    except (URLError, TimeoutError, OSError):
        return False


def _ollama_names() -> list[str]:
    from urllib import request as urlrequest
    if not _ollama_up():
        return []
    with urlrequest.urlopen(urlrequest.Request(f"{_OLLAMA}/api/tags", method="GET"), timeout=3) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return [str(item.get("name") or "") for item in body.get("models") or [] if item.get("name")]


def _ollama_state() -> dict:
    running = _ollama_up()
    return {"running": running, "models": _ollama_names() if running else []}


def _ollama_start() -> dict:
    global _ollama_proc
    import subprocess
    import time
    if _ollama_up():
        _set_ollama_enabled(True)
        return {"running": True, "models": _ollama_names()}
    exe = _ollama_exe()
    if not exe:
        return {"running": False, "error": "ollama.exe não encontrado", "models": []}
    _ollama_proc = subprocess.Popen(
        [exe, "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=0x08000000,
    )
    for _ in range(24):
        if _ollama_up():
            _set_ollama_enabled(True)
            return {"running": True, "models": _ollama_names()}
        time.sleep(0.5)
    return {"running": False, "error": "Ollama não respondeu", "models": []}


def _ollama_stop() -> dict:
    global _ollama_proc
    import subprocess
    if _ollama_proc is not None and _ollama_proc.poll() is None:
        subprocess.run(["taskkill", "/PID", str(_ollama_proc.pid), "/T", "/F"], capture_output=True)
    _ollama_proc = None
    if _ollama_up():
        subprocess.run(["taskkill", "/IM", "ollama.exe", "/F"], capture_output=True)
    _set_ollama_enabled(False)
    return {"running": _ollama_up(), "models": []}


@router.get("/api/local/ollama")
async def nex_ollama_state(request: Request) -> JSONResponse:
    _require_token(request)
    import asyncio
    return JSONResponse(await asyncio.to_thread(_ollama_state))


@router.post("/api/local/ollama")
async def nex_ollama_power(request: Request) -> JSONResponse:
    _require_token(request)
    try:
        data = json.loads((await request.body()).decode("utf-8") or "{}")
    except json.JSONDecodeError:
        data = {}
    action = str(data.get("action") or "")
    import asyncio
    if action == "start":
        return JSONResponse(await asyncio.to_thread(_ollama_start))
    if action == "stop":
        return JSONResponse(await asyncio.to_thread(_ollama_stop))
    return JSONResponse({"error": "ação inválida"}, status_code=400)


@router.get("/api/nex/activity/{sid}")
async def nex_activity(sid: str, request: Request) -> JSONResponse:
    _require_token(request)
    return JSONResponse({"events": read_activity(sid)})


@router.get("/api/nex/screen/{sid}")
async def nex_screen(sid: str, request: Request) -> JSONResponse:
    _require_token(request)
    return JSONResponse({"text": read_screen_file(sid, limit=20000)})
