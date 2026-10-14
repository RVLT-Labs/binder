import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Hono } from 'hono'
import type { AppEnv } from '../src/app'
import type { Json } from './documentHelpers'

const MCP_URL = 'http://localhost/mcp'

/**
 * A real SDK client whose HTTP requests go straight into the Hono app. `era` picks the protocol:
 * 'legacy' is the 2025 `initialize` handshake, 'auto' negotiates the 2026-07-28 per-request envelope.
 * The caller closes the client.
 */
export async function connectMcp(
  app: Hono<AppEnv>,
  token: string,
  client: { name: string; version: string } = { name: 'test-client', version: '1.0.0' },
  era: 'legacy' | 'auto' = 'legacy',
): Promise<Client> {
  const mcp = new Client(client, { versionNegotiation: { mode: era } })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('authorization', `Bearer ${token}`)
      headers.set('user-agent', `${client.name}/${client.version.replace(/\.0$/, '')}`)
      headers.set('host', 'localhost')
      return app.fetch(new Request(input, { ...init, headers }))
    },
  })
  await mcp.connect(transport)
  return mcp
}

export interface ToolResult {
  isError?: boolean
  content: Json[]
  structuredContent?: Json
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolResult
}

/** The text of a tool result, for asserting on error messages. */
export const resultText = (r: { content: Json[] }): string =>
  r.content.map((c) => c.text ?? '').join('\n')
