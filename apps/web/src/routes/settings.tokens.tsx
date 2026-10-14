import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api/client'

export const Route = createFileRoute('/settings/tokens')({ component: TokensPage })

interface TokenRecord {
  id: string
  name: string
  showScope: '*' | string[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

const tokensKey = ['tokens'] as const

function TokensPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const tokens = useQuery({
    queryKey: tokensKey,
    queryFn: () => api.get<{ tokens: TokenRecord[] }>('/me/tokens'),
  })
  const create = useMutation({
    mutationFn: (n: string) =>
      api.post<{ token: string; record: TokenRecord }>('/me/tokens', { name: n, showScope: '*' }),
    onSuccess: ({ token }) => {
      setCreated(token)
      setName('')
      void queryClient.invalidateQueries({ queryKey: tokensKey })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/me/tokens/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey }),
  })

  return (
    <>
      <h1>Personal access tokens</h1>
      <p>Tokens let scripts and AI agents use Binder as you. They can reach every show you can.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate(name.trim())
        }}
      >
        <input
          aria-label="Token name"
          placeholder="Token name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={create.isPending}>
          Create token
        </button>
      </form>
      {create.error && <p role="alert">{create.error.message}</p>}
      {created && (
        <div role="status" className="new-token">
          <p>Copy this token now. It will not be shown again.</p>
          <code>{created}</code>
        </div>
      )}
      {tokens.error && <p role="alert">{tokens.error.message}</p>}
      <ul aria-label="Tokens">
        {tokens.data?.tokens.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong> · created {new Date(t.createdAt).toLocaleDateString()}
            {t.lastUsedAt && ` · last used ${new Date(t.lastUsedAt).toLocaleString()}`}
            {t.revokedAt ? (
              ' · revoked'
            ) : (
              <button type="button" onClick={() => revoke.mutate(t.id)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
