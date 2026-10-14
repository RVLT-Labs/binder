import type { Actor } from '@binder/shared'
import { CLIENT_INFO_META_KEY, type ServerContext } from '@modelcontextprotocol/server'
import type { AppDeps } from '../app'
import { actorFor, type Principal } from './auth'

export type McpDeps = Pick<AppDeps, 'db' | 'blobs' | 'jobs'>

/** What every tool and resource handler needs: the services' dependencies and the caller. */
export interface McpContext {
  deps: McpDeps
  /** The actor for one handler call; the client's identity is read per request. */
  actor(ctx: ServerContext): Actor
}

export function mcpContext(deps: McpDeps, principal: Principal): McpContext {
  return {
    deps,
    // 2026-07-28 requests carry the client's name and version in the per-request envelope;
    // stateless 2025-era requests do not, and fall back to the User-Agent.
    actor: (ctx) => {
      const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined
      return actorFor(principal, envelope?.[CLIENT_INFO_META_KEY])
    },
  }
}
