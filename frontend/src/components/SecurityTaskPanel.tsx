import { VAULTS, vaultBadge, type VaultKey } from "../lib/vaults";

/**
 * As 6 Gavetas de Dados da Investigação, na largura TOTAL da área de conversa (6 colunas; 3 em telas médias, 2 nas pequenas).
 * Pentest não é linear: não há etapa atual nem "pendente". Cada cartão mostra o ícone, o nome e quantos itens a gaveta tem;
 * clicar em qualquer um, a qualquer momento, abre a gaveta para ver, editar e salvar (o que ele edita é o que os agentes consultam).
 * A fila de tarefas dos multi-agentes ainda é um stub: entra com a integração do board.json de sessão.
 */
export default function SecurityTaskPanel({
  counts = {},
  onOpen,
  queue = [],
}: {
  counts?: Partial<Record<VaultKey, number>>;
  onOpen?: (key: VaultKey) => void;
  queue?: { id: string; title: string; state: string }[];
}) {
  return (
    <section aria-label="Gavetas da investigação" className="w-full px-4 pb-2">
      <ul className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        {VAULTS.map((v) => {
          const count = counts[v.key] ?? 0;
          return (
            <li key={v.key} data-vault={v.key} data-count={count}>
              <button
                type="button"
                onClick={() => onOpen?.(v.key)}
                title={`Abrir "${v.name}" para ver e editar (${v.hint})`}
                className="group flex h-full w-full flex-col items-start gap-1.5 rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-left text-fg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/5 hover:shadow-[0_0_20px_rgba(34,211,238,0.25)] focus-visible:border-accent focus-visible:outline-none"
              >
                <span className="text-xl leading-none" aria-hidden>
                  {v.icon}
                </span>
                <span className="text-[13px] font-medium leading-tight">{v.name}</span>
                <span className={`text-[10px] uppercase tracking-wide ${count ? "text-accent" : "text-mute opacity-70"}`}>{vaultBadge(v.key, count)}</span>
                <span className="text-[10px] text-mute opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">clique para editar</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-mute">
        {queue.length === 0 ? "Bancada pronta: mapeie superfícies, formule hipóteses ou inspecione parâmetros livremente." : `Fila de tarefas dos agentes: ${queue.length}`}
      </p>
      {queue.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {queue.map((t) => (
            <li key={t.id} className="flex justify-between gap-2 text-mute">
              <span className="truncate">{t.title}</span>
              <span className="shrink-0 uppercase tracking-wide text-accent/80">{t.state}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
