"""
Servidor MCP "desktop": Computer Use no Windows para o Nex.

Modelo híbrido e leve: enxerga o desktop em TEXTO (lista de janelas e controles pela API de acessibilidade do Windows,
via pywinauto/UIA), sem prints contínuos, e age com mouse/teclado reais (PyAutoGUI). O Nex (host MCP) exige aprovação do
usuário para tudo que age (clique, digitação, atalhos): ver `requiresApproval` em backend/mcp_servers.json.

Segurança: o Fail-Safe do PyAutoGUI fica SEMPRE ligado: puxar o mouse para um canto da tela aborta a ação.
Transporte: stdio (JSON-RPC 2.0) pelo SDK oficial `mcp`. Nada pode ser impresso em stdout (é o canal do protocolo).
"""
import ctypes
import os
import re
import time
from ctypes import wintypes
from pathlib import Path

# coordenadas reais de tela (sem escala de DPI), para o clique cair onde o UIA diz
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:  # noqa: BLE001
    pass

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("desktop")

MAX_ROWS = 60  # texto pequeno: cada linha custa contexto do modelo
UIA_BUDGET_S = 8  # janelas como navegadores têm milhares de elementos: para de procurar
INTERACTIVE = {
    "Button", "Edit", "MenuItem", "Hyperlink", "CheckBox", "RadioButton", "ComboBox", "TabItem",
    "ListItem", "TreeItem", "Document", "SplitButton", "MenuBar", "ToolBar",
}
SHOTS_DIR = Path(__file__).resolve().parents[2] / "data" / "mcp" / "desktop" / "shots"


def _pag():
    """PyAutoGUI com o Fail-Safe obrigatoriamente ligado."""
    import pyautogui

    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.05
    return pyautogui


def _fail(e: Exception) -> str:
    name = type(e).__name__
    if name == "FailSafeException":
        return "ABORTADO: o mouse foi levado a um canto da tela (fail-safe). Nada mais foi executado."
    return f"ERRO ({name}): {e}"


# ---------- janelas (Win32, rápido, sem UIA)
_user32 = ctypes.windll.user32
_user32.IsWindowVisible.argtypes = [wintypes.HWND]
_user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
_user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
_ENUM = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)


def _cloaked(hwnd) -> bool:
    """Janelas UWP em segundo plano ficam 'visíveis' porém ocultas (cloaked): não contam."""
    val = ctypes.c_int(0)
    try:
        ctypes.windll.dwmapi.DwmGetWindowAttribute(hwnd, 14, ctypes.byref(val), ctypes.sizeof(val))
    except Exception:  # noqa: BLE001
        return False
    return val.value != 0


def _visible_titles() -> list[str]:
    titles: list[str] = []

    def cb(hwnd, _):
        if _user32.IsWindowVisible(hwnd) and not _cloaked(hwnd):
            n = _user32.GetWindowTextLengthW(hwnd)
            if n > 0:
                buf = ctypes.create_unicode_buffer(n + 1)
                _user32.GetWindowTextW(hwnd, buf, n + 1)
                t = buf.value.strip()
                if t and t != "Program Manager" and t not in titles:
                    titles.append(t)
        return True

    _user32.EnumWindows(_ENUM(cb), 0)
    return titles


def _find_window(title: str):
    from pywinauto import Desktop

    t = title.strip().lower()
    wins = [w for w in Desktop(backend="uia").windows() if w.is_visible() and w.window_text()]
    exact = [w for w in wins if w.window_text().lower() == t]
    part = [w for w in wins if t in w.window_text().lower()]
    pick = exact or part
    if not pick:
        raise ValueError(f"Nenhuma janela visível com o título '{title}'. Use desktop_list_windows.")
    return pick[0]


def _controls(win):
    """Gera (tipo, nome, id) dos controles úteis da janela, com limite de itens e de tempo."""
    start = time.time()
    seen: set[tuple[str, str]] = set()
    it = win.iter_descendants() if hasattr(win, "iter_descendants") else iter(win.descendants())
    for c in it:
        if time.time() - start > UIA_BUDGET_S:
            return
        try:
            info = c.element_info
            ctype, name = info.control_type, (info.name or "").strip()
        except Exception:  # noqa: BLE001
            continue
        if ctype in INTERACTIVE and name and (ctype, name) not in seen:
            seen.add((ctype, name))
            yield c, ctype, name, (getattr(info, "automation_id", "") or "")


@mcp.tool()
def desktop_list_windows() -> str:
    """Lista os títulos das janelas abertas e visíveis no Windows (texto simples, sem imagem)."""
    try:
        titles = _visible_titles()
        if not titles:
            return "Nenhuma janela visível."
        return "Janelas abertas:\n" + "\n".join(f"- {t}" for t in titles[:40])
    except Exception as e:  # noqa: BLE001
        return _fail(e)


@mcp.tool()
def desktop_inspect_window(title: str) -> str:
    """Traz a janela para o foco e lista seus principais botões e controles (tipo e nome), em texto."""
    try:
        win = _find_window(title)
        try:
            win.set_focus()
        except Exception:  # noqa: BLE001
            pass  # alguns apps recusam foco; a listagem ainda funciona
        rows = []
        for _c, ctype, name, aid in _controls(win):
            rows.append(f"[{ctype}] {name}" + (f" (id={aid})" if aid else ""))
            if len(rows) >= MAX_ROWS:
                rows.append("[…lista cortada: use um nome mais específico em desktop_click_element]")
                break
        head = f"Janela: {win.window_text()}"
        return head + ("\n" + "\n".join(rows) if rows else "\n(nenhum controle nomeado encontrado)")
    except Exception as e:  # noqa: BLE001
        return _fail(e)


@mcp.tool()
def desktop_click_element(window_title: str, element_name: str) -> str:
    """Acha um botão/elemento pelo nome dentro da janela, move o mouse até o centro dele e clica."""
    try:
        pag = _pag()
        win = _find_window(window_title)
        try:
            win.set_focus()
        except Exception:  # noqa: BLE001
            pass
        want = element_name.strip().lower()
        exact = part = None
        for c, _t, name, _a in _controls(win):
            if name.lower() == want:
                exact = c
                break
            if part is None and want in name.lower():
                part = c
        target = exact or part
        if target is None:
            return f"Elemento '{element_name}' não encontrado em '{win.window_text()}'. Use desktop_inspect_window."
        r = target.rectangle()
        x, y = (r.left + r.right) // 2, (r.top + r.bottom) // 2
        w, h = pag.size()
        if not (0 <= x < w and 0 <= y < h):
            return f"O elemento está fora da tela ({x},{y})."
        pag.moveTo(x, y, duration=0.3)
        pag.click()
        return f"Cliquei em '{element_name}' ({x},{y})."
    except Exception as e:  # noqa: BLE001
        return _fail(e)


@mcp.tool()
def desktop_mouse_click(x: int, y: int, button: str = "left", clicks: int = 1) -> str:
    """Move o mouse para (x, y) da tela e clica. button: left, right ou middle. clicks: 1 a 3."""
    try:
        pag = _pag()
        if button not in ("left", "right", "middle"):
            return "button deve ser left, right ou middle."
        clicks = max(1, min(int(clicks), 3))
        w, h = pag.size()
        if not (0 <= x < w and 0 <= y < h):
            return f"({x},{y}) está fora da tela ({w}x{h})."
        pag.moveTo(x, y, duration=0.3)
        pag.click(button=button, clicks=clicks)
        return f"Cliquei ({button} x{clicks}) em ({x},{y})."
    except Exception as e:  # noqa: BLE001
        return _fail(e)


@mcp.tool()
def desktop_type(text: str) -> str:
    """Digita o texto na janela/campo que está em foco (aceita acentos). \\n vira Enter."""
    try:
        _pag()  # garante o fail-safe ligado
        from pywinauto import keyboard

        if len(text) > 2000:
            return "Texto longo demais (máximo 2000 caracteres por chamada)."
        # send_keys trata { } ( ) + ^ % ~ como comandos: escapa para digitar literalmente
        esc = re.sub(r"([{}()+^%~])", r"{\1}", text).replace("\r\n", "\n").replace("\n", "{ENTER}")
        keyboard.send_keys(esc, with_spaces=True, with_tabs=True, pause=0.01)
        return f"Digitei {len(text)} caracteres."
    except Exception as e:  # noqa: BLE001
        return _fail(e)


@mcp.tool()
def desktop_press_hotkey(keys: list[str]) -> str:
    """Pressiona uma tecla ou combinação, ex.: ["ctrl","s"], ["alt","tab"], ["enter"], ["win"]."""
    try:
        pag = _pag()
        norm = [k.strip().lower() for k in keys if k.strip()]
        if not norm:
            return "Informe ao menos uma tecla."
        bad = [k for k in norm if k not in pag.KEYBOARD_KEYS]
        if bad:
            return f"Teclas desconhecidas: {', '.join(bad)}."
        pag.hotkey(*norm) if len(norm) > 1 else pag.press(norm[0])
        return "Pressionei " + "+".join(norm) + "."
    except Exception as e:  # noqa: BLE001
        return _fail(e)


@mcp.tool()
def desktop_take_screenshot(filename: str = "") -> str:
    """Captura a tela inteira sob demanda e salva em arquivo; devolve só o caminho e o tamanho (o Nex não lê imagens)."""
    try:
        pag = _pag()
        SHOTS_DIR.mkdir(parents=True, exist_ok=True)
        base = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.basename(filename)) or time.strftime("tela-%Y%m%d-%H%M%S")
        if not base.lower().endswith(".png"):
            base += ".png"
        path = SHOTS_DIR / base
        img = pag.screenshot()
        img.save(path)
        return f"Captura salva em {path} ({img.width}x{img.height})."
    except Exception as e:  # noqa: BLE001
        return _fail(e)


if __name__ == "__main__":
    mcp.run(transport="stdio")
