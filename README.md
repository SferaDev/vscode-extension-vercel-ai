# Vercel AI VS Code Extension

This VS Code extension provides Vercel AI models via the Language Model API, integrating OpenAI GPT models through Vercel's AI infrastructure directly within VS Code's native chat interface.

## Features

- **Multiple AI Models**: Support for GPT-4o and GPT-4o Mini via Vercel AI
- **VS Code Integration**: Works natively with VS Code's chat interface
- **Streaming Responses**: Real-time streaming of AI responses
- **Configuration Management**: Simple API key setup through VS Code settings
- **Token Counting**: Accurate token estimation for cost management

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Extension

```bash
npm run compile
```

### 3. Configure API Key

Set your OpenAI API key in VS Code settings:

1. Open VS Code Settings (Cmd/Ctrl + ,)
2. Search for "vercelAI.apiKey"
3. Enter your OpenAI API key

Or add to your `settings.json`:

```json
{
  "vercelAI.apiKey": "sk-your-openai-api-key-here"
}
```

### 4. Run the Extension

1. Open this project in VS Code
2. Press `F5` to launch Extension Development Host
3. In the new window, access the chat interface
4. Select "Vercel AI" as your model provider
5. Choose between GPT-4o or GPT-4o Mini

## Available Models

| Model ID | Name | Max Input | Max Output | Features |
|----------|------|-----------|------------|----------|
| `vercel-ai-gpt-4o` | GPT-4o | 128k tokens | 4k tokens | Vision, Tools |
| `vercel-ai-gpt-4o-mini` | GPT-4o Mini | 128k tokens | 16k tokens | Vision, Tools |

## Development

### Scripts

```bash
npm run compile    # Build TypeScript
npm run watch      # Watch mode compilation
npm run lint       # Run ESLint
```

### Project Structure

```
src/
├── extension.ts   # Extension activation & registration
└── provider.ts    # Chat model provider implementation
```

## Configuration

| Setting | Description | Required |
|---------|-------------|----------|
| `vercelAI.apiKey` | Your OpenAI API key | Yes |

## Implementation Status

✅ **Completed**:
- Basic VS Code extension structure
- Language model chat provider interface
- Two GPT model configurations
- API key configuration system
- Mock streaming responses
- Token counting
- Error handling

🚧 **Next Steps** (for full Vercel AI integration):
- Real Vercel AI SDK integration with streaming
- Vercel AI Gateway configuration
- Image input support
- Tool calling capabilities
- Multiple AI providers (Anthropic, etc.)

## Current Behavior

The extension currently provides a **working foundation** with:
- Proper VS Code chat interface integration
- Configuration validation
- Simulated streaming responses that demonstrate the interface
- Ready structure for full Vercel AI SDK integration

To complete the integration, replace the mock implementation in `provider.ts` with actual Vercel AI SDK calls.

## Requirements

- VS Code 1.104.0 or higher
- Node.js 18+ for development
- OpenAI API key
- TypeScript 5.3+

## License

MIT License