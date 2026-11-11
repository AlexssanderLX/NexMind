"""Servidor MCP do navegador visível do Nex. Transporte: stdio, SDK oficial mcp."""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from playwright.async_api import Browser, Page, Playwright, async_playwright

mcp = FastMCP("nex-browser")

_playwright: Playwright | None = None
_browser: Browser | None = None
_page: Page | None = None
_cdp = False

_MAX_TOKENS = 1500
_CHARS_PER_TOKEN = 4

_CURSOR_JS = """
() => {
  if (document.getElementById("nex-virtual-mouse")) return;
  const style = document.createElement("style");
  style.textContent = "@keyframes nex-ripple{from{opacity:1;transform:translate(-50%,-50%) scale(1)}to{opacity:0;transform:translate(-50%,-50%) scale(3.2)}}";
  document.documentElement.appendChild(style);
  const cursor = document.createElement("div");
  cursor.id = "nex-virtual-mouse";
  cursor.style.cssText = "position:fixed;left:48px;top:48px;width:16px;height:16px;margin:0;border-radius:50%;background:#7CFF6B;box-shadow:0 0 0 2px #062;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)";
  document.documentElement.appendChild(cursor);
}
"""

_MOVE_JS = """
async ({ x, y }) => {
  const cursor = document.getElementById("nex-virtual-mouse");
  if (!cursor) return;
  const start = { x: parseFloat(cursor.style.left) || 48, y: parseFloat(cursor.style.top) || 48 };
  const bend = { x: (start.x + x) / 2 + 36, y: Math.min(start.y, y) - 28 };
  const duration = 260;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const u = 1 - t;
      cursor.style.left = (u * u * start.x + 2 * u * t * bend.x + t * t * x) + "px";
      cursor.style.top = (u * u * start.y + 2 * u * t * bend.y + t * t * y) + "px";
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
"""

_RIPPLE_JS = """
({ x, y }) => {
  const ripple = document.createElement("div");
  ripple.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:12px;height:12px;border:2px solid #7CFF6B;border-radius:50%;pointer-events:none;z-index:2147483647;animation:nex-ripple .35s ease-out forwards`;
  document.documentElement.appendChild(ripple);
  setTimeout(() => ripple.remove(), 400);
}
"""

_DOM_JS = """
() => {
  const nodes = Array.from(document.querySelectorAll("a, button, input, textarea, select"));
  const visible = nodes.filter((el) => {
    if (el.getAttribute("aria-hidden") === "true" || el.closest("[aria-hidden='true']")) return false;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width >= 2 && box.height >= 2 && style.visibility !== "hidden" && style.display !== "none";
  }).slice(0, 60);
  return visible.map((el, index) => {
    const id = index + 1;
    el.setAttribute("data-nex-id", String(id));
    const box = el.getBoundingClientRect();
    const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.getAttribute("type") || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    return { id, tag: el.tagName.toLowerCase(), label, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  });
}
"""


def _current() -> Page:
    if _page is None:
        raise RuntimeError("Nenhum navegador aberto. Chame browser_navigate primeiro.")
    return _page


async def _inject(page: Page) -> None:
    await page.evaluate(_CURSOR_JS)


async def _center(element_id: int) -> tuple[float, float]:
    page = _current()
    box = await page.locator(f'[data-nex-id="{element_id}"]').bounding_box()
    if box is None:
        raise RuntimeError(f"Elemento [{element_id}] não está visível. Chame browser_get_dom de novo.")
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


async def _move(page: Page, x: float, y: float) -> None:
    await _inject(page)
    await page.evaluate(_MOVE_JS, {"x": x, "y": y})


async def _attach() -> Page:
    """Conecta no Chrome da porta 9222 e usa a aba visível."""
    global _browser, _page, _cdp
    assert _playwright is not None
    _browser = await _playwright.chromium.connect_over_cdp("http://127.0.0.1:9222")
    context = _browser.contexts[0] if _browser.contexts else await _browser.new_context()
    _cdp = True
    existing = [p for p in context.pages if not p.url.startswith("devtools")]
    _page = existing[-1] if existing else await context.new_page()
    await context.add_init_script("(" + _CURSOR_JS + ")();")
    await _inject(_page)
    return _page


async def _ensure() -> Page:
    """Usa o Chrome da porta 9222. Se a porta falhar, abre um Chromium visível."""
    global _playwright, _browser, _page, _cdp
    if _page is not None:
        return _page
    _playwright = await async_playwright().start()
    try:
        return await _attach()
    except Exception:
        _browser = await _playwright.chromium.launch(headless=False)
        context = await _browser.new_context()
        _page = await context.new_page()
        _cdp = False
        await context.add_init_script("(" + _CURSOR_JS + ")();")
        await _inject(_page)
        return _page


def _clip(text: str) -> str:
    limit = _MAX_TOKENS * _CHARS_PER_TOKEN
    if len(text) <= limit:
        return text
    return text[:limit].rsplit("\n", 1)[0] + "\n[truncado em 1500 tokens]"


@mcp.tool()
async def browser_navigate(url: str) -> str:
    """Abre a URL no Chrome do usuário (porta 9222) ou num Chromium isolado, com o cursor do Nex."""
    page = await _ensure()
    await page.bring_to_front()
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await _inject(page)
    modo = "Chrome do usuário, sessão preservada" if _cdp else "Chromium isolado: o Chrome não estava na porta 9222"
    return f"Aberto ({modo}): {page.url}"


@mcp.tool()
async def browser_get_dom() -> str:
    """Lista links, botões e campos visíveis com ids [1], [2], ... em no máximo 1500 tokens."""
    page = await _ensure()
    await _inject(page)
    items = await page.evaluate(_DOM_JS)
    lines = [f"[{item['id']}] {item['tag']} {item['label']}".strip() for item in items if item["x"] > 0 or item["y"] > 0]
    if not lines:
        return "Nenhum elemento interativo visível."
    return _clip("\n".join(lines))


@mcp.tool()
async def browser_click(element_id: int) -> str:
    """Move o cursor até o elemento, mostra o clique e aciona o elemento."""
    page = _current()
    x, y = await _center(element_id)
    await _move(page, x, y)
    await page.evaluate(_RIPPLE_JS, {"x": x, "y": y})
    await page.locator(f'[data-nex-id="{element_id}"]').click(timeout=15000)
    return f"Clique em [{element_id}] em ({int(x)}, {int(y)})."


@mcp.tool()
async def browser_type(element_id: int, text: str, press_enter: bool = False) -> str:
    """Move o cursor até o campo, foca, digita e pode pressionar Enter."""
    page = _current()
    x, y = await _center(element_id)
    await _move(page, x, y)
    locator = page.locator(f'[data-nex-id="{element_id}"]')
    await locator.click(timeout=8000, force=True)
    await locator.fill("")
    await locator.type(text, delay=28)
    if press_enter:
        await locator.press("Enter")
    return f"Texto digitado em [{element_id}]."


@mcp.tool()
async def browser_close() -> str:
    """Solta o Chrome do usuário ou fecha o Chromium isolado."""
    global _playwright, _browser, _page, _cdp
    if _browser is not None:
        # No CDP, close() só desconecta. Não encerra a janela nem a sessão do usuário.
        await _browser.close()
    if _playwright is not None:
        await _playwright.stop()
    era_cdp = _cdp
    _browser = None
    _playwright = None
    _page = None
    _cdp = False
    return "Desconectado do Chrome. A janela continua aberta." if era_cdp else "Navegador isolado fechado."


def main() -> None:
    os.environ.setdefault("HEADLESS", "false")
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
