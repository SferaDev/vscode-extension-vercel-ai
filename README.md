# Vercel AI VS Code Extension

This VS Code extension provides Vercel AI models via the Language Model API, integrating AI models through Vercel's AI Gateway directly within VS Code's native chat interface.

## Features

- **Multiple AI Models**: Support for all Vercel AI Gateway models
- **VS Code Integration**: Works natively with VS Code's chat interface
- **Streaming Responses**: Real-time streaming of AI responses
- **Tool Calling**: Full support for VS Code tool integration
- **Configuration Management**: Simple API key setup through VS Code settings

## Quick Start

Set your Vercel AI Gateway API key in VS Code:

1. Open VS Code Settings (Cmd/Ctrl + ,)
2. Search for "vercelAiGateway.apiKey"
3. Enter your Vercel AI Gateway API key (starts with `vck_`)

Or use the Command Palette:
1. Press `Cmd/Ctrl + Shift + P`
2. Search for "Vercel AI: Manage API Key"
3. Enter your API key when prompted

Or add to your `settings.json`:

```json
{
  "vercelAiGateway.apiKey": "vck_your-vercel-ai-gateway-key-here"
}
```

## Available Models

The extension dynamically fetches available models from the Vercel AI Gateway. Models include:

- GPT-4o and GPT-4o Mini from OpenAI
- Claude models from Anthropic
- Gemini models from Google
- And many more supported by Vercel AI Gateway

All models support:
- Text generation
- Streaming responses
- Tool calling (where supported by the underlying model)
- Token counting
