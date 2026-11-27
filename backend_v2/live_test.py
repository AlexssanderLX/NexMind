"""Uma pergunta curta REAL a cada modelo do dropdown, pelo backend V2 em 5080. Mede o 1o byte, o total e conta eventos. Gasta ~1 requisicao por modelo."""
import json, sys, time, httpx

BASE = "http://127.0.0.1:5080"
PROMPT = "Responda em portugues, em no maximo 2 frases: o que e um buffer overflow?"
models = [m["name"] for m in httpx.get(f"{BASE}/api/status").json()["models"]]
for name in models:
    cid = httpx.post(f"{BASE}/api/conversations").json()["id"]
    t0 = time.perf_counter()
    first = None
    counts = {"thinking": 0, "token": 0}
    think_chars = ans_chars = 0
    done = err = None
    with httpx.stream("POST", f"{BASE}/api/conversations/{cid}/chat", json={"content": PROMPT, "model": name}, timeout=150) as r:
        ctype = r.headers.get("content-type")
        for line in r.iter_lines():
            if not line.strip():
                continue
            ev = json.loads(line)
            if first is None and ev["type"] in ("thinking", "token"):
                first = time.perf_counter() - t0
            if ev["type"] in counts:
                counts[ev["type"]] += 1
                if ev["type"] == "thinking":
                    think_chars += len(ev["text"])
                else:
                    ans_chars += len(ev["text"])
            elif ev["type"] == "done":
                done = ev["stats"]
            elif ev["type"] == "error":
                err = ev["message"]
    total = time.perf_counter() - t0
    print(f"\n== {name}")
    print(f"   content-type: {ctype}")
    if err:
        print(f"   ERRO: {err[:300]}")
        continue
    print(f"   1o fragmento: {first:.2f}s | total: {total:.2f}s | eventos: {counts['thinking']} thinking ({think_chars} car.), {counts['token']} token ({ans_chars} car.)")
    print(f"   stats: {done}")
    conv = httpx.get(f"{BASE}/api/conversations/{cid}").json()
    last = conv["messages"][-1]
    print(f"   resposta: {last['content'][:160]!r}")
    httpx.delete(f"{BASE}/api/conversations/{cid}")
