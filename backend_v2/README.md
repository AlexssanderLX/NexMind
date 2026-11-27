# Nex V2 - Fase 1 (testador de modelos)
Backend FastAPI em `main.py` (porta 5080, so 127.0.0.1). Le as chaves de `..\.env` (nunca saem para a tela, o log ou o frontend).
- Subir: `start-backend-v2.cmd` (ou `venv\Scripts\python.exe main.py`). Abre http://localhost:5080 (usa o frontend ja compilado do develop) ou `npm run dev` no frontend (proxy /api -> 5080).
- Testes sem rede e sem porta: `venv\Scripts\python.exe -m unittest test_main -v` (25 testes).
- Conferir modelos nos provedores: `check_models.py`. Teste real (1 pedido curto por modelo): `live_test.py`.
- Conversas em `data\conversations.json`. Variaveis: NEX_HOST, NEX_PORT, NEX_GROQ_MAX_TOKENS (900), NEX_FRONTEND_DIST, NEX_ENV_FILE.
- Dependencias: fastapi, uvicorn, httpx, python-dotenv (so no venv desta pasta). Desfazer: apagar esta pasta.
