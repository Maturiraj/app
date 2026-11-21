// lib/agent-core/anthropicClient.js
import Anthropic from '@anthropic-ai/sdk'

let client = null

export function getAnthropicClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set')
    }
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }
  return client
}

export async function makeClaudeRequest({
  systemPrompt,
  messages,
  tools = [],
  model = 'claude-sonnet-5-5',
  maxTokens = 4096,
  effort = 'low',
}) {
  const client = getAnthropicClient()

  // Sonnet 5.5 odbija temperature/top_p/top_k i razmišlja po defaultu;
  // dubinu razmišljanja kontrolira effort, a thinking troši max_tokens.
  const requestBody = {
    model,
    max_tokens: maxTokens,
    output_config: { effort },
    system: systemPrompt,
    messages,
  }

  if (tools.length > 0) {
    requestBody.tools = tools
  }

  const response = await client.messages.create(requestBody)

  return response
}
