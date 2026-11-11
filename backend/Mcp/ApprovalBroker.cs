using System.Collections.Concurrent;

namespace LocalAi.Api.Mcp;

/// <summary>
/// Aprovação humana (HITL): o chat pausa numa ferramenta que muda estado e espera o clique do usuário
/// (POST /api/approvals/{id}). Sem resposta em 2 minutos, conta como rejeitada.
/// </summary>
public sealed class ApprovalBroker
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource<bool>> _pending = new();
    public static readonly TimeSpan Timeout = TimeSpan.FromMinutes(2);

    public string Open(out Task<bool> decision)
    {
        var id = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        decision = tcs.Task;
        return id;
    }

    public bool Resolve(string id, bool approved) => _pending.TryGetValue(id, out var t) && t.TrySetResult(approved);

    public void Close(string id) => _pending.TryRemove(id, out _);
}
