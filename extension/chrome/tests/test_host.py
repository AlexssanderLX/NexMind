"""Testa o NexChromeHost.exe isolado, com Chrome e Nex falsos, em porta alta e token temporário.

Uso: python extension/chrome/tests/test_host.py   (compila o host com o csc do .NET Framework)
Não abre porta de depuração e não toca no Chrome nem no host instalado.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "host" / "NexChromeHost.cs"
CSC = Path(os.environ["WINDIR"]) / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe"
PORT = 19334


def frame(obj) -> bytes:
    body = json.dumps(obj).encode()
    return len(body).to_bytes(4, "little") + body


def read_frame(sock_or_file, timeout=5.0):
    """Lê um quadro de um socket ou de um pipe."""
    def read_exact(n):
        buf = b""
        while len(buf) < n:
            if hasattr(sock_or_file, "settimeout"):
                sock_or_file.settimeout(timeout)
                chunk = sock_or_file.recv(n - len(buf))
            else:
                chunk = sock_or_file.read(n - len(buf))
            if not chunk:
                raise EOFError
            buf += chunk
        return buf
    n = int.from_bytes(read_exact(4), "little")
    return json.loads(read_exact(n))


class FakeNex:
    def __init__(self):
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", PORT))
        self.srv.listen(5)
        self.srv.settimeout(8)

    def accept(self):
        conn, _ = self.srv.accept()
        return conn

    def close(self):
        self.srv.close()


def start_host(exe, token_file):
    env = dict(os.environ, NEX_BROWSER_PORT=str(PORT), NEX_BROWSER_TOKEN_FILE=str(token_file))
    return subprocess.Popen([str(exe)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)


def wait_exit(proc, seconds):
    try:
        proc.wait(timeout=seconds)
        return True
    except subprocess.TimeoutExpired:
        return False


results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("OK   " if cond else "FALHA"), name, detail)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="nexhost-"))
    exe = tmp / "NexChromeHost.exe"
    r = subprocess.run([str(CSC), "/nologo", f"/out:{exe}", str(SRC)], capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        sys.exit("compilação falhou")
    check("compila com o csc do .NET Framework (C# 5)", True)
    token_file = tmp / "token"

    # A) Nex ausente + token presente: fica vivo tentando; ao Chrome soltar o stdin, sai logo (nada de órfão)
    token_file.write_text("abc123", encoding="ascii")
    p = start_host(exe, token_file)
    time.sleep(2.5)
    check("A1 sem Nex escutando, o host continua vivo (nada de 'Native host has exited')", p.poll() is None)
    p.stdin.close()
    check("A2 stdin fechado durante a espera: o host encerra em ate 3 s", wait_exit(p, 3))

    # B) sem token: não conecta a lugar nenhum, fica vivo e sai quando o Chrome solta
    token_file.unlink()
    nex = FakeNex()
    nex.srv.settimeout(3)
    p = start_host(exe, token_file)
    try:
        nex.accept()
        check("B1 sem token o host NAO conecta", False)
    except socket.timeout:
        check("B1 sem token o host NAO conecta", True)
    check("B2 sem token continua vivo", p.poll() is None)
    p.stdin.close()
    check("B3 sem token sai ao fechar o stdin", wait_exit(p, 3))

    # C) caminho feliz: hello com o token, relay nos dois sentidos
    token_file.write_text("segredo-de-teste", encoding="ascii")
    nex.srv.settimeout(8)
    p = start_host(exe, token_file)
    conn = nex.accept()
    hello = read_frame(conn)
    check("C1 primeiro quadro e o hello com o token", hello == {"hello": "segredo-de-teste"}, str(hello))
    p.stdin.write(frame({"id": 1, "ok": True, "result": {"x": 1}}))
    p.stdin.flush()
    check("C2 Chrome -> Nex chega inteiro", read_frame(conn) == {"id": 1, "ok": True, "result": {"x": 1}})
    conn.sendall(frame({"id": 2, "op": "get_dom"}))
    check("C3 Nex -> Chrome chega inteiro", read_frame(p.stdout) == {"id": 2, "op": "get_dom"})
    big = {"id": 3, "text": "ç" * 20000}
    conn.sendall(frame(big))
    check("C4 quadro grande (UTF-8) passa", read_frame(p.stdout) == big)

    # D) o Nex cai: o host reconecta sozinho e volta a fazer hello
    conn.close()
    conn2 = nex.accept()
    check("D1 apos queda do Nex o host reconecta", read_frame(conn2) == {"hello": "segredo-de-teste"})
    conn2.sendall(frame({"id": 9, "op": "release"}))
    check("D2 e voltou a repassar", read_frame(p.stdout) == {"id": 9, "op": "release"})

    # E) Chrome solta o host com o Nex conectado: sai
    p.stdin.close()
    check("E1 stdin fechado com Nex conectado: encerra", wait_exit(p, 3))
    conn2.close()

    # F) quadro absurdo do Nex é descartado sem derrubar o host na hora de ler o próximo
    nex.srv.settimeout(8)
    p = start_host(exe, token_file)
    conn3 = nex.accept()
    read_frame(conn3)
    conn3.sendall((50 * 1024 * 1024).to_bytes(4, "little"))
    time.sleep(0.5)
    conn4 = nex.accept()
    check("F1 quadro acima de 1 MB: o host descarta a sessao e reconecta", read_frame(conn4) == {"hello": "segredo-de-teste"})
    p.stdin.close()
    wait_exit(p, 3)
    p.kill() if p.poll() is None else None
    nex.close()

    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} verificacoes ok")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
