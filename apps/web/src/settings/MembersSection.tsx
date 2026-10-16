import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { PersonAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { api } from '../api/client'
import { useSessionUser } from '../auth/session'
import { canUncheckDepartment, LAST_DEPARTMENT_HINT, nextScope } from '../markup/memberScope'
import type { DepartmentRow } from '../markup/useDepartments'
import { SECTION_LABEL } from '../panel/fields'
import { useConfirm } from '../shell/useConfirm'
import { ADD_ROW, Field, SelectBox } from './parts'

type Role = 'owner' | 'editor' | 'viewer'

interface Member {
  membershipId: string
  userId: string
  name: string
  email: string | null
  role: Role
  departments: string[]
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }
const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

function scopeLabel(member: Member, departments: DepartmentRow[]): string {
  if (member.departments.includes('*')) return 'all departments'
  const names = member.departments.map((id) => departments.find((d) => d.id === id)?.code ?? id)
  return names.join(', ')
}

// avatar, name, email, role, action: the settings mockup's member row.
const ROW =
  'flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 py-1 md:grid md:grid-cols-[26px_150px_minmax(0,1fr)_118px_72px] md:grid-rows-[minmax(42px,auto)] md:px-3 md:py-0'

export function MembersSection({
  showId,
  departments,
  editable,
}: {
  showId: string
  departments: DepartmentRow[]
  editable: boolean
}) {
  const members = useQuery({
    queryKey: ['members', showId],
    queryFn: () => api.get<{ members: Member[] }>(`/shows/${showId}/members`),
  })
  const me = useSessionUser().data?.id
  return (
    <section id="members" aria-labelledby="members-heading" className="flex flex-col gap-2">
      <h2 id="members-heading" className={SECTION_LABEL}>
        Members
      </h2>
      {members.isError && (
        <p role="alert" className="m-0 text-[13px] text-ink-2">
          Members are not available offline.
        </p>
      )}
      <ul
        aria-label="Members"
        className="m-0 list-none rounded-[var(--r)] border-2 border-line-2 bg-card p-0 shadow-card empty:hidden md:rounded-none md:border-0 md:bg-transparent md:shadow-none"
      >
        {members.data?.members.map((m) => (
          <li key={m.membershipId} className="border-t border-line first:border-t-0">
            <MemberRow
              showId={showId}
              member={m}
              departments={departments}
              editable={editable}
              isMe={m.userId === me}
            />
          </li>
        ))}
      </ul>
      {editable && <InviteRow showId={showId} />}
      {editable && (
        <p className="m-0 text-[12px] text-muted">
          Editors place and move cues in the departments they are given. Viewers read and export.
        </p>
      )}
    </section>
  )
}

function MemberRow({
  showId,
  member,
  departments,
  editable,
  isMe,
}: {
  showId: string
  member: Member
  departments: DepartmentRow[]
  editable: boolean
  isMe: boolean
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { confirm, dialog } = useConfirm(`Remove ${member.name}?`, 'Remove', 'Keep')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members', showId] })
  const save = useMutation({
    mutationFn: (patch: { role?: Role; departments?: string[] }) =>
      api.patch(`/memberships/${member.membershipId}`, patch),
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError: (err) => setError(errorText(err)),
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/memberships/${member.membershipId}`),
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError: (err) => setError(errorText(err)),
  })
  const all = member.departments.includes('*')
  const toggle = (id: string, on: boolean) => {
    const next = nextScope(member.departments, id, on)
    if (next) save.mutate({ departments: next })
  }
  const editorScope = member.role === 'editor'

  const person = (
    <>
      <PersonAvatar
        name={member.name}
        className="size-8 text-[12px] md:size-[26px] md:text-[10.5px]"
      />
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink md:flex-none md:text-[13px]">
        {member.name}
      </span>
    </>
  )

  if (!editable) {
    return (
      <div className={ROW}>
        {person}
        <span className="text-[13px] text-ink-2 md:col-start-4">
          {ROLE_LABEL[member.role]}
          {editorScope && <span className="text-muted"> ({scopeLabel(member, departments)})</span>}
        </span>
      </div>
    )
  }

  return (
    <div className={ROW}>
      {person}
      <span className="max-w-full truncate text-[12.5px] text-muted max-md:hidden md:col-start-3">
        {member.email}
      </span>
      {isMe ? (
        <>
          <span className="inline-flex h-9 w-24 items-center rounded-[10px] border-2 border-line-2 bg-paper px-3 text-[13px] font-semibold text-ink-2 md:col-start-4 md:h-7 md:w-full md:rounded-[9px] md:px-[9px]">
            {ROLE_LABEL[member.role]}
          </span>
          <span className="justify-self-end pr-2 text-[12px] text-faint md:col-start-5">You</span>
        </>
      ) : (
        <>
          <SelectBox
            aria-label={`${member.name} role`}
            value={member.role}
            onChange={(e) => save.mutate({ role: e.target.value as Role })}
            className="w-28 max-md:[&_select]:h-11 max-md:[&_select]:rounded-[10px] max-md:[&_select]:text-[13px] md:col-start-4 md:w-full"
          >
            <option value="owner">Owner</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </SelectBox>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${member.name}`}
            className="justify-self-end text-muted md:col-start-5"
            onClick={async () => {
              if (await confirm(`${member.name} will lose access to this show.`)) remove.mutate()
            }}
          >
            Remove
          </Button>
        </>
      )}
      {editorScope && (
        <fieldset className="m-0 flex basis-full flex-wrap items-center gap-x-4 gap-y-1 border-0 p-0 pb-2 text-[13px] text-ink-2 md:col-span-full md:col-start-3 md:pb-1.5">
          <legend className="sr-only">Edits</legend>
          <span aria-hidden className="text-[11px] font-semibold text-muted">
            Edits
          </span>
          <ScopeBox
            id={`${member.membershipId}-all`}
            label="All departments"
            checked={all}
            onChange={(on) =>
              save.mutate({ departments: on ? ['*'] : departments.slice(0, 1).map((d) => d.id) })
            }
          />
          {!all &&
            departments.map((d) => {
              const on = member.departments.includes(d.id)
              const locked = on && !canUncheckDepartment(member.departments, d.id)
              return (
                <ScopeBox
                  key={d.id}
                  id={`${member.membershipId}-${d.id}`}
                  label={d.code ?? ''}
                  checked={on}
                  disabled={locked}
                  title={locked ? LAST_DEPARTMENT_HINT : undefined}
                  onChange={(next) => toggle(d.id, next)}
                />
              )
            })}
          {!all && member.departments.length === 1 && (
            <span className="text-[12px] text-muted">{LAST_DEPARTMENT_HINT}</span>
          )}
        </fieldset>
      )}
      {error && (
        <p
          role="alert"
          className="m-0 basis-full text-[12px] text-ink-2 md:col-span-full md:col-start-3"
        >
          {error}
        </p>
      )}
      {dialog}
    </div>
  )
}

function ScopeBox({
  id,
  label,
  checked,
  disabled,
  title,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  title?: string
  onChange: (on: boolean) => void
}) {
  return (
    <span className="inline-flex min-h-11 items-center gap-2 md:min-h-0" title={title}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(on) => onChange(on === true)}
      />
      <label htmlFor={id} className={cn(disabled && 'opacity-60')}>
        {label}
      </label>
    </span>
  )
}

function InviteRow({ showId }: { showId: string }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const invite = useMutation({
    mutationFn: () => api.post(`/shows/${showId}/members`, { email: email.trim(), role }),
    onSuccess: () => {
      setEmail('')
      void queryClient.invalidateQueries({ queryKey: ['members', showId] })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (email.trim()) invite.mutate()
  }
  return (
    <form
      aria-label="Invite member"
      onSubmit={submit}
      className={cn(ADD_ROW, 'mt-1.5 flex flex-wrap items-end gap-3')}
    >
      <Field
        label="Invite by email"
        className="max-w-[400px] min-w-0 flex-1 max-md:max-w-none max-md:basis-full"
      >
        <Input
          type="email"
          aria-label="Invite by email"
          placeholder="name@example.com"
          value={email}
          maxLength={254}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Field label="Role" className="w-[118px] max-md:flex-1">
        <SelectBox
          aria-label="Invite role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </SelectBox>
      </Field>
      <Button type="submit" variant="line" loading={invite.isPending}>
        Invite
      </Button>
      {invite.isError && (
        <p role="alert" className="m-0 basis-full text-[12px] text-ink-2">
          {errorText(invite.error)}
        </p>
      )}
    </form>
  )
}
