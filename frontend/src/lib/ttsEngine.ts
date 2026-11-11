// Escolha do motor de fala quando o Piper não está instalado (o servidor responde 503). Funções puras, com teste em frontend/tests.

/** Motor a usar agora: o pedido nos ajustes, ou a voz do Windows se o servidor já recusou esse motor. */
export function pickEngine(wanted: string, failed: string | null): string {
  return failed === wanted && wanted !== "sapi" ? "sapi" : wanted;
}

/** 503 de um motor que não é a voz do Windows = motor indisponível: cai na voz do Windows em vez de deixar o Nex mudo. */
export function shouldFallBack(status: number, engine: string): boolean {
  return status === 503 && engine !== "sapi";
}
