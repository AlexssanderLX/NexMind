namespace LocalAi.Api;

public record ChatStats(int PromptTokens, int OutputTokens, double TokensPerSec, double TotalSeconds, double LoadSeconds);

/// <param name="Model">Modelo que gerou a resposta (null em mensagens do usuário e em conversas antigas).</param>
public record Message(string Role, string Content, string? Thinking, DateTime At, ChatStats? Stats, string? Model = null);

public class Conversation
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "Nova conversa";
    public string? Model { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<Message> Messages { get; set; } = new();
}

public record ConversationSummary(string Id, string Title, DateTime UpdatedAt);

/// <param name="Think">null = padrão do modelo; true/false força o modo de raciocínio.</param>
/// <param name="System">Prompt de sistema opcional (não é salvo na conversa; vem das configurações).</param>
public record ChatRequest(string Content, string Model, int NumCtx, bool? Think, string? System);
