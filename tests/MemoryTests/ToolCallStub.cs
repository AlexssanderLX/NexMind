using System.Text.Json;

// O mesmo record de backend/Llm/OllamaClient.cs, sem arrastar o cliente HTTP do Ollama para o projeto de testes.
namespace LocalAi.Api.Llm
{
    public record ToolCall(string Name, JsonElement Arguments);
}
