using System.Text.Json;
using System.Text.RegularExpressions;

namespace LocalAi.Api.Storage;

/// <summary>Persistência simples: um arquivo JSON por conversa.</summary>
public partial class ConversationStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _dir;
    private readonly object _lock = new();

    public ConversationStore(string dir)
    {
        _dir = dir;
        Directory.CreateDirectory(dir);
    }

    [GeneratedRegex("^[a-f0-9]{32}$")]
    private static partial Regex IdPattern();

    private string PathFor(string id) => Path.Combine(_dir, id + ".json");

    public List<ConversationSummary> List()
    {
        lock (_lock)
        {
            var list = new List<ConversationSummary>();
            foreach (var file in Directory.EnumerateFiles(_dir, "*.json"))
            {
                try
                {
                    var c = JsonSerializer.Deserialize<Conversation>(File.ReadAllText(file), Json);
                    if (c is not null) list.Add(new ConversationSummary(c.Id, c.Title, c.UpdatedAt));
                }
                catch (JsonException) { /* arquivo corrompido: ignora */ }
            }
            return list.OrderByDescending(c => c.UpdatedAt).ToList();
        }
    }

    public Conversation Create()
    {
        var now = DateTime.UtcNow;
        var c = new Conversation { Id = Guid.NewGuid().ToString("N"), CreatedAt = now, UpdatedAt = now };
        Save(c);
        return c;
    }

    public Conversation? Get(string id)
    {
        if (!IdPattern().IsMatch(id)) return null;
        lock (_lock)
        {
            var path = PathFor(id);
            return File.Exists(path) ? JsonSerializer.Deserialize<Conversation>(File.ReadAllText(path), Json) : null;
        }
    }

    public void Save(Conversation c)
    {
        c.UpdatedAt = DateTime.UtcNow;
        lock (_lock) File.WriteAllText(PathFor(c.Id), JsonSerializer.Serialize(c, Json));
    }

    public bool Delete(string id)
    {
        if (!IdPattern().IsMatch(id)) return false;
        lock (_lock)
        {
            var path = PathFor(id);
            if (!File.Exists(path)) return false;
            File.Delete(path);
            return true;
        }
    }
}
