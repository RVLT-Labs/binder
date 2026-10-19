import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Ref, useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { api } from '../api/client'
import { type WhenPart, whenParts } from '../exports/when'
import { SECTION_LABEL } from '../panel/fields'
import { CARD, Field } from './parts'

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
const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

function Parts({ parts }: { parts: WhenPart[] }) {
  return (
    <>
      {parts.map((p) => (
        <span key={p.text} className={cn(p.mono && 'font-mono tabular-nums')}>
          {p.text}
        </span>
      ))}
    </>
  )
}

/** "today", "yesterday" or "3 Oct": the day alone, the way the tokens mockup writes Created. */
function dayParts(iso: string): WhenPart[] {
  const parts = whenParts(iso)
  const first = parts[0]?.text.trim()
  return first === 'today' || first === 'yesterday' ? [{ text: first }] : parts
}

// created, last used, action: the mockup's table at 768 and up; stacked on a phone.
const ROW = 'md:grid md:grid-cols-[minmax(0,1fr)_150px_190px_100px] md:items-center md:gap-x-2.5'

/** The Copy button: the token goes on the clipboard and the button says so for a moment. */
function CopyButton({ token, onFailed }: { token: string; onFailed: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <Button
      type="button"
      variant="line"
      className="shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(token)
          setCopied(true)
        } catch {
          onFailed()
        }
      }}
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

/**
 * Personal access tokens: all-or-nothing keys that act as the person who made them. A new token's
 * secret is shown once, in a red-outlined card, and never again; revoking asks in the row first.
 */
export function TokensPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const secret = useRef<HTMLInputElement>(null)
  const revokeButtons = useRef(new Map<string, HTMLButtonElement>())
  const keepRef = useRef<HTMLButtonElement>(null)
  const tokens = useQuery({
    queryKey: tokensKey,
    queryFn: () => api.get<{ tokens: TokenRecord[] }>('/me/tokens'),
  })
  const create = useMutation({
    mutationFn: (n: string) =>
      api.post<{ token: string; record: TokenRecord }>('/me/tokens', { name: n, showScope: '*' }),
    onSuccess: ({ token, record }) => {
      setCreated({ token, name: record.name })
      setName('')
      void queryClient.invalidateQueries({ queryKey: tokensKey })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/me/tokens/${id}`),
    onSuccess: () => {
      setConfirming(null)
      void queryClient.invalidateQueries({ queryKey: tokensKey })
    },
  })

  // The question appears in the list: move to its safe answer, and come back to the button on Keep.
  useEffect(() => {
    if (confirming) keepRef.current?.focus()
  }, [confirming])
  const keep = (id: string) => {
    setConfirming(null)
    revoke.reset()
    requestAnimationFrame(() => revokeButtons.current.get(id)?.focus())
  }

  const list = tokens.data?.tokens ?? []
  return (
    <div className="flex w-full max-w-[876px] flex-col md:-mt-2.5">
      <h1 className="t-page-title m-0 max-md:sr-only">Personal access tokens</h1>
      <p className="m-0 mt-1 text-[13px] text-muted max-md:mt-0">
        Tokens act as you. Changes made with one show in Activity as “via &lt;its name&gt;”.
      </p>

      <form
        className="mt-4 flex items-end gap-3 max-md:flex-col max-md:items-stretch"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate(name.trim())
        }}
      >
        <Field label="Name" className="max-w-[440px] flex-1 max-md:max-w-none">
          <Input
            aria-label="Token name"
            placeholder="Claude Code on the laptop"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={create.isPending}>
          Create token
        </Button>
      </form>
      {create.error && (
        <p role="alert" className="m-0 mt-2 text-[13px] text-ink-2">
          {errorText(create.error)}
        </p>
      )}

      {created && (
        <div
          role="status"
          className={cn(CARD, 'mt-4 flex flex-col gap-2.5 border-red px-4 py-3.5 max-md:p-3.5')}
        >
          <h2 className="m-0 text-[14.5px] font-bold text-ink">
            Copy it now. Binder will not show it again.
          </h2>
          <div className="flex items-center gap-2.5">
            <Input
              ref={secret}
              aria-label="New token"
              readOnly
              value={created.token}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 font-mono tracking-[0.02em] md:h-[34px] md:text-[13px]"
            />
            <CopyButton token={created.token} onFailed={() => secret.current?.select()} />
          </div>
          <p className="m-0 text-[12px] text-muted">Token “{created.name}”, created just now.</p>
        </div>
      )}
      {tokens.error && (
        <p role="alert" className="m-0 mt-3 text-[13px] text-ink-2">
          {errorText(tokens.error)}
        </p>
      )}

      <h2 className={cn(SECTION_LABEL, 'mt-6 mb-1.5')}>Your tokens</h2>
      <div
        aria-hidden
        className={cn(
          ROW,
          'hidden border-b border-line px-2.5 py-1.5 text-[11px] font-semibold text-muted md:grid',
        )}
      >
        <span>Name</span>
        <span>Created</span>
        <span>Last used</span>
        <span />
      </div>
      <ul aria-label="Tokens" className="m-0 list-none p-0">
        {list.map((t) => (
          <TokenRow
            key={t.id}
            token={t}
            confirming={confirming === t.id}
            onAsk={() => setConfirming(t.id)}
            askRef={(el) => {
              if (el) revokeButtons.current.set(t.id, el)
              else revokeButtons.current.delete(t.id)
            }}
          >
            {confirming === t.id && (
              <li
                key={`${t.id}-confirm`}
                className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2 bg-elev px-2.5 py-2 text-[13px] text-ink"
              >
                <span>Revoke “{t.name}”? Anything using it stops working.</span>
                <span className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="line"
                    className="border-ink-2 bg-paper"
                    loading={revoke.isPending}
                    onClick={() => revoke.mutate(t.id)}
                  >
                    Revoke
                  </Button>
                  <Button
                    ref={keepRef as Ref<HTMLButtonElement>}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => keep(t.id)}
                  >
                    Keep
                  </Button>
                </span>
                {revoke.error && (
                  <span role="alert" className="basis-full text-[12px] text-ink-2">
                    {errorText(revoke.error)}
                  </span>
                )}
              </li>
            )}
          </TokenRow>
        ))}
      </ul>
      {tokens.data && list.length === 0 && (
        <p className="m-0 mt-3 px-2.5 text-[13px] text-muted">
          No tokens yet. Name one above and create it.
        </p>
      )}
    </div>
  )
}

/** One token's row; the inline question, when there is one, follows it as its own list item. */
function TokenRow({
  token: t,
  confirming,
  onAsk,
  askRef,
  children,
}: {
  token: TokenRecord
  confirming: boolean
  onAsk: () => void
  askRef: (el: HTMLButtonElement | null) => void
  children: React.ReactNode
}) {
  return (
    <>
      <li
        className={cn(
          ROW,
          'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-2.5 py-2 text-[13px] first:border-t-0 md:py-2.5',
        )}
      >
        <span
          className={cn(
            'col-start-1 row-start-1 min-w-0 truncate font-semibold',
            t.revokedAt ? 'text-muted' : 'text-ink',
          )}
        >
          {t.name}
        </span>
        <span className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted md:contents md:text-[13px]">
          <span>
            <span className="md:sr-only">Created </span>
            <Parts parts={dayParts(t.createdAt)} />
          </span>
          <span aria-hidden className="md:hidden">
            ·
          </span>
          <span>
            {t.lastUsedAt ? (
              <>
                <span className="md:sr-only">Last used </span>
                <Parts parts={whenParts(t.lastUsedAt)} />
              </>
            ) : (
              'never used'
            )}
          </span>
        </span>
        <span className="col-start-2 row-span-2 row-start-1 flex min-h-11 items-center justify-end md:col-start-4 md:row-span-1 md:min-h-0">
          {t.revokedAt ? (
            <Badge status="neutral">Revoked</Badge>
          ) : (
            !confirming && (
              <Button
                ref={askRef}
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Revoke ${t.name}`}
                onClick={onAsk}
              >
                Revoke
              </Button>
            )
          )}
        </span>
      </li>
      {children}
    </>
  )
}
