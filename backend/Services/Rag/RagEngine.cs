using System.Text.Json;
using LocalAi.Api.Rag.Digest;
using LocalAi.Api.Rag.Index;

namespace LocalAi.Api.Rag;

/// <summary>
/// Micro-RAG por conversa. Os arquivos grandes são fatiados na CPU e o índice BM25 fica em memória.
/// Disco: data/conversations/{id}/rag/{fileId}/manifest.json e chunks.json.
/// </summary>
public sealed class RagEngine
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _conversations;
    private readonly Bm25Index _index = new();
    private readonly object _gate = new();

    public RagEngine(string conversationsDir) => _conversations = conversationsDir;

    public string StartIngest(string conversationId, byte[] bytes, string fileName)
    {
        var fileId = Guid.NewGuid().ToString("N");
        _ = Task.Run(async () =>
        {
            try
            {
                await using var stream = new MemoryStream(bytes, writable: false);
                await IngestFileAsync(conversationId, stream, fileName, fileId);
            }
            catch (Exception ex)
            {
                TryWriteFailure(conversationId, fileId, fileName, bytes.Length, ex.Message);
            }
        });
        return fileId;
    }

    public async Task<RagFile> IngestFileAsync(string conversationId, Stream fileStream, string fileName, string? fileId = null, CancellationToken ct = default)
    {
        fileId ??= Guid.NewGuid().ToString("N");
        fileName = Path.GetFileName(fileName);
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        using var buffered = new MemoryStream();
        await fileStream.CopyToAsync(buffered, ct);
        var size = buffered.Length;
        buffered.Position = 0;

        string type;
        string summary;
        List<RagChunk> chunks;
        if (ImageOcrDigest.Extensions.Contains(ext))
        {
            (summary, chunks) = await ImageOcrDigest.ReadAsync(buffered, fileId, fileName, ct);
            type = "image";
        }
        else
        {
            (type, summary, chunks) = await TextAndLogDigest.ReadAsync(buffered, fileId, fileName, ct);
        }

        var file = new RagFile(fileId, fileName, ext, size, type, chunks.Count, summary, DateTime.UtcNow);
        var dir = Folder(conversationId, fileId);
        Directory.CreateDirectory(dir);
        await File.WriteAllTextAsync(Path.Combine(dir, "manifest.json"), JsonSerializer.Serialize(file, Json), ct);
        await File.WriteAllTextAsync(Path.Combine(dir, "chunks.json"), JsonSerializer.Serialize(chunks, Json), ct);
        _index.Add(fileId, chunks);
        lock (_gate) _loaded.Add(fileId);
        return file;
    }

    public List<RagFile> GetFiles(string conversationId)
    {
        var root = Path.Combine(_conversations, conversationId, "rag");
        if (!Directory.Exists(root)) return new List<RagFile>();
        var files = new List<RagFile>();
        foreach (var dir in Directory.EnumerateDirectories(root))
        {
            var manifest = Path.Combine(dir, "manifest.json");
            if (!File.Exists(manifest)) continue;
            try
            {
                var file = JsonSerializer.Deserialize<RagFile>(File.ReadAllText(manifest), Json);
                if (file is not null) files.Add(file);
            }
            catch (JsonException) { }
        }
        return files.OrderByDescending(f => f.CreatedAt).ToList();
    }

    public async Task<List<RagSearchResult>> SearchAsync(string conversationId, string? fileId, string query, int topK = 3, CancellationToken ct = default)
    {
        var files = string.IsNullOrWhiteSpace(fileId)
            ? GetFiles(conversationId).Select(f => f.Id).ToList()
            : new List<string> { fileId };
        var all = new List<RagSearchResult>();
        foreach (var id in files)
        {
            await EnsureIndexedAsync(conversationId, id, ct);
            all.AddRange(_index.Search(id, query, topK));
        }
        return all.OrderByDescending(r => r.Score).Take(topK).ToList();
    }

    public async Task<RagChunk?> GetChunkAsync(string conversationId, string fileId, int chunkIndex, CancellationToken ct = default)
    {
        var path = Path.Combine(Folder(conversationId, fileId), "chunks.json");
        if (!File.Exists(path)) return null;
        var chunks = JsonSerializer.Deserialize<List<RagChunk>>(await File.ReadAllTextAsync(path, ct), Json);
        return chunks?.FirstOrDefault(c => c.Index == chunkIndex);
    }

    private async Task EnsureIndexedAsync(string conversationId, string fileId, CancellationToken ct)
    {
        lock (_gate)
            if (_loaded.Contains(fileId)) return;
        var path = Path.Combine(Folder(conversationId, fileId), "chunks.json");
        if (!File.Exists(path)) return;
        var chunks = JsonSerializer.Deserialize<List<RagChunk>>(await File.ReadAllTextAsync(path, ct), Json) ?? new List<RagChunk>();
        _index.Add(fileId, chunks);
        lock (_gate) _loaded.Add(fileId);
    }

    private readonly HashSet<string> _loaded = new();

    private string Folder(string conversationId, string fileId)
    {
        if (fileId.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || fileId.Contains(".."))
            throw new InvalidOperationException("Id de arquivo inválido.");
        return Path.Combine(_conversations, conversationId, "rag", fileId);
    }

    private void TryWriteFailure(string conversationId, string fileId, string fileName, long size, string error)
    {
        try
        {
            var dir = Folder(conversationId, fileId);
            Directory.CreateDirectory(dir);
            var file = new RagFile(fileId, Path.GetFileName(fileName), Path.GetExtension(fileName), size, "error", 0, error, DateTime.UtcNow);
            File.WriteAllText(Path.Combine(dir, "manifest.json"), JsonSerializer.Serialize(file, Json));
        }
        catch (IOException) { }
    }
}
