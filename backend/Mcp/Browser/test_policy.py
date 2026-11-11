"""Testes do policy.py: python -I -m unittest backend.Mcp.Browser.test_policy (a partir da raiz)."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from .policy import DEFAULTS, Pacer, PolicyError, check_url, load_policy


class FakeTime:
    def __init__(self):
        self.now = 1000.0
        self.slept = []

    def clock(self):
        return self.now

    async def sleep(self, s):
        self.slept.append(s)
        self.now += s


def run(coro):
    return asyncio.run(coro)


def cfg(**over):
    c = dict(DEFAULTS)
    c.update(over)
    return c


class UrlTests(unittest.TestCase):
    def test_esquemas_perigosos_sao_recusados(self):
        for url in ("javascript:alert(1)", "file:///C:/Windows/win.ini", "chrome://settings", "data:text/html,x", "about:blank", "ftp://a.com"):
            with self.assertRaises(PolicyError, msg=url):
                check_url(url, cfg())

    def test_http_e_https_passam_sem_escopo(self):
        self.assertEqual(check_url("https://Example.COM/x?y=1", cfg()), "example.com")
        self.assertEqual(check_url("http://localhost:5080/", cfg()), "localhost")

    def test_escopo_permite_dominio_e_subdominios(self):
        c = cfg(allowedHosts=["example.com"])
        self.assertEqual(check_url("https://example.com", c), "example.com")
        self.assertEqual(check_url("https://app.example.com", c), "app.example.com")
        with self.assertRaises(PolicyError):
            check_url("https://example.com.evil.io", c)
        with self.assertRaises(PolicyError):
            check_url("https://notexample.com", c)

    def test_curinga_so_subdominios(self):
        c = cfg(allowedHosts=["*.example.com"])
        check_url("https://a.example.com", c)
        with self.assertRaises(PolicyError):
            check_url("https://example.com", c)

    def test_bloqueado_vence_o_permitido(self):
        c = cfg(allowedHosts=["example.com"], blockedHosts=["admin.example.com"])
        check_url("https://www.example.com", c)
        with self.assertRaises(PolicyError):
            check_url("https://admin.example.com", c)

    def test_credencial_na_url_nao_engana_o_host(self):
        c = cfg(allowedHosts=["example.com"])
        with self.assertRaises(PolicyError):
            check_url("https://example.com@evil.io/", c)


class PacerTests(unittest.TestCase):
    def make(self, **over):
        t = FakeTime()
        return t, Pacer(cfg(**over), clock=t.clock, sleep=t.sleep)

    def test_segunda_navegacao_espera_o_intervalo_minimo(self):
        t, p = self.make(minNavigateGapSec=3.0)
        self.assertEqual(run(p.before_navigate("a.com")), 0.0)
        waited = run(p.before_navigate("b.com"))
        self.assertAlmostEqual(waited, 3.0, places=3)
        self.assertEqual(len(t.slept), 1)

    def test_nao_espera_se_o_intervalo_ja_passou(self):
        t, p = self.make(minNavigateGapSec=3.0)
        run(p.before_navigate("a.com"))
        t.now += 10
        self.assertEqual(run(p.before_navigate("a.com")), 0.0)
        self.assertEqual(t.slept, [])

    def test_limite_por_host_por_minuto(self):
        t, p = self.make(minNavigateGapSec=0, maxNavigatesPerMinutePerHost=3, maxNavigatesPerMinute=50)
        for _ in range(3):
            run(p.before_navigate("a.com"))
        with self.assertRaises(PolicyError) as cm:
            run(p.before_navigate("a.com"))
        self.assertIn("a.com", str(cm.exception))
        run(p.before_navigate("b.com"))  # outro site segue livre
        t.now += 61
        run(p.before_navigate("a.com"))  # a janela de 60 s liberou

    def test_limite_global_por_minuto(self):
        t, p = self.make(minNavigateGapSec=0, maxNavigatesPerMinute=4, maxNavigatesPerMinutePerHost=50)
        for i in range(4):
            run(p.before_navigate(f"h{i}.com"))
        with self.assertRaises(PolicyError):
            run(p.before_navigate("novo.com"))

    def test_erro_de_ritmo_nao_conta_como_abertura(self):
        t, p = self.make(minNavigateGapSec=0, maxNavigatesPerMinutePerHost=1)
        run(p.before_navigate("a.com"))
        for _ in range(5):
            with self.assertRaises(PolicyError):
                run(p.before_navigate("a.com"))
        t.now += 61
        run(p.before_navigate("a.com"))  # se as recusas contassem, isto ainda falharia

    def test_acoes_tem_intervalo_proprio(self):
        t, p = self.make(minActionGapSec=0.7)
        self.assertEqual(run(p.before_action()), 0.0)
        self.assertAlmostEqual(run(p.before_action()), 0.7, places=3)

    def test_espera_nunca_passa_do_teto(self):
        t, p = self.make(minNavigateGapSec=999)
        run(p.before_navigate("a.com"))
        self.assertLessEqual(run(p.before_navigate("b.com")), 15.0)


class FileTests(unittest.TestCase):
    def test_sem_arquivo_vale_o_padrao(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(load_policy(Path(d) / "nao-existe.json"), DEFAULTS)

    def test_arquivo_sobrepoe_so_chaves_conhecidas(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "p.json"
            f.write_text(json.dumps({"allowedHosts": ["a.com"], "minNavigateGapSec": 9, "x": 1}), encoding="utf-8")
            c = load_policy(f)
            self.assertEqual(c["allowedHosts"], ["a.com"])
            self.assertEqual(c["minNavigateGapSec"], 9)
            self.assertNotIn("x", c)

    def test_json_quebrado_vira_erro_claro_e_nao_libera_tudo(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "p.json"
            f.write_text("{ nao e json", encoding="utf-8")
            with self.assertRaises(PolicyError):
                load_policy(f)


if __name__ == "__main__":
    unittest.main()
