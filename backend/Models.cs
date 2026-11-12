namespace LocalAi.Api;

public record ChatStats(int PromptTokens, int OutputTokens, double TokensPerSec, double TotalSeconds, double LoadSeconds);

/// <param name="Model">Modelo que gerou a resposta (null em mensagens do usuário e em conversas antigas).</param>
public record Message(string Role, string Content, string? Thinking, DateTime At, ChatStats? Stats, string? Model = null);

public class Conversation
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "Nova conversa";
    /// <summary>true depois que o usuário renomeou: o título automático (1ª mensagem) não sobrescreve mais.</summary>
    public bool TitleEdited { get; set; }
    public string? Model { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<Message> Messages { get; set; } = new();
}

public record ConversationSummary(string Id, string Title, DateTime UpdatedAt);

public record RenameRequest(string? Title);

/// <param name="Think">null = padrão do modelo; true/false força o modo de raciocínio.</param>
/// <param name="System">Prompt de sistema opcional (não é salvo na conversa; vem das configurações).</param>
/// <param name="Search">Só é verdade quando o usuário ligou a ferramenta de pesquisa.</param>
/// <param name="Tools">Só é verdade quando o usuário ligou as ferramentas MCP (as ferramentas pesam no contexto).</param>
public record ChatRequest(string Content, string Model, int NumCtx, bool? Think, string? System, bool Search = false, bool Tools = false, bool Browser = false, bool Desktop = false);

public record SpeakRequest(string? Text, string? Engine, string? Voice, double Rate);

public record ApprovalDecision(bool Approve);

/// <param name="NumCtx">Teto de contexto (Configurações); o contexto real é adaptativo, como no chat principal.</param>
public record SubagentRequest(string Content, string Model, int NumCtx);
public record VaultWrite(string? Text);
public record WorkspaceOpen(string Path);
public record WorkspaceFile(string Path, string? Content);
public record WorkspaceCommand(string Command);
