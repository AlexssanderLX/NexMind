"""Testes do backend V2 sem abrir porta e sem rede: TestClient em processo + provedores falsos (httpx.MockTransport).

    backend_v2\\venv\\Scripts\\python.exe -m unittest backend_v2.test_main     (a partir de nex-re)  ou
    cd backend_v2 && venv\\Scripts\\python.exe -m unittest test_main -v
"""
import json
import os
import tempfile
import unittest
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="nexv2-"))
(_TMP / ".env").write_text(
    "\n".join(
        [
            "NVIDIA_API_KEY=nvapi-SEGREDO-NVIDIA-123456", "NVIDIA_BASE_URL=https://nv.test/v1",
            "GROQ_API_KEY=gsk_SEGREDO_GROQ_123456", "GROQ_BASE_URL=https://groq.test/v1",
            "GEMINI_API_KEY=AQ.SEGREDO-GEMINI-123456", "GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/",
            "GEMINI_MODEL=gemini-3.5-flash-lite",
            "CLOUDFLARE_API_TOKEN=cf-SEGREDO-CF-123456", "CLOUDFLARE_BASE_URL=https://cf.test/v1",
            "AION_API_KEY=aion-SEGREDO-123456", "AION_BASE_URL=https://aion.test/v1",
            "CEREBRAS_API_KEY=csk-SEGREDO-123456", "CEREBRAS_BASE_URL=https://cb.test/v1",
            # OpenRouter sem chave: o modelo nao deve aparecer
            "OPENROUTER_BASE_URL=https://or.test/v1",
        ]
    ),
    encoding="utf-8",
)
os.environ["NEX_ENV_FILE"] = str(_TMP / ".env")
os.environ["NEX_DATA_FILE"] = str(_TMP / "data" / "c.json")
os.environ["NEX_FRONTEND_DIST"] = str(_TMP / "sem-frontend")

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

try:
    import main  # noqa: E402  (rodando de dentro da pasta backend_v2)
except ImportError:
    from . import main  # type: ignore # noqa: E402

NV = "Nvidia: nvidia/nemotron-3.5-bolt-e4b"
GQ = "Groq: qwen/qwen3.8-27b"
GM = "Gemini: gemini-3.5-flash-lite"
CF = "Cloudflare: @cf/meta/llama-3.1-8b-instruct-fast"
AI = "Aion Labs: aion-labs/aion-3.0-mini"
CB = "Cerebras: qwen-3.8-27b"


def sse(*chunks, done=True):
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks)
    return body + ("data: [DONE]\n\n" if done else "")


def delta(**kw):
    return {"choices": [{"delta": kw}]}


class FakeProviders:
    """Registra o que cada provedor recebeu e responde o que o teste mandar."""

    def __init__(self):
        self.calls = []
        self.handler = lambda req, body: httpx.Response(200, text=sse(delta(content="oi")), headers={"content-type": "text/event-stream"})

    def __call__(self):
        def transport(request: httpx.Request):
            body = json.loads(request.content)
            self.calls.append({"url": str(request.url), "auth": request.headers.get("authorization"), "body": body})
            return self.handler(request, body)

        return httpx.AsyncClient(transport=httpx.MockTransport(transport))


class Base(unittest.TestCase):
    def setUp(self):
        main._env_cache = None
        main.conversations.clear()
        self.fake = FakeProviders()
        main.make_client = self.fake
        self.client = TestClient(main.app)
        self.cid = self.client.post("/api/conversations").json()["id"]

    def chat(self, model, content="oi", **extra):
        r = self.client.post(f"/api/conversations/{self.cid}/chat", json={"content": content, "model": model, **extra})
        self.assertEqual(r.headers["content-type"].split(";")[0], "application/x-ndjson")
        return [json.loads(x) for x in r.text.splitlines() if x.strip()], r.text


class StatusAndCrud(Base):
    def test_status_tem_o_contrato_e_so_os_modelos_com_chave(self):
        s = self.client.get("/api/status").json()
        self.assertTrue(s["connected"])
        self.assertEqual(s["version"], "Nex-v2 (Fase 1 - Multi-Model Tester)")
        self.assertIsNone(s["error"])
        self.assertEqual([m["name"] for m in s["models"]], [NV, GQ, GM, CF, AI, CB])  # OpenRouter sem chave some
        self.assertTrue(all(m["sizeMb"] == 0 for m in s["models"]))

    def test_endpoints_minimos_para_o_frontend_carregar(self):
        self.assertEqual(self.client.get("/api/metrics").json(), {"machine": {"cpuPercent": 0, "ramUsedMb": 0, "ramTotalMb": 0, "ollamaRamMb": 0, "gpu": None}, "loadedModel": None})
        self.assertEqual(self.client.get("/api/tasks/active").json(), [])
        self.assertEqual(self.client.get("/api/voice/status").json(), {"engines": [], "voices": [], "whisperModel": ""})

    def test_crud_de_conversa(self):
        c = self.client.post("/api/conversations").json()
        self.assertEqual((c["title"], c["messages"]), ("Novo Teste", []))
        self.assertEqual(self.client.get(f"/api/conversations/{c['id']}").json()["id"], c["id"])
        self.assertEqual(self.client.patch(f"/api/conversations/{c['id']}", json={"title": "  Meu   teste  "}).json()["title"], "Meu teste")
        self.assertEqual(self.client.patch(f"/api/conversations/{c['id']}", json={"title": " "}).status_code, 400)
        self.assertEqual(self.client.delete(f"/api/conversations/{c['id']}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/conversations/{c['id']}").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/conversations/{c['id']}").status_code, 404)

    def test_listas_por_modo(self):
        sec = self.client.post("/api/conversations?mode=security").json()["id"]
        dev = self.client.post("/api/conversations?mode=DEV").json()["id"]
        bad = self.client.post("/api/conversations?mode=hacker").json()["id"]
        ids = lambda q: {c["id"] for c in self.client.get("/api/conversations" + q).json()}  # noqa: E731
        self.assertEqual(ids("?mode=security"), {sec})
        self.assertEqual(ids("?mode=dev"), {dev})
        self.assertIn(bad, ids("?mode=general"))
        self.assertTrue({sec, dev, bad, self.cid} <= ids(""))
        row = self.client.get("/api/conversations?mode=security").json()[0]
        self.assertEqual(set(row), {"id", "title", "updatedAt", "mode"})

    def test_persiste_em_disco_e_recarrega(self):
        self.client.patch(f"/api/conversations/{self.cid}", json={"title": "Guardada"})
        main.conversations.clear()
        main.load_conversations()
        self.assertEqual(main.conversations[self.cid]["title"], "Guardada")


class Streaming(Base):
    def test_tokens_e_done_com_telemetria_do_provedor(self):
        self.fake.handler = lambda r, b: httpx.Response(200, text=sse(delta(content="Ola"), delta(content=" mundo"),
                                                                       {"choices": [], "usage": {"prompt_tokens": 150, "completion_tokens": 90}}))
        ev, _ = self.chat(GQ, "oi")
        self.assertEqual([e["text"] for e in ev if e["type"] == "token"], ["Ola", " mundo"])
        done = ev[-1]
        self.assertEqual(done["type"], "done")
        for k in ("promptTokens", "outputTokens", "tokensPerSec", "totalSeconds", "loadSeconds"):
            self.assertIn(k, done["stats"])
        self.assertEqual((done["stats"]["promptTokens"], done["stats"]["outputTokens"], done["stats"]["loadSeconds"]), (150, 90, 0))

    def test_sem_usage_estima_tokens(self):
        ev, _ = self.chat(AI, "uma pergunta qualquer")
        self.assertGreater(ev[-1]["stats"]["promptTokens"], 0)
        self.assertGreater(ev[-1]["stats"]["outputTokens"], 0)

    def test_raciocinio_por_campo_reasoning_content_e_reasoning(self):
        self.fake.handler = lambda r, b: httpx.Response(200, text=sse(delta(reasoning_content="penso 1"), delta(reasoning="penso 2"), delta(content="resposta")))
        ev, _ = self.chat(NV)
        self.assertEqual([(e["type"], e["text"]) for e in ev[:-1]], [("thinking", "penso 1"), ("thinking", "penso 2"), ("token", "resposta")])

    def test_tags_think_cortadas_entre_pedacos(self):
        chunks = ["<th", "ink>racioc", "inio longo</thi", "nk>Resp", "osta final"]
        self.fake.handler = lambda r, b: httpx.Response(200, text=sse(*[delta(content=c) for c in chunks]))
        ev, raw = self.chat(GQ)
        think = "".join(e["text"] for e in ev if e["type"] == "thinking")
        answer = "".join(e["text"] for e in ev if e["type"] == "token")
        self.assertEqual((think, answer), ("raciocinio longo", "Resposta final"))
        self.assertNotIn("<think>", raw)
        self.assertNotIn("</think>", raw)

    def test_so_a_nvidia_pede_enable_thinking(self):
        self.chat(NV)
        self.chat(GQ)
        by_url = {c["url"]: c["body"] for c in self.fake.calls}
        self.assertEqual(by_url["https://nv.test/v1/chat/completions"]["chat_template_kwargs"], {"enable_thinking": True})
        self.assertNotIn("chat_template_kwargs", by_url["https://groq.test/v1/chat/completions"])
        self.assertTrue(all(c["body"]["stream"] is True for c in self.fake.calls))

    def test_nvidia_recusa_o_parametro_extra_e_tenta_sem_ele(self):
        def handler(req, body):
            if "chat_template_kwargs" in body:
                return httpx.Response(400, text='{"error":"unknown field chat_template_kwargs"}')
            return httpx.Response(200, text=sse(delta(content="ok sem extra")))
        self.fake.handler = handler
        ev, _ = self.chat(NV)
        self.assertEqual(len(self.fake.calls), 2)
        self.assertEqual(ev[0], {"type": "token", "text": "ok sem extra"})

    def test_groq_manda_teto_de_saida_e_os_outros_nao(self):
        self.chat(GQ)
        self.chat(AI)
        by_url = {c["url"]: c["body"] for c in self.fake.calls}
        self.assertEqual(by_url["https://groq.test/v1/chat/completions"]["max_tokens"], 800)
        self.assertNotIn("max_tokens", by_url["https://aion.test/v1/chat/completions"])

    def test_cada_provedor_vai_para_a_url_e_com_a_chave_certa(self):
        for model, url, secret in [
            (NV, "https://nv.test/v1/chat/completions", "nvapi-SEGREDO-NVIDIA-123456"),
            (GQ, "https://groq.test/v1/chat/completions", "gsk_SEGREDO_GROQ_123456"),
            (GM, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "AQ.SEGREDO-GEMINI-123456"),
            (CF, "https://cf.test/v1/chat/completions", "cf-SEGREDO-CF-123456"),
            (AI, "https://aion.test/v1/chat/completions", "aion-SEGREDO-123456"),
            (CB, "https://cb.test/v1/chat/completions", "csk-SEGREDO-123456"),
        ]:
            self.fake.calls.clear()
            self.chat(model)
            call = self.fake.calls[0]
            self.assertEqual(call["url"], url, model)
            self.assertEqual(call["auth"], f"Bearer {secret}", model)
            self.assertEqual(call["body"]["model"], model.split(": ", 1)[1])

    def test_historico_e_system_seguem_para_o_provedor(self):
        self.chat(GQ, "primeira", system="Responda curto.")
        self.chat(GQ, "segunda", system="Responda curto.")
        msgs = self.fake.calls[1]["body"]["messages"]
        self.assertEqual([m["role"] for m in msgs], ["system", "user", "assistant", "user"])
        self.assertEqual(msgs[0]["content"], "Responda curto.")
        self.assertEqual((msgs[1]["content"], msgs[2]["content"], msgs[3]["content"]), ("primeira", "oi", "segunda"))

    def test_conversa_guarda_resposta_pensamento_stats_e_titulo(self):
        self.fake.handler = lambda r, b: httpx.Response(200, text=sse(delta(reasoning_content="hum"), delta(content="Resposta")))
        self.chat(NV, "Explique o que e um buffer overflow em detalhes por favor, sem pressa nenhuma")
        conv = self.client.get(f"/api/conversations/{self.cid}").json()
        self.assertTrue(conv["title"].startswith("Explique o que e um buffer overflow"))
        self.assertLessEqual(len(conv["title"]), 41)
        user, ai = conv["messages"]
        self.assertEqual(user["role"], "user")
        self.assertEqual((ai["content"], ai["thinking"], ai["model"]), ("Resposta", "hum", NV))
        self.assertIn("tokensPerSec", ai["stats"])
        self.assertEqual(conv["model"], NV)

    def test_titulo_renomeado_nao_e_sobrescrito(self):
        self.client.patch(f"/api/conversations/{self.cid}", json={"title": "Meu nome"})
        self.chat(GQ, "uma mensagem")
        self.assertEqual(self.client.get(f"/api/conversations/{self.cid}").json()["title"], "Meu nome")

    def test_campos_extras_do_frontend_sao_ignorados(self):
        ev, _ = self.chat(GQ, numCtx=32768, think=None, search=False, tools=False, browser=False, desktop=False, selection=None, cleanMode=False)
        self.assertEqual(ev[-1]["type"], "done")


class Errors(Base):
    def test_429_vira_mensagem_amigavel_e_nao_suja_o_historico(self):
        self.fake.handler = lambda r, b: httpx.Response(429, text='{"error":"quota"}', headers={"retry-after": "30"})
        ev, _ = self.chat(GQ, "oi")
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0]["type"], "error")
        self.assertIn("Groq", ev[0]["message"])
        self.assertIn("429", ev[0]["message"])
        self.assertIn("30s", ev[0]["message"])
        self.assertEqual(self.client.get(f"/api/conversations/{self.cid}").json()["messages"], [])

    def test_401_e_404_e_500(self):
        for status, trecho in [(401, "chave recusada"), (403, "chave recusada"), (404, "nao encontrado"), (402, "sem creditos"), (503, "problema")]:
            self.fake.handler = lambda r, b, s=status: httpx.Response(s, text="x")
            ev, _ = self.chat(AI)
            self.assertEqual(ev[0]["type"], "error", status)
            self.assertIn(trecho, ev[0]["message"], status)

    def test_chave_nunca_aparece_no_erro(self):
        self.fake.handler = lambda r, b: httpx.Response(401, text='{"detail":"invalid key nvapi-SEGREDO-NVIDIA-123456"}')
        ev, raw = self.chat(NV)
        self.assertEqual(ev[0]["type"], "error")
        self.assertNotIn("SEGREDO", raw)

    def test_erro_dentro_do_stream_e_timeout_e_conexao(self):
        self.fake.handler = lambda r, b: httpx.Response(200, text=sse({"error": {"message": "rate limit nvapi-SEGREDO-NVIDIA-123456"}}))
        ev, raw = self.chat(NV)
        self.assertEqual(ev[0]["type"], "error")
        self.assertNotIn("SEGREDO", raw)

        def boom(req, body):
            raise httpx.ConnectTimeout("lento")
        self.fake.handler = boom
        ev, _ = self.chat(GQ)
        self.assertIn("a tempo", ev[0]["message"])

        def down(req, body):
            raise httpx.ConnectError("caiu")
        self.fake.handler = down
        ev, _ = self.chat(GQ)
        self.assertIn("conexao", ev[0]["message"])

    def test_modelo_desconhecido_ou_sem_chave_ou_mensagem_vazia(self):
        for model in ["nex-unfiltered:latest", "Groq", "", "OpenRouter: nvidia/nemotron-3.5-lightning:free", "Hacker: x"]:
            ev, _ = self.chat(model)
            self.assertEqual(ev[0]["type"], "error", model)
        self.assertIn("OpenRouter", self.chat("OpenRouter: nvidia/nemotron-3.5-lightning:free")[0][0]["message"])
        ev, _ = self.chat(GQ, "   ")
        self.assertEqual((ev[0]["type"], ev[0]["message"]), ("error", "Mensagem vazia."))
        self.assertEqual(self.fake.calls, [])  # nada saiu para a rede

    def test_erro_no_meio_guarda_o_parcial(self):
        self.fake.handler = lambda r, b: httpx.Response(200, text=sse(delta(content="comecou"), {"error": {"message": "caiu"}}))
        ev, _ = self.chat(GQ)
        self.assertEqual([e["type"] for e in ev], ["token", "error"])
        msgs = self.client.get(f"/api/conversations/{self.cid}").json()["messages"]
        self.assertEqual([m["role"] for m in msgs], ["user", "assistant"])
        self.assertEqual(msgs[1]["content"], "comecou")


class ThinkSplitterUnit(unittest.TestCase):
    def test_tag_aberta_sem_fechar_vira_pensamento_e_texto_comum_passa(self):
        s = main.ThinkSplitter()
        out = s.feed("antes <think>pensando") + s.flush()
        self.assertEqual(out, [("token", "antes "), ("thinking", "pensando")])
        s = main.ThinkSplitter()
        self.assertEqual(s.feed("a < b e c > d") + s.flush(), [("token", "a < b e c > d")])

    def test_status_e_sem_chave(self):
        self.assertEqual(main.scrub("x nvapi-SEGREDO-NVIDIA-123456 y"), "x *** y")


if __name__ == "__main__":
    unittest.main()
