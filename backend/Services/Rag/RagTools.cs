using System.Text;
using System.Text.Json;
using LocalAi.Api.Llm;

namespace LocalAi.Api.Rag;

/// <summary>
/// As três ferramentas do Micro-RAG. O modelo não recebe o arquivo: pede a lista, busca e, se precisar, lê um bloco.
/// </summary>
public static class RagTools
{
    public const string List = "rag_list_files";
    public const string Search = "rag_search";
    public const string Read = "rag_read_chunk";

    public static bool IsRagTool(string name) => name is List or Search or Read;

    public static List<object> Definitions() =>
    [
        new
        {
            type = "function",
            function = new
            {
                name = List,
                description = "Lista os arquivos, logs ou imagens processados na conversa atual com um breve resumo de cada um.",
                parameters = new { type = "object", properties = new { }, required = Array.Empty<string>() },
            },
        },
        new
        {
            type = "function",
            function = new
            {
                name = Search,
                description = "Busca trechos específicos dentro dos arquivos indexados por palavras-chave ou perguntas. Retorna as 3 ocorrências mais relevantes com linhas e contexto.",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        query = new { type = "string", description = "Palavras ou pergunta." },
                        file_id = new { type = "string", description = "Limita a busca a um arquivo. Opcional." },
                    },
                    required = new[] { "query" },
                },
            },
        },
        new
        {
            type = "function",
            function = new
            {
                name = Read,
                description = "Lê na íntegra um bloco específico de um arquivo quando for necessário analisar o código ou log completo.",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        file_id = new { type = "string", description = "Id do arquivo." },
                        chunk_index = new { type = "integer", description = "Índice do bloco." },
                    },
                    required = new[] { "file_id", "chunk_index" },
                },
            },
        },
    ];

    public const string CitationRule =
        "Quando responder com base em dados de arquivos ou logs, SEMPRE cite a fonte e a localização exata fornecida pelo RAG (exemplo: 'Conforme registrado na linha 142 de access.log...'). Nunca adivinhe linhas ou dados que não estejam no snippet retornado.";

    public static async Task<(bool Ok, string Text)> Handle(ToolCall call, RagEngine rag, string conversationId, CancellationToken ct = default)
    {
        var files = rag.GetFiles(conversationId);
        if (call.Name == List)
        {
            if (files.Count == 0) return (true, "Nenhum arquivo processado nesta conversa.");
            var sb = new StringBuilder();
            foreach (var f in files)
                sb.Append("- ").Append(f.Name).Append(" | file_id=").Append(f.Id)
                  .Append(" | ").Append(f.Type).Append(" | ").Append(f.TotalChunks).Append(" blocos | ")
                  .Append(f.Summary).Append('\n');
            return (true, sb.ToString().TrimEnd());
        }
        if (call.Name == Search)
        {
            var query = Arg(call.Arguments, "query");
            if (string.IsNullOrWhiteSpace(query)) return (false, "Informe query.");
            var fileId = Arg(call.Arguments, "file_id");
            var scope = string.IsNullOrWhiteSpace(fileId) ? files : files.Where(f => f.Id == fileId).ToList();
            if (scope.Count == 0) return (true, "Nenhum arquivo indexado para essa busca. Não invente o conteúdo.");
            var hits = new List<(RagFile File, RagSearchResult Hit)>();
            foreach (var file in scope)
                foreach (var hit in await rag.SearchAsync(conversationId, file.Id, query, 3, ct))
                    hits.Add((file, hit));
            if (hits.Count == 0) return (true, "Nenhuma ocorrência. Não invente linha nem dado.");
            var sb = new StringBuilder();
            foreach (var (file, hit) in hits.OrderByDescending(h => h.Hit.Score).Take(3))
                sb.Append("arquivo=").Append(file.Name)
                  .Append(" file_id=").Append(file.Id)
                  .Append(" chunk_index=").Append(hit.ChunkIndex)
                  .Append(" local=").Append(hit.Location)
                  .Append("\ntrecho: ").Append(hit.Snippet).Append("\n\n");
            return (true, sb.ToString().TrimEnd());
        }
        if (call.Name == Read)
        {
            var fileId = Arg(call.Arguments, "file_id");
            if (string.IsNullOrWhiteSpace(fileId)) return (false, "Informe file_id.");
            if (!TryIndex(call.Arguments, out var index)) return (false, "Informe chunk_index inteiro.");
            var file = files.FirstOrDefault(f => f.Id == fileId);
            var chunk = await rag.GetChunkAsync(conversationId, fileId, index, ct);
            if (chunk is null) return (false, "Bloco não encontrado.");
            return (true, $"arquivo={file?.Name ?? fileId} file_id={fileId} chunk_index={chunk.Index} local={chunk.Location}\n{chunk.Content}");
        }
        return (false, $"A ferramenta '{call.Name}' não existe.");
    }

    private static string? Arg(JsonElement args, string key)
    {
        if (args.ValueKind != JsonValueKind.Object) return null;
        foreach (var p in args.EnumerateObject())
        {
            if (!string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase)) continue;
            return p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString();
        }
        return null;
    }

    private static bool TryIndex(JsonElement args, out int index)
    {
        index = 0;
        if (args.ValueKind != JsonValueKind.Object) return false;
        foreach (var p in args.EnumerateObject())
        {
            if (!string.Equals(p.Name, "chunk_index", StringComparison.OrdinalIgnoreCase)) continue;
            if (p.Value.ValueKind == JsonValueKind.Number && p.Value.TryGetInt32(out index)) return true;
            if (p.Value.ValueKind == JsonValueKind.String && int.TryParse(p.Value.GetString(), out index)) return true;
        }
        return false;
    }
}
