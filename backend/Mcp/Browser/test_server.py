"""Testa o servidor MCP do navegador com um host falso: token, relay e regras.

python -I -m unittest backend.Mcp.Browser.test_server   (a partir da raiz; usa a porta 19335)
"""

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="nexsrv-"))
os.environ["NEX_BROWSER_PORT"] = "19335"
os.environ["NEX_BROWSER_TOKEN_FILE"] = str(_TMP / "token")
(_TMP / "token").write_text("tok-teste", encoding="ascii")

from . import server  # noqa: E402  (depois do ambiente)
from .policy import DEFAULTS, Pacer  # noqa: E402


def frame(obj) -> bytes:
    body = json.dumps(obj).encode()
    return len(body).to_bytes(4, "little") + body


async def read_frame(reader):
    n = int.from_bytes(await reader.readexactly(4), "little")
    return json.loads(await reader.readexactly(n))


async def fake_host(token="tok-teste", answer=True):
    reader, writer = await asyncio.open_connection("127.0.0.1", 19335)
    writer.write(frame({"hello": token}))
    await writer.drain()

    async def serve():
        try:
            while True:
                msg = await read_frame(reader)
                if answer:
                    result = {"url": msg.get("url")} if msg["op"] == "navigate" else {"released": 0}
                    writer.write(frame({"id": msg["id"], "ok": True, "result": result}))
                    await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass

    task = asyncio.create_task(serve())
    return reader, writer, task


def fast_pacer(**over):
    cfg = dict(DEFAULTS, minNavigateGapSec=0.3, minActionGapSec=0.0)
    cfg.update(over)
    server._pacer = Pacer(cfg)


class ServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        server._server = None
        server._writer = None
        fast_pacer()
        await server._ensure_server()

    async def asyncTearDown(self):
        if server._writer is not None:
            server._writer.close()
        if server._server is not None:
            server._server.close()
            await server._server.wait_closed()
        server._server = None
        server._writer = None

    async def test_conexao_sem_token_ou_com_token_errado_e_recusada(self):
        for token in ("errado", ""):
            r, w, t = await fake_host(token=token)
            await asyncio.sleep(0.3)
            self.assertIsNone(server._writer, f"token {token!r} nao pode virar o host")
            w.close()
            t.cancel()

    async def test_sem_hello_nao_vira_host(self):
        r, w = await asyncio.open_connection("127.0.0.1", 19335)
        w.write(frame({"id": 1, "ok": True}))
        await w.drain()
        await asyncio.sleep(0.3)
        self.assertIsNone(server._writer)
        w.close()

    async def test_token_certo_conecta_e_navega(self):
        r, w, t = await fake_host()
        await asyncio.sleep(0.2)
        out = await server.browser_navigate("https://example.com/")
        self.assertIn("Aberto no grupo Nex", out)
        w.close()
        t.cancel()

    async def test_url_perigosa_nem_chega_ao_host(self):
        got = []
        r, w, t = await fake_host()
        await asyncio.sleep(0.2)
        for url in ("javascript:alert(1)", "file:///C:/Windows/win.ini", "chrome://settings"):
            with self.assertRaises(RuntimeError):
                await server.browser_navigate(url)
        w.close()
        t.cancel()

    async def test_escopo_barra_site_fora_da_lista(self):
        fast_pacer(allowedHosts=["example.com"])
        r, w, t = await fake_host()
        await asyncio.sleep(0.2)
        await server.browser_navigate("https://app.example.com/")
        with self.assertRaises(RuntimeError) as cm:
            await server.browser_navigate("https://outro-site.io/")
        self.assertIn("fora do escopo", str(cm.exception))
        w.close()
        t.cancel()

    async def test_ritmo_atrasa_navegacoes_seguidas(self):
        fast_pacer(minNavigateGapSec=0.5)
        r, w, t = await fake_host()
        await asyncio.sleep(0.2)
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        await server.browser_navigate("https://example.com/a")
        await server.browser_navigate("https://example.com/b")
        self.assertGreaterEqual(loop.time() - t0, 0.45)
        w.close()
        t.cancel()

    async def test_limite_por_minuto_devolve_erro_e_nao_trava(self):
        fast_pacer(minNavigateGapSec=0, maxNavigatesPerMinutePerHost=2)
        r, w, t = await fake_host()
        await asyncio.sleep(0.2)
        await server.browser_navigate("https://example.com/1")
        await server.browser_navigate("https://example.com/2")
        with self.assertRaises(RuntimeError) as cm:
            await server.browser_navigate("https://example.com/3")
        self.assertIn("Espere", str(cm.exception))
        w.close()
        t.cancel()

    async def test_sem_host_o_erro_manda_carregar_a_extensao_sem_mexer_no_chrome(self):
        with self.assertRaises(RuntimeError) as cm:
            await server.browser_navigate("https://example.com/")
        msg = str(cm.exception)
        self.assertIn("extension/chrome", msg)
        self.assertIn("não reinicie", msg)

    async def test_host_novo_substitui_o_antigo(self):
        r1, w1, t1 = await fake_host()
        await asyncio.sleep(0.2)
        r2, w2, t2 = await fake_host()
        await asyncio.sleep(0.2)
        out = await server.browser_navigate("https://example.com/")
        self.assertIn("Aberto", out)
        for w in (w1, w2):
            w.close()
        t1.cancel()
        t2.cancel()

    async def test_host_morre_no_meio_do_pedido_falha_rapido(self):
        r, w = await asyncio.open_connection("127.0.0.1", 19335)
        w.write(frame({"hello": "tok-teste"}))
        await w.drain()
        await asyncio.sleep(0.2)

        async def kill_after_receive():
            await read_frame(r)
            w.close()

        k = asyncio.create_task(kill_after_receive())
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        with self.assertRaises(RuntimeError):
            await server.browser_navigate("https://example.com/")
        self.assertLess(loop.time() - t0, 5)
        await k

    async def test_porta_ocupada_vira_erro_claro(self):
        blocker = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 19336)
        try:
            old = server._PORT
            server._server = None
            server._PORT = 19336
            await server._ensure_server()
            with self.assertRaises(RuntimeError) as cm:
                await server.browser_get_dom()
            self.assertIn("ocupada", str(cm.exception))
        finally:
            server._PORT = old
            server._bind_error = None
            blocker.close()
            await blocker.wait_closed()


if __name__ == "__main__":
    unittest.main()
