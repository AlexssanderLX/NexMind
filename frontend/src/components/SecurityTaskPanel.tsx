/** Os 6 estágios do ciclo de segurança (skill security-workbench): escopo primeiro, evidência por último. */
export const SECURITY_STAGES = [
  "Escopo & Autorização",
  "Mapear Superfície",
  "Formular Hipótese",
  "Teste Mínimo Seguro",
  "Interpretar Efeito",
  "Evidência & Relatório",
] as const;

type StageState = "done" | "active" | "pending";

const CARD: Record<StageState, string> = {
  active: "border-accent bg-accent/10 text-fg shadow-[0_0_20px_rgba(34,211,238,0.35),inset_0_0_14px_rgba(34,211,238,0.12)]",
  done: "border-emerald-400/40 bg-emerald-400/5 text-emerald-100 hover:border-emerald-300/70",
  pending: "border-white/10 bg-black/25 text-mute hover:border-accent/40 hover:text-fg",
};

const BADGE: Record<StageState, string> = {
  active: "bg-accent text-bg",
  done: "bg-emerald-400/20 text-emerald-300",
  pending: "bg-white/10 text-mute",
};

const LABEL: Record<StageState, string> = { done: "concluída", active: "em andamento", pending: "pendente" };

/**
 * Barra dos 6 estágios, na largura TOTAL da área de conversa: grade de 6 colunas (3 em telas médias, 2 nas pequenas),
 * um cartão por estágio com o número em destaque, borda luminosa no ativo e ✓ nos já concluídos.
 * Clicar num cartão marca aquele estágio como o atual (os anteriores ficam concluídos).
 * A fila de tarefas dos multi-agentes ainda é um stub: entra com a integração do board.json de sessão.
 */
export default function SecurityTaskPanel({
  stage = 0,
  onSelectStage,
  queue = [],
}: {
  stage?: number;
  onSelectStage?: (index: number) => void;
  queue?: { id: string; title: string; state: string }[];
}) {
  return (
    <section aria-label="Sessão de segurança" className="w-full px-4 pb-2">
      <ol className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        {SECURITY_STAGES.map((name, i) => {
          const state: StageState = i < stage ? "done" : i === stage ? "active" : "pending";
          return (
            <li key={name} aria-current={state === "active" ? "step" : undefined} data-stage-state={state}>
              <button
                type="button"
                onClick={() => onSelectStage?.(i)}
                title={`Marcar "${name}" como a etapa atual`}
                className={`flex h-full w-full flex-col items-start gap-1.5 rounded-xl border px-3 py-3 text-left backdrop-blur-md transition-all ${CARD[state]}`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${BADGE[state]}`}>
                  {state === "done" ? "✓" : i}
                </span>
                <span className="text-[13px] font-medium leading-tight">{name}</span>
                <span className="text-[10px] uppercase tracking-wide opacity-70">{LABEL[state]}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-mute">
        {queue.length === 0 ? "Fila de tarefas dos agentes: vazia. Defina o escopo para começar." : `Fila de tarefas dos agentes: ${queue.length}`}
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
