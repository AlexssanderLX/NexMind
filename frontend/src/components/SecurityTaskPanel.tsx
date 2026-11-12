/** Os 6 estágios do ciclo de segurança (skill security-workbench): escopo primeiro, evidência por último. */
export const SECURITY_STAGES = [
  "Escopo & Autorização",
  "Mapear Superfície",
  "Formular Hipótese",
  "Teste Mínimo Seguro",
  "Interpretar Efeito",
  "Evidência & Relatório",
] as const;

/**
 * Painel do modo Security (stub). Mostra o pipeline dos 6 estágios e a fila de tarefas dos multi-agentes.
 * Ainda sem dados: a integração com o board.json de sessão vem na próxima tarefa; aqui só a estrutura visual.
 */
export default function SecurityTaskPanel({ stage = 0, queue = [] }: { stage?: number; queue?: { id: string; title: string; state: string }[] }) {
  return (
    <section aria-label="Sessão de segurança" className="mx-6 mb-2 rounded-xl border border-accent/20 bg-black/20 px-3 py-2 text-xs backdrop-blur-md">
      <ol className="flex flex-wrap items-center gap-1.5">
        {SECURITY_STAGES.map((name, i) => (
          <li
            key={name}
            aria-current={i === stage ? "step" : undefined}
            className={`rounded-full border px-2.5 py-0.5 ${
              i === stage ? "border-accent/60 bg-accent/15 text-accent" : i < stage ? "border-emerald-400/30 text-emerald-300" : "border-white/10 text-mute"
            }`}
          >
            {i}. {name}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-mute">
        {queue.length === 0 ? "Fila de tarefas dos agentes: vazia. Defina o escopo para começar." : `Fila de tarefas dos agentes: ${queue.length}`}
      </p>
      {queue.length > 0 && (
        <ul className="mt-1 space-y-0.5">
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
