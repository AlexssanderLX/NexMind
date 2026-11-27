"""Nex V2, Fase 1: backend leve em FastAPI para testar modelos de cota diaria, um a um, com a interface React intacta.

Contrato igual ao do backend C# (o frontend nao muda): GET /api/status com a lista de modelos, conversas em /api/conversations e o chat em
POST /api/conversations/{id}/chat respondendo NDJSON ({"type": "thinking" | "token" | "done" | "error"}).
Sem Ghidra, sem MCP, sem ferramentas: so conversa e medicao (latencia, streaming, blocos de pensamento).

Rodar:  backend_v2\\venv\\Scripts\\python.exe backend_v2\\main.py        (porta 5080; NEX_HOST e NEX_PORT mudam)
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Callable

import httpx
from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
ENV_FILE = Path(os.environ.get("NEX_ENV_FILE") or HERE.parent / ".env")
DATA_FILE = Path(os.environ.get("NEX_DATA_FILE") or HERE / "data" / "conversations.json")
SKILLS_DIR = Path(os.environ.get("NEX_SKILLS_DIR") or HERE.parent / "skills")
HISTORY_MESSAGES = 24
MODES = ("general", "security", "dev")

# Pacote soberano: 6 skills de raciocinio em skills/*.md (assumption_audit,
# definition_of_done, self_correction_loop, dynamic_pacing, tool_hygiene,
# adaptive_persona) - fazem um modelo pequeno (3B/7B) raciocinar perto de um
# modelo maior, sem gastar contexto. Os .md sao a fonte editavel/documentada
# de cada regra; o dicionario abaixo e o DIGEST consolidado de cada um (a
# concatenacao crua dos 6 arquivos passa de ~650 tokens - estoura o teto).
# Editou um .md? Atualize a linha correspondente aqui para refletir.
_SOVEREIGN_SKILL_DIGEST = {
    "assumption_audit.md": (
        "AUDITORIA DE PREMISSA: deduza o objetivo real antes de agir; nunca pergunte o obvio; "
        "se faltar alvo mandatorio ou a tarefa for ambigua/contraditoria, pare e peca o alvo/escopo certo."
    ),
    "definition_of_done.md": (
        "DEFINITION OF DONE: esforco nao e conclusao - so esta pronto quando o dado responde direto "
        "a duvida (sem placeholder) e o comando retorna codigo 0 com dado util. Resultado vazio nao "
        "autoriza \"nao encontrei\" sem 1 tentativa alternativa antes."
    ),
    "self_correction_loop.md": (
        "AUTOCORRECAO: erro de sintaxe, permissao negada ou resultado vazio nunca vai cru pro usuario - "
        "analise a causa em 1 linha, reformule e tente de novo (max. 2 retries internos) antes de "
        "reportar impedimento real."
    ),
    "dynamic_pacing.md": (
        "RITMO DINAMICO: pedido curto/direto (\"rapido\", \"so me diga\") = 1 turno, resposta direta, "
        "zero tokens extras. Pedido de auditoria/arquitetura/pesquisa profunda = decomponha em etapas, "
        "confira premissas e aponte contrapontos."
    ),
    "tool_hygiene.md": (
        "HIGIENE DE FERRAMENTAS: mundo real/fatos/noticias/pessoas -> so web_search, nunca shell local. "
        "Host/arquivos Windows -> PowerShell. Rede/pentest/CTF -> Kali. Nunca mande '<' ou '>' soltos "
        "pro shell."
    ),
    "adaptive_persona.md": (
        "PERSONA ADAPTATIVA: proativo e colaborativo por padrao; cirurgico, conciso e cetico em tarefa "
        "tecnica/AppSec. Se o operador propuser algo vulneravel ou ineficiente, aponte o contraponto "
        "tecnico e sugira o vetor melhor."
    ),
}
_SOVEREIGN_SKILLS_CHAR_BUDGET = 2000  # ~500 tokens a 4 chars/token


def _load_sovereign_skills() -> str:
    # Each skill only counts toward the prompt when its .md still exists under
    # skills/ - deleting a file there turns its rule off without touching code.
    lines = [
        f"{i}. {digest}"
        for i, name in enumerate(_SOVEREIGN_SKILL_DIGEST, start=1)
        if (SKILLS_DIR / name).is_file()
        for digest in (_SOVEREIGN_SKILL_DIGEST[name],)
    ]
    text = "[NEX CORE - REGRAS COGNITIVAS NUCLEARES]\n" + "\n".join(lines)
    if len(text) > _SOVEREIGN_SKILLS_CHAR_BUDGET:
        text = text[:_SOVEREIGN_SKILLS_CHAR_BUDGET].rsplit("\n", 1)[0]
    return text


SOVEREIGN_SKILLS = _load_sovereign_skills()

CANONICAL_SYSTEM_PROMPT = (
    "Você é o Nex Core v2.0, um assistente desktop autônomo nativo do Windows projetado para "
    "desenvolvimento, engenharia de software e cibersegurança/análise ofensiva. "
    "Você opera integrado a um subsistema de ferramentas e MCPs (Model Context Protocol). "
    "[Micro-Índice de Ferramentas Disponíveis]: "
    "- file_ops: read_file, write_file, search_files "
    "- terminal: execute_command (PowerShell/CMD local) "
    "- browser: browser_exec (automação web) "
    "- mcp_ghidra: rea_decompile, rea_analyze (análise de binários em standby) "
    "- memory: topic_read, topic_write (Micro-RAG da sessão) "
    "Quando o usuário perguntar sobre suas ferramentas ou MCPs, cite seu índice de capacidades com precisão. "
    "Responda sempre em português do Brasil de forma concisa e técnica.\n\n"
    + SOVEREIGN_SKILLS
)

NEX_TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": {"name": name, "description": desc, "parameters": {"type": "object", "properties": {}}}}
    for name, desc in (
        ("read_file", "Lê um arquivo local."),
        ("write_file", "Grava um arquivo local."),
        ("search_files", "Busca arquivos no workspace."),
        ("execute_command", "Executa PowerShell ou CMD local."),
        ("browser_exec", "Automação web."),
        ("rea_decompile", "Descompilação Ghidra, em standby."),
        ("rea_analyze", "Análise de binário Ghidra, em standby."),
        ("topic_read", "Lê um tópico do Micro-RAG da sessão."),
        ("topic_write", "Grava um tópico do Micro-RAG da sessão."),
    )
]

# Rotulo mostrado no dropdown -> prefixo das variaveis do .env. A ordem e a do dropdown.
PROVIDERS: list[dict[str, Any]] = [
    {"label": "Nvidia", "env": "NVIDIA", "models": ["nvidia/nemotron-3.5-bolt-e4b"],
     # o Nemotron so manda o raciocinio se o template pedir
     "extra": {"chat_template_kwargs": {"enable_thinking": True}}},
    # a camada gratuita da Groq limita a 1000 tokens de SAIDA por minuto neste modelo; sem max_tokens ela supoe 2048 e recusa (HTTP 429)
    {"label": "Groq", "env": "GROQ", "models": ["qwen/qwen3.8-27b"], "extra": {}, "params": {"max_tokens": min(800, int(os.environ.get("NEX_GROQ_MAX_TOKENS", "800")))}},
    # endpoint compativel com OpenAI do Google (GEMINI_BASE_URL termina em /openai)
    {"label": "Gemini", "env": "GEMINI", "models": ["gemini-3.5-flash-lite"], "model_var": "GEMINI_MODEL", "extra": {}},
    {"label": "Cloudflare", "env": "CLOUDFLARE", "models": ["@cf/meta/llama-3.1-8b-instruct-fast"], "extra": {}, "key_var": "CLOUDFLARE_API_TOKEN"},
    {"label": "Aion Labs", "env": "AION", "models": ["aion-labs/aion-3.0-mini"], "extra": {}},
    {"label": "Cerebras", "env": "CEREBRAS", "models": ["qwen-3.8-27b"], "extra": {}},
    {"label": "OpenRouter", "env": "OPENROUTER", "models": ["nvidia/nemotron-3.5-lightning:free"], "extra": {}},
]

_env_cache: dict[str, str] | None = None


def env() -> dict[str, str]:
    """Variaveis do .env (lidas uma vez). As chaves ficam so aqui: nunca vao para a resposta, para o log nem para o frontend."""
    global _env_cache
    if _env_cache is None:
        vals = {k: (v or "").strip() for k, v in dotenv_values(ENV_FILE).items()}
        for k, v in os.environ.items():  # variavel de ambiente real vence o arquivo
            if k.endswith(("_API_KEY", "_BASE_URL", "_API_TOKEN")):
                vals[k] = v
        _env_cache = vals
    return _env_cache


def provider_by_label(label: str) -> dict[str, Any] | None:
    low = label.strip().lower()
    return next((p for p in PROVIDERS if p["label"].lower() == low), None)


def provider_creds(p: dict[str, Any]) -> tuple[str, str]:
    e = env()
    return e.get(f"{p['env']}_BASE_URL", "").rstrip("/"), e.get(p.get("key_var") or f"{p['env']}_API_KEY", "")


def split_model(name: str) -> tuple[dict[str, Any], str] | None:
    """'Nvidia: nvidia/nemotron-3.5-bolt-e4b' -> (provedor Nvidia, 'nvidia/nemotron-3.5-bolt-e4b'). None se o provedor nao existe."""
    label, sep, model = (name or "").partition(":")
    if not sep:
        return None
    p = provider_by_label(label)
    model = model.strip()
    return (p, model) if p and model else None


def scrub(text: str) -> str:
    """Tira qualquer chave do texto antes de ele sair (mensagem de erro, log)."""
    for k, v in env().items():
        if v and len(v) >= 12 and k.endswith(("_API_KEY", "_API_TOKEN")):
            text = text.replace(v, "***")
    return text


# ---------- armazenamento (em memoria, salvo em JSON para sobreviver ao reinicio)

conversations: dict[str, dict[str, Any]] = {}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_conversations() -> None:
    conversations.clear()
    try:
        for c in json.loads(DATA_FILE.read_text(encoding="utf-8")):
            conversations[c["id"]] = c
    except (OSError, ValueError, KeyError):
        pass


def save_conversations() -> None:
    try:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = DATA_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(list(conversations.values()), ensure_ascii=False), encoding="utf-8")
        tmp.replace(DATA_FILE)
    except OSError:
        pass  # sem disco: a conversa vale so nesta sessao


def new_conversation(mode: str | None) -> dict[str, Any]:
    m = (mode or "").strip().lower()
    conv = {"id": uuid.uuid4().hex, "title": "Novo Teste", "titleEdited": False, "mode": m if m in MODES else "general",
            "model": None, "createdAt": now_iso(), "updatedAt": now_iso(), "messages": []}
    conversations[conv["id"]] = conv
    save_conversations()
    return conv


def public(conv: dict[str, Any]) -> dict[str, Any]:
    return {"id": conv["id"], "title": conv["title"], "model": conv.get("model"), "mode": conv.get("mode", "general"), "messages": conv["messages"]}


def get_conv(cid: str) -> dict[str, Any]:
    conv = conversations.get(cid)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversa nao encontrada.")
    return conv


# ---------- chamada aos provedores

def make_client() -> httpx.AsyncClient:
    """Um cliente por pedido. Os testes trocam esta funcao por um com transporte falso."""
    return httpx.AsyncClient(timeout=httpx.Timeout(connect=15, read=120, write=30, pool=15))


def build_payload(p: dict[str, Any], model: str, messages: list[dict[str, str]], with_extra: bool = True) -> dict[str, Any]:
    body: dict[str, Any] = {"model": model, "messages": messages, "stream": True, "tools": NEX_TOOLS}
    body.update(p.get("params") or {})  # parametros que o provedor exige sempre (ex.: teto de saida)
    if with_extra:
        body.update(p.get("extra") or {})
    return body


def friendly_http_error(p: dict[str, Any], status: int, body: str, retry_after: str | None) -> str:
    label = p["label"]
    body = scrub(body).strip().replace("\n", " ")[:240]
    if status == 429:
        wait = f" Tente de novo em {retry_after}s." if retry_after else ""
        return f"{label}: limite de requisicoes ou cota diaria esgotada (HTTP 429).{wait} {body}".strip()
    if status in (401, 403):
        return f"{label}: chave recusada ou sem permissao para este modelo (HTTP {status}). Confira a chave no .env. {body}".strip()
    if status == 404:
        return f"{label}: modelo ou endereco nao encontrado (HTTP 404). {body}".strip()
    if status == 402:
        return f"{label}: sem creditos (HTTP 402). {body}".strip()
    if status >= 500:
        return f"{label}: o provedor esta com problema (HTTP {status}). {body}".strip()
    return f"{label}: o provedor recusou o pedido (HTTP {status}). {body}".strip()


class ThinkSplitter:
    """Separa <think>...</think> dentro do texto que chega em pedacos (a tag pode vir cortada entre dois pedacos)."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self.in_think = False
        self.buf = ""

    def feed(self, text: str) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        self.buf += text
        while self.buf:
            tag = self.CLOSE if self.in_think else self.OPEN
            kind = "thinking" if self.in_think else "token"
            i = self.buf.find(tag)
            if i >= 0:
                if i:
                    out.append((kind, self.buf[:i]))
                self.buf = self.buf[i + len(tag):]
                self.in_think = not self.in_think
                continue
            keep = 0  # sufixo que pode ser o comeco da tag: espera o proximo pedaco
            for n in range(min(len(tag) - 1, len(self.buf)), 0, -1):
                if tag.startswith(self.buf[-n:]):
                    keep = n
                    break
            emit = self.buf[: len(self.buf) - keep]
            if emit:
                out.append((kind, emit))
            self.buf = self.buf[len(self.buf) - keep:]
            break
        return out

    def flush(self) -> list[tuple[str, str]]:
        rest, self.buf = self.buf, ""
        return [("thinking" if self.in_think else "token", rest)] if rest else []


def est_tokens(chars: int) -> int:
    return max(1, round(chars / 3.5)) if chars else 0


async def stream_chat(p: dict[str, Any], model: str, messages: list[dict[str, str]]) -> AsyncIterator[dict[str, Any]]:
    """Gera os eventos {type: thinking|token|done|error} de uma resposta em streaming de um provedor compativel com OpenAI."""
    base, key = provider_creds(p)
    if not base or not key:
        yield {"type": "error", "message": f"{p['label']}: falta {p['env']}_BASE_URL ou a chave no .env."}
        return
    url = base + "/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "text/event-stream"}
    t0 = time.perf_counter()
    first: float | None = None
    out_chars = 0
    usage: dict[str, Any] | None = None
    splitter = ThinkSplitter()
    got_reasoning_field = False
    try:
        async with make_client() as client:
            for attempt, with_extra in enumerate((True, False)):
                async with client.stream("POST", url, headers=headers, json=build_payload(p, model, messages, with_extra)) as resp:
                    if resp.status_code in (400, 422) and with_extra and p.get("extra"):
                        await resp.aread()
                        continue  # o provedor nao aceitou o parametro extra: tenta de novo sem ele
                    if resp.status_code != 200:
                        raw = (await resp.aread()).decode("utf-8", "replace")
                        yield {"type": "error", "message": friendly_http_error(p, resp.status_code, raw, resp.headers.get("retry-after"))}
                        return
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            obj = json.loads(data)
                        except ValueError:
                            continue
                        if obj.get("error"):
                            msg = obj["error"].get("message") if isinstance(obj["error"], dict) else str(obj["error"])
                            yield {"type": "error", "message": f"{p['label']}: {scrub(str(msg))[:300]}"}
                            return
                        if obj.get("usage"):
                            usage = obj["usage"]
                        for choice in obj.get("choices") or []:
                            delta = choice.get("delta") or {}
                            reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                            if reasoning:
                                got_reasoning_field = True
                                first = first or time.perf_counter()
                                out_chars += len(reasoning)
                                yield {"type": "thinking", "text": reasoning}
                            content = delta.get("content")
                            if content:
                                first = first or time.perf_counter()
                                out_chars += len(content)
                                for kind, text in splitter.feed(content):
                                    yield {"type": kind, "text": text}
                    break
        for kind, text in splitter.flush():
            yield {"type": kind, "text": text}
    except httpx.TimeoutException:
        yield {"type": "error", "message": f"{p['label']}: o provedor nao respondeu a tempo."}
        return
    except httpx.HTTPError as e:
        yield {"type": "error", "message": scrub(f"{p['label']}: falha de conexao ({type(e).__name__}).")}
        return

    total = time.perf_counter() - t0
    prompt_tokens = int((usage or {}).get("prompt_tokens") or est_tokens(sum(len(m["content"]) for m in messages)))
    out_tokens = int((usage or {}).get("completion_tokens") or est_tokens(out_chars))
    gen_seconds = (time.perf_counter() - first) if first else total
    yield {"type": "done", "stats": {
        "promptTokens": prompt_tokens, "outputTokens": out_tokens,
        "tokensPerSec": round(out_tokens / gen_seconds, 1) if gen_seconds > 0 and out_tokens else 0.0,
        "totalSeconds": round(total, 2), "loadSeconds": 0,
        "firstTokenSeconds": round(first - t0, 2) if first else None, "thinkingField": got_reasoning_field}}


# ---------- aplicacao

app = FastAPI(title="Nex V2 (Fase 1)", docs_url=None, redoc_url=None, openapi_url=None)


@app.on_event("startup")
def _startup() -> None:
    load_conversations()


def provider_models(p: dict[str, Any]) -> list[str]:
    """GEMINI_MODEL no .env troca o id; sem a variavel vale o padrao da lista."""
    override = (env().get(p["model_var"]) or "").strip() if p.get("model_var") else ""
    return [override] if override else list(p["models"])


def model_list() -> list[dict[str, Any]]:
    out = []
    for p in PROVIDERS:
        base, key = provider_creds(p)
        for m in provider_models(p):
            if base and key:  # sem chave, o modelo nem aparece no dropdown
                out.append({"name": f"{p['label']}: {m}", "sizeMb": 0})
    return out


@app.get("/api/status")
def status() -> dict[str, Any]:
    models = model_list()
    return {"connected": True, "baseUrl": "http://localhost:5080", "version": "Nex-v2 (Fase 1 - Multi-Model Tester)",
            "error": None if models else "Nenhuma chave encontrada no .env.", "models": models}


@app.get("/api/metrics")
def metrics() -> dict[str, Any]:
    return {"machine": {"cpuPercent": 0, "ramUsedMb": 0, "ramTotalMb": 0, "ollamaRamMb": 0, "gpu": None}, "loadedModel": None}


@app.get("/api/tasks/active")
def tasks_active() -> list[Any]:
    return []


@app.post("/api/tasks/{task_id}/cancel", status_code=204)
def task_cancel(task_id: str) -> Response:
    return Response(status_code=204)


@app.get("/api/voice/status")
def voice_status() -> dict[str, Any]:
    return {"engines": [], "voices": [], "whisperModel": ""}


@app.get("/api/conversations")
def list_conversations(mode: str | None = None) -> list[dict[str, Any]]:
    wanted = (mode or "").strip().lower() or None
    rows = [c for c in conversations.values() if wanted is None or c.get("mode", "general") == wanted]
    rows.sort(key=lambda c: c["updatedAt"], reverse=True)
    return [{"id": c["id"], "title": c["title"], "updatedAt": c["updatedAt"], "mode": c.get("mode", "general")} for c in rows]


@app.post("/api/conversations")
def create_conversation(mode: str | None = None) -> dict[str, Any]:
    return public(new_conversation(mode))


@app.get("/api/conversations/{cid}")
def read_conversation(cid: str) -> dict[str, Any]:
    return public(get_conv(cid))


@app.patch("/api/conversations/{cid}")
async def rename_conversation(cid: str, request: Request) -> dict[str, Any]:
    conv = get_conv(cid)
    body = await request.json()
    title = re.sub(r"\s+", " ", str(body.get("title", ""))).strip()[:80]
    if not title:
        raise HTTPException(status_code=400, detail="Informe um titulo.")
    conv["title"], conv["titleEdited"] = title, True
    save_conversations()
    return {"id": cid, "title": title}


@app.delete("/api/conversations/{cid}", status_code=204)
def delete_conversation(cid: str) -> Response:
    get_conv(cid)
    del conversations[cid]
    save_conversations()
    return Response(status_code=204)


def ndjson(event: dict[str, Any]) -> bytes:
    return (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")


@app.post("/api/conversations/{cid}/chat")
async def chat(cid: str, request: Request) -> StreamingResponse:
    conv = get_conv(cid)
    body = await request.json()
    content = str(body.get("content") or "").strip()
    model_name = str(body.get("model") or "")
    system = (body.get("system") or "").strip() if isinstance(body.get("system"), str) else ""
    if not system:
        system = CANONICAL_SYSTEM_PROMPT

    async def events() -> AsyncIterator[bytes]:
        parsed = split_model(model_name)
        if not content:
            yield ndjson({"type": "error", "message": "Mensagem vazia."})
            return
        if parsed is None:
            known = ", ".join(m["name"] for m in model_list()) or "nenhum"
            yield ndjson({"type": "error", "message": f"Modelo '{model_name}' nao reconhecido. Escolha um do dropdown ({known})."})
            return
        provider, model = parsed

        conv["messages"].append({"role": "user", "content": content})
        if conv["title"] == "Novo Teste" and not conv.get("titleEdited"):
            conv["title"] = (content[:40] + ("…" if len(content) > 40 else "")).replace("\n", " ")
        conv["model"], conv["updatedAt"] = model_name, now_iso()
        history = [{"role": m["role"], "content": m["content"]} for m in conv["messages"] if m["content"]][-HISTORY_MESSAGES:]
        messages = ([{"role": "system", "content": system}] if system else []) + history

        answer, thinking, stats, failed = [], [], None, False
        try:
            async for ev in stream_chat(provider, model, messages):
                if ev["type"] == "token":
                    answer.append(ev["text"])
                elif ev["type"] == "thinking":
                    thinking.append(ev["text"])
                elif ev["type"] == "done":
                    stats = ev["stats"]
                elif ev["type"] == "error":
                    failed = True
                yield ndjson(ev)
        finally:
            # guarda o que chegou, mesmo parcial (o usuario parou, a conexao caiu ou o provedor falhou no meio)
            if answer or thinking:
                conv["messages"].append({"role": "assistant", "content": "".join(answer), "thinking": "".join(thinking) or None,
                                         "stats": stats, "model": model_name})
            elif failed:
                conv["messages"].pop()  # a pergunta sem resposta sai do historico: o proximo teste nao carrega lixo
            conv["updatedAt"] = now_iso()
            save_conversations()

    return StreamingResponse(events(), media_type="application/x-ndjson")


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


# O frontend ja compilado (se existir) sai na mesma porta; em desenvolvimento use o `npm run dev` (proxy /api -> 5080).
DIST = Path(os.environ.get("NEX_FRONTEND_DIST") or r"C:\Users\Alexssander\Desktop\Programação\ia-local\.worktrees\develop\backend\wwwroot")
if DIST.is_dir() and (DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    # 127.0.0.1 por padrao: o servidor guarda as chaves dos provedores, e 0.0.0.0 deixaria qualquer aparelho da rede usa-las.
    uvicorn.run(app, host=os.environ.get("NEX_HOST", "127.0.0.1"), port=int(os.environ.get("NEX_PORT", "5080")), log_level="info")
