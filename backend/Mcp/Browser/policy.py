"""Regras de uso do navegador do Nex: esquema da URL, escopo e ritmo.

O ritmo existe para o Nex não parecer um robô para os sites (bloqueios temporários de conta ou de IP).
O escopo é opcional e escrito por você em backend/data/browser-policy.json, por exemplo para bug bounty:

    {
      "allowedHosts": ["example.com", "*.example.com"],
      "blockedHosts": ["admin.example.com"],
      "minNavigateGapSec": 4,
      "maxNavigatesPerMinute": 10,
      "maxNavigatesPerMinutePerHost": 5,
      "minActionGapSec": 1
    }

Sem o arquivo valem os padrões abaixo e nenhum site é barrado. allowedHosts vazio significa "qualquer site".
"example.com" vale para o próprio domínio e para os subdomínios; "*.example.com" vale só para os subdomínios.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

DEFAULTS = {
    "allowedHosts": [],
    "blockedHosts": [],
    "minNavigateGapSec": 3.0,
    "maxNavigatesPerMinute": 12,
    "maxNavigatesPerMinutePerHost": 6,
    "minActionGapSec": 0.7,
}

POLICY_FILE = Path(__file__).resolve().parents[2] / "data" / "browser-policy.json"

# Esperar para respeitar o intervalo mínimo é normal; esperar mais que isso é sinal de que o ritmo estourou.
_MAX_GAP_WAIT = 15.0


class PolicyError(RuntimeError):
    """A regra barrou a ação. A mensagem diz ao modelo o que fazer, sem pedir para mexer no Chrome."""


def load_policy(path: Path = POLICY_FILE) -> dict:
    cfg = dict(DEFAULTS)
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return cfg
    except (OSError, ValueError):
        raise PolicyError(f"O arquivo de regras do navegador ({path.name}) está inválido. Corrija o JSON ou apague o arquivo.")
    if isinstance(raw, dict):
        for key in DEFAULTS:
            if key in raw:
                cfg[key] = raw[key]
    return cfg


def _matches(host: str, pattern: str) -> bool:
    pattern = pattern.strip().lower().rstrip(".")
    if not pattern:
        return False
    if pattern.startswith("*."):
        return host.endswith("." + pattern[2:])
    return host == pattern or host.endswith("." + pattern)


def check_url(url: str, cfg: dict) -> str:
    """Valida esquema e escopo e devolve o host em minúsculas."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise PolicyError("Só são abertos endereços http e https. Esse endereço foi recusado.")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise PolicyError("O endereço não tem site. Informe a URL completa, com http ou https.")
    for pattern in cfg.get("blockedHosts") or []:
        if _matches(host, str(pattern)):
            raise PolicyError(f"{host} está na lista de sites bloqueados do Nex. Não abra esse site.")
    allowed = [str(p) for p in (cfg.get("allowedHosts") or [])]
    if allowed and not any(_matches(host, p) for p in allowed):
        raise PolicyError(f"{host} está fora do escopo definido para o Nex. Só são permitidos: {', '.join(allowed)}.")
    return host


class Pacer:
    """Controla a velocidade. O relógio e o sono são injetáveis para os testes."""

    def __init__(self, cfg: dict, clock=time.monotonic, sleep=asyncio.sleep):
        self.cfg = cfg
        self.clock = clock
        self.sleep = sleep
        self._nav: list[tuple[float, str]] = []
        self._last_nav = None
        self._last_action = None

    async def _gap(self, last, minimum: float) -> float:
        if last is None or minimum <= 0:
            return 0.0
        wait = minimum - (self.clock() - last)
        if wait <= 0:
            return 0.0
        wait = min(wait, _MAX_GAP_WAIT)
        await self.sleep(wait)
        return wait

    async def before_navigate(self, host: str) -> float:
        now = self.clock()
        self._nav = [(t, h) for (t, h) in self._nav if now - t < 60]
        per_min = int(self.cfg["maxNavigatesPerMinute"])
        per_host = int(self.cfg["maxNavigatesPerMinutePerHost"])
        if per_min > 0 and len(self._nav) >= per_min:
            wait = 60 - (now - self._nav[0][0])
            raise PolicyError(f"Ritmo alto demais: já foram {len(self._nav)} aberturas no último minuto. Espere cerca de {int(wait) + 1} s antes de abrir outra página, para o site não bloquear o acesso.")
        same = [(t, h) for (t, h) in self._nav if h == host]
        if per_host > 0 and len(same) >= per_host:
            wait = 60 - (now - same[0][0])
            raise PolicyError(f"Muitas aberturas em {host} no último minuto ({len(same)}). Espere cerca de {int(wait) + 1} s e prefira ler a página atual, em vez de abrir outra.")
        waited = await self._gap(self._last_nav, float(self.cfg["minNavigateGapSec"]))
        stamp = self.clock()
        self._nav.append((stamp, host))
        self._last_nav = stamp
        return waited

    async def before_action(self) -> float:
        waited = await self._gap(self._last_action, float(self.cfg["minActionGapSec"]))
        self._last_action = self.clock()
        return waited
