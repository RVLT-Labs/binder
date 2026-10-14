import { createMcpHonoApp } from '@modelcontextprotocol/hono'
import { createMcpHandler, McpServer, type McpServerFactory } from '@modelcontextprotocol/server'
import type { Hono } from 'hono'
import type { Config } from '../config'
import { principalFrom } from './auth'
import { type McpDeps, mcpContext } from './context'
import { registerGuideResources } from './resources/guides'
import { registerPageResources } from './resources/pages'
import { registerAnnotationTools } from './tools/annotations'
import { registerCueTools } from './tools/cues'
import { registerDepartmentTools } from './tools/departments'
import { registerDocumentTools } from './tools/documents'
import { registerPageTools } from './tools/pages'
import { registerSearchTools } from './tools/search'
import { registerShowTools } from './tools/shows'

declare module 'hono' {
  interface ContextVariableMap {
    /** The JSON body, parsed by the `createMcpHonoApp` middleware. */
    parsedBody: unknown
  }
}

const INSTRUCTIONS = [
  'Binder holds theatre show binders: shows, their documents (scripts and scores as PDFs with a',
  'word layer per page), departments (the layers cues and marks live on, like LX or SND) their cues (numbered per department, anchored to a page position or unplaced) and annotations (notes, shapes, stamps and highlights drawn on a department layer or on your own private personal layer). Start with list_shows, then list_documents for a show;',
  'a document version id is what get_page (see and read a page) and search_script take. Page',
  'indices are zero-based and coordinates are PDF points with the origin at the bottom left.',
  'House rules for cue style, mic and DCA practice and the .tmix format are the binder://guides',
  'resources; read them before marking up a script.',
].join(' ')

/** One McpServer per HTTP request (stateless), acting as the token's user. */
export function createMcpServerFactory(deps: McpDeps): McpServerFactory {
  return ({ authInfo, requestInfo }) => {
    if (!authInfo) throw new Error('MCP request reached the server without authInfo')
    const mcp = mcpContext(deps, principalFrom(authInfo, requestInfo))
    const server = new McpServer(
      { name: 'binder', version: '0.0.0' },
      { instructions: INSTRUCTIONS },
    )
    registerShowTools(server, mcp)
    registerDepartmentTools(server, mcp)
    registerCueTools(server, mcp)
    registerAnnotationTools(server, mcp)
    registerDocumentTools(server, mcp)
    registerPageTools(server, mcp)
    registerSearchTools(server, mcp)
    registerPageResources(server, mcp)
    registerGuideResources(server)
    return server
  }
}

/** Hosts the MCP endpoint answers to (DNS rebinding guard): the app's own host plus localhost. */
export function mcpAllowedHosts(config: Pick<Config, 'APP_ORIGIN'>): string[] {
  return [...new Set([new URL(config.APP_ORIGIN).hostname, 'localhost', '127.0.0.1', '[::1]'])]
}

/**
 * The Streamable HTTP endpoint, to mount at `/mcp` behind `mcpAuth`. POST carries MCP traffic;
 * the stateless handler answers GET and DELETE with 405.
 */
export function createMcpRoutes(deps: McpDeps, config: Pick<Config, 'APP_ORIGIN'>): Hono {
  const handler = createMcpHandler(createMcpServerFactory(deps), {
    onerror: (err) => console.error('mcp', err),
  })
  const hosts = mcpAllowedHosts(config)
  const app = createMcpHonoApp({ allowedHosts: hosts, allowedOrigins: hosts })
  app.all('/', (c) =>
    handler.fetch(c.req.raw, { authInfo: c.get('mcpAuth'), parsedBody: c.get('parsedBody') }),
  )
  return app
}
