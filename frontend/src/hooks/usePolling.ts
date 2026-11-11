import { useEffect, useRef } from "react";

/**
 * Executa `fn` agora e depois a cada `intervalMs`, mas só enquanto a aba está visível.
 * Ao voltar para a aba, atualiza na hora. Mudar o intervalo reinicia a consulta (e já consulta de novo).
 */
export function usePolling(fn: () => unknown, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) fnRef.current();
    };
    const onVisible = () => {
      if (!document.hidden) fnRef.current();
    };
    fnRef.current(); // primeira consulta sempre, mesmo que a aba abra em segundo plano
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
