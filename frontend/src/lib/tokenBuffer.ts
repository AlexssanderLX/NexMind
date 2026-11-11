/**
 * Agrupa os tokens que chegam em streaming e entrega em lotes.
 *
 * Sem isso, cada token (~44 por segundo) re-renderiza a mensagem inteira, com markdown e fórmulas: o custo cresce
 * com o tamanho do texto (medido: ~72% de um núcleo para uma resposta de 3000 caracteres). Em lotes o custo cai
 * várias vezes. O intervalo aumenta com o tamanho da resposta (150 ms → 700 ms), porque renderizar um texto
 * longo custa mais e ninguém lê tão rápido quanto o modelo escreve.
 */
export function createTokenBuffer(apply: (content: string, thinking: string) => void) {
  let content = "";
  let thinking = "";
  let contentTotal = 0;
  let timer: number | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!content && !thinking) return;
    const c = content;
    const t = thinking;
    content = "";
    thinking = "";
    apply(c, t);
  };

  return {
    push(kind: "content" | "thinking", text: string) {
      if (kind === "content") {
        content += text;
        contentTotal += text.length;
      } else {
        thinking += text; // texto simples: barato de renderizar
      }
      if (timer === null) timer = window.setTimeout(flush, Math.min(700, 150 + contentTotal / 8));
    },
    /** Entrega o que estiver pendente agora (fim da resposta, erro ou parada). */
    flush,
  };
}
