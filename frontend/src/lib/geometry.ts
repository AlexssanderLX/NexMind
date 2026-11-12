// Geometria das janelas flutuantes. Funções puras, com testes em frontend/tests.

/**
 * Mantém uma janela de tamanho `size` INTEIRA dentro da área `bounds`, sem cortar nenhuma borda.
 * Usa o tamanho REAL da janela: reservar só o tamanho de uma bolinha fazia painéis altos saírem da tela nos cantos.
 */
export function clampWindow(pos: { x: number; y: number }, bounds: { w: number; h: number }, size: { w: number; h: number }) {
  return {
    x: Math.max(0, Math.min(pos.x, Math.max(0, bounds.w - size.w))),
    y: Math.max(0, Math.min(pos.y, Math.max(0, bounds.h - size.h))),
  };
}
