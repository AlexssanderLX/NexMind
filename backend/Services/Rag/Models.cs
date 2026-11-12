namespace LocalAi.Api.Rag;

public record RagFile(
    string Id,
    string Name,
    string Extension,
    long SizeBytes,
    string Type,
    int TotalChunks,
    string Summary,
    DateTime CreatedAt);

public record RagChunk(
    int Index,
    string FileId,
    string Content,
    string Location,
    int EstimatedTokens);

public record RagSearchResult(
    int ChunkIndex,
    string Location,
    string Snippet,
    double Score);
