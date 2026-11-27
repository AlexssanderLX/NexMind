"""Confere, com as chaves do .env (nunca impressas), se os modelos pedidos existem em cada provedor (GET /models). So leitura."""
import os, sys, httpx
from pathlib import Path
from dotenv import dotenv_values

env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
WANT = {
    "NVIDIA": "nvidia/nemotron-3.5-bolt-e4b",
    "GROQ": "qwen/qwen3.8-27b",
    "CLOUDFLARE": "@cf/meta/llama-3.1-8b-instruct-fast",
    "AION": "aion-labs/aion-3.0-mini",
    "CEREBRAS": "qwen-3.8-27b",
    "OPENROUTER": "nvidia/nemotron-3.5-lightning:free",
}
for prov, want in WANT.items():
    base = (env.get(f"{prov}_BASE_URL") or "").rstrip("/")
    key = env.get(f"{prov}_API_KEY") or env.get("CLOUDFLARE_API_TOKEN" if prov == "CLOUDFLARE" else "")
    default = env.get(f"{prov}_DEFAULT_MODEL")
    print(f"\n== {prov}  base={'ok' if base else 'FALTA'}  chave={'ok' if key else 'FALTA'}  modelo padrao do .env: {default}")
    if not base or not key:
        continue
    try:
        url = base + ("/models" if prov != "CLOUDFLARE" else "/models/search")
        r = httpx.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=20)
        print("   GET models ->", r.status_code)
        if r.status_code != 200:
            print("   ", r.text[:200].replace(key, "***"))
            continue
        data = r.json()
        items = data.get("data") or data.get("result") or data.get("models") or []
        ids = [(m.get("id") or m.get("name") or "") for m in items if isinstance(m, dict)]
        print(f"   {len(ids)} modelos; pedido '{want}' existe: {want in ids}; padrao existe: {default in ids}")
        close = [i for i in ids if any(t in i.lower() for t in want.lower().replace('/', ' ').replace('-', ' ').split() if len(t) > 3)][:8]
        print("   parecidos:", close)
    except Exception as e:  # noqa: BLE001
        print("   erro:", type(e).__name__, str(e)[:150])
