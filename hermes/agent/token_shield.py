"""Keep Groq's 7k input-tokens-per-minute window from filling up on terminal output."""

from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger("agent.conversation_loop")

_SHIELD_TOOLS = frozenset({
    "terminal", "process_manage", "execute_code", "execute_command", "run_shell",
})
_MAX_CHARS = 1200
_HEAD_LINES = 15
_TAIL_LINES = 5
_LINE_TRIGGER = 25
_GROQ_ITPM = 7000
_GROQ_PAUSE_AT = int(_GROQ_ITPM * 0.85)
_TOOL_GAP_S = 5
_WINDOW_WAIT_S = 10


def shield_tool_text(name: str, content: Any) -> Any:
    """Cap a terminal-like tool result at 15 head lines, 5 tail lines, and 1200 chars."""
    if not isinstance(content, str) or not _shields(name):
        return content
    lines = content.splitlines()
    if len(lines) <= _LINE_TRIGGER and len(content) <= _MAX_CHARS:
        return content
    head = lines[:_HEAD_LINES]
    tail = lines[-_TAIL_LINES:] if len(lines) > _HEAD_LINES + _TAIL_LINES else []
    omitted = max(0, len(lines) - len(head) - len(tail))
    notice = f"[... Token Shield: {omitted} linhas intermediárias omitidas para proteger o contexto ...]"
    body = "\n".join(head + [notice] + tail)
    if len(body) > _MAX_CHARS:
        body = body[: _MAX_CHARS - 80].rstrip() + "\n[... Token Shield: saída cortada em 1200 caracteres ...]"
    return body


def note_groq_request(agent: Any, api_kwargs: Any) -> None:
    """Remember roughly how many tokens this Groq request just sent."""
    if _provider(agent) != "groq" or not isinstance(api_kwargs, dict):
        return
    messages = api_kwargs.get("messages") or []
    chars = 0
    for message in messages:
        if isinstance(message, dict):
            chars += len(str(message.get("content") or ""))
    _window(agent).append((time.monotonic(), max(1, chars // 4)))


def pace_after_tool_round(agent: Any) -> None:
    """Wait between Groq tool turns, longer when the last minute is near 5,950 tokens."""
    if _provider(agent) != "groq":
        return
    now = time.monotonic()
    window = _window(agent)
    window[:] = [(stamp, tokens) for stamp, tokens in window if now - stamp < 60]
    used = sum(tokens for _, tokens in window)
    if used >= _GROQ_PAUSE_AT:
        logger.warning("[Pacing] Sincronizando janela de tokens Groq (aguardando 10s)...")
        time.sleep(_WINDOW_WAIT_S)
        return
    time.sleep(_TOOL_GAP_S)


def collapse_finished_tool_outputs(
    messages: list[dict[str, Any]], *, keep_from: int,
) -> list[dict[str, Any]]:
    """Replace tool output from finished turns with one line. The live turn stays raw."""
    collapsed: list[dict[str, Any]] = []
    for index, message in enumerate(messages):
        content = message.get("content")
        if (
            message.get("role") == "tool"
            and index < keep_from
            and isinstance(content, str)
            and not content.startswith("[Execução concluída:")
            and not content.startswith("[Executado:")
        ):
            command = _command_for(messages, message)
            copy = dict(message)
            copy["content"] = (
                f"[Execução concluída: {command} | Saída resumida: {_one_line(content)}]"
            )
            collapsed.append(copy)
        else:
            collapsed.append(message)
    return collapsed


def prune_stale_tool_outputs(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the latest tool round intact. Older command output becomes one line."""
    last = max((i for i, message in enumerate(messages) if message.get("role") == "tool"), default=-1)
    if last < 0:
        return messages
    start = last
    while start > 0 and messages[start - 1].get("role") == "tool":
        start -= 1
    pruned: list[dict[str, Any]] = []
    for index, message in enumerate(messages):
        if message.get("role") == "tool" and index < start:
            command = _command_for(messages, message)
            copy = dict(message)
            copy["content"] = f"[Executado: {command} - Sucesso]"
            pruned.append(copy)
        else:
            pruned.append(message)
    return pruned


def _shields(name: str | None) -> bool:
    lowered = (name or "").lower()
    return lowered in _SHIELD_TOOLS or "shell" in lowered or lowered.startswith("mcp_")


def _provider(agent: Any) -> str:
    return str(getattr(agent, "provider", "") or "").strip().lower()


def _window(agent: Any) -> list[tuple[float, int]]:
    window = getattr(agent, "_groq_itpm_window", None)
    if not isinstance(window, list):
        window = []
        agent._groq_itpm_window = window
    return window


def _one_line(content: str) -> str:
    for line in content.splitlines():
        text = " ".join(line.split())
        if text:
            return text[:160]
    return "sem saída"


def _command_for(messages: list[dict[str, Any]], tool_message: dict[str, Any]) -> str:
    call_id = tool_message.get("tool_call_id")
    for message in reversed(messages):
        for call in message.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            if call_id and call.get("id") != call_id:
                continue
            function = call.get("function") or {}
            arguments = function.get("arguments") or ""
            name = function.get("name") or tool_message.get("tool_name") or "comando"
            if isinstance(arguments, str) and arguments.strip():
                return f"{name} {arguments[:80]}"
            return str(name)
    return str(tool_message.get("tool_name") or tool_message.get("name") or "comando")
