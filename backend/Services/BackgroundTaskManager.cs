using System.Collections.Concurrent;

namespace LocalAi.Api.Services;

public sealed record ActiveTaskInfo(string Id, string ConversationId, string Mode, string Title, DateTime StartedAt);

/// <summary>
/// Gerenciador de tarefas desacopladas em background.
/// Permite que uma investigação de OSINT ou geração do LLM continue rodando mesmo se o usuário der F5,
/// trocar de modo (Security -> Dev) ou fechar a aba, gravando o resultado final na conversa.
/// </summary>
public sealed class BackgroundTaskManager
{
    private readonly ConcurrentDictionary<string, (ActiveTaskInfo Info, CancellationTokenSource Cts)> _tasks = new();

    public ActiveTaskInfo StartTask(string conversationId, string mode, string title, out CancellationToken taskCt)
    {
        var id = Guid.NewGuid().ToString("n")[..8];
        var info = new ActiveTaskInfo(id, conversationId, mode, title, DateTime.UtcNow);
        var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5)); // timeout de segurança de 5 minutos
        _tasks[id] = (info, cts);
        taskCt = cts.Token;
        return info;
    }

    public void FinishTask(string id)
    {
        if (_tasks.TryRemove(id, out var item))
        {
            try { item.Cts.Dispose(); } catch { }
        }
    }

    public void CancelTask(string id)
    {
        if (_tasks.TryRemove(id, out var item))
        {
            try { item.Cts.Cancel(); } catch { }
            try { item.Cts.Dispose(); } catch { }
        }
    }

    public IReadOnlyList<ActiveTaskInfo> ListActive() =>
        _tasks.Values.Select(v => v.Info).OrderByDescending(t => t.StartedAt).ToList();
}
