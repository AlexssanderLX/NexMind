"""Garante que TODA ferramenta do Nex tem descricao no formato explicito (o modelo pequeno depende disso).

python -m unittest backend.Mcp.test_tool_docs   (a partir da raiz)
"""

import ast
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = ("O QUE FAZ:", "QUANDO USAR:", "NÃO FAÇA:", "RETORNA:")
MAX_CHARS = 1100  # cada descricao vai no prompt: custo de contexto


def tool_docstrings(path: Path) -> dict[str, str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if any(isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "tool" for d in node.decorator_list):
                out[node.name] = ast.get_docstring(node) or ""
    return out


class ToolDocTests(unittest.TestCase):
    def check(self, name: str, doc: str):
        for marker in REQUIRED:
            self.assertIn(marker, doc, f"{name}: falta '{marker}'")
        self.assertLessEqual(len(doc), MAX_CHARS, f"{name}: descricao com {len(doc)} caracteres (max {MAX_CHARS})")

    def test_navegador(self):
        docs = tool_docstrings(ROOT / "backend/Mcp/Browser/server.py")
        self.assertGreaterEqual(len(docs), 7)
        for name, doc in docs.items():
            self.check(name, doc)

    def test_computador(self):
        docs = tool_docstrings(ROOT / "backend/Mcp/Desktop/server.py")
        self.assertGreaterEqual(len(docs), 7)
        for name, doc in docs.items():
            self.check(name, doc)

    def test_arquivos_tem_descricao_para_cada_ferramenta_liberada(self):
        cfg = json.loads((ROOT / "backend/mcp_servers.json").read_text(encoding="utf-8"))["mcpServers"]["arquivos"]
        descriptions = cfg.get("descriptions", {})
        for tool in cfg["allowedTools"]:
            self.assertIn(tool, descriptions, f"arquivos/{tool}: sem descricao em mcp_servers.json")
            self.check("arquivos/" + tool, descriptions[tool])

    def test_a_descricao_cita_so_ferramentas_que_existem(self):
        browser = set(tool_docstrings(ROOT / "backend/Mcp/Browser/server.py"))
        desktop = set(tool_docstrings(ROOT / "backend/Mcp/Desktop/server.py"))
        cfg = json.loads((ROOT / "backend/mcp_servers.json").read_text(encoding="utf-8"))["mcpServers"]["arquivos"]
        files = set(cfg["allowedTools"])
        known = browser | desktop | files
        import re
        for name, doc in {**tool_docstrings(ROOT / "backend/Mcp/Browser/server.py"), **tool_docstrings(ROOT / "backend/Mcp/Desktop/server.py"), **cfg["descriptions"]}.items():
            for cited in re.findall(r"\b(?:browser|desktop)_[a-z_]+\b|\b(?:read_text_file|list_directory|search_files|get_file_info|write_file|edit_file)\b", doc):
                self.assertIn(cited, known, f"{name} cita a ferramenta inexistente {cited}")


if __name__ == "__main__":
    unittest.main()
