import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { api } from '../api/client'
import { PaperSizeEditor } from '../exports/PaperSizeEditor'
import { MarkerSideEditor } from '../markup/MarkerSideEditor'
import { canUncheckDepartment, LAST_DEPARTMENT_HINT, nextScope } from '../markup/memberScope'
import { StampSetEditor } from '../markup/StampSetEditor'
import { type DepartmentRow, useDepartments } from '../markup/useDepartments'
import { useMembership } from '../markup/useMembership'

export const Route = createFileRoute('/shows/$showId/settings')({ component: SettingsPage })

type Role = 'owner' | 'editor' | 'viewer'
type NumberFormat = 'decimal' | 'point'

interface Member {
  membershipId: string
  userId: string
  name: string
  email: string | null
  role: Role
  departments: string[]
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

function SettingsPage() {
  const { showId } = Route.useParams()
  const membership = useMembership(showId)
  const departments = useDepartments(showId)
  const isOwner = membership?.role === 'owner'
  return (
    <>
      <p>
        <Link to="/shows/$showId" params={{ showId }}>
          ← Show
        </Link>
      </p>
      <h1>Show settings</h1>
      {!isOwner && <p>Only owners can change these settings.</p>}
      <DepartmentsSection showId={showId} departments={departments} editable={isOwner} />
      <MarkerSideEditor showId={showId} editable={isOwner} />
      <StampSetEditor showId={showId} editable={isOwner} />
      <PaperSizeEditor showId={showId} editable={isOwner} />
      <MembersSection showId={showId} departments={departments} editable={isOwner} />
    </>
  )
}

function DepartmentsSection({
  showId,
  departments,
  editable,
}: {
  showId: string
  departments: DepartmentRow[]
  editable: boolean
}) {
  return (
    <section aria-labelledby="departments-heading">
      <h2 id="departments-heading">Departments</h2>
      <p>
        Each department is a layer for cues and marks. Hiding a department removes it from the
        pickers but keeps its cues.
      </p>
      <ul aria-label="Departments" className="settings-list">
        {departments.map((d) => (
          <li key={d.id}>
            <DepartmentRowEditor department={d} editable={editable} />
          </li>
        ))}
      </ul>
      {editable && <AddDepartment showId={showId} />}
    </section>
  )
}

function DepartmentRowEditor({
  department,
  editable,
}: {
  department: DepartmentRow
  editable: boolean
}) {
  const [name, setName] = useState(department.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch(`/departments/${department.id}`, patch),
    onSuccess: () => setError(null),
    onError: (err) => setError(errorText(err)),
  })
  const swatch = (
    <span
      aria-hidden="true"
      className="department-swatch"
      style={{ background: department.colour ?? '#999' }}
    />
  )
  if (!editable) {
    return (
      <>
        {swatch}
        <strong>{department.code}</strong> {department.name}{' '}
        <span className="muted">
          {department.number_format === 'point'
            ? 'point numbers (10.50)'
            : 'decimal numbers (10.5)'}
          {department.hidden ? ', hidden' : ''}
        </span>
      </>
    )
  }
  return (
    <>
      {swatch}
      <strong>{department.code}</strong>
      <input
        aria-label={`${department.code} name`}
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== department.name && save.mutate({ name: name.trim() })}
      />
      <input
        type="color"
        aria-label={`${department.code} colour`}
        value={department.colour ?? '#999999'}
        onChange={(e) => save.mutate({ colour: e.target.value.toUpperCase() })}
      />
      <select
        aria-label={`${department.code} number format`}
        value={department.number_format ?? 'decimal'}
        onChange={(e) => save.mutate({ numberFormat: e.target.value as NumberFormat })}
      >
        <option value="decimal">10.5</option>
        <option value="point">10.50</option>
      </select>
      <label>
        <input
          type="checkbox"
          checked={department.hidden === 1}
          onChange={(e) => save.mutate({ hidden: e.target.checked })}
        />{' '}
        Hidden
      </label>
      {error && <span role="alert"> {error}</span>}
    </>
  )
}

function AddDepartment({ showId }: { showId: string }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [colour, setColour] = useState('#4A90E2')
  const [numberFormat, setNumberFormat] = useState<NumberFormat>('decimal')
  const add = useMutation({
    mutationFn: () =>
      api.post(`/shows/${showId}/departments`, { code, name: name.trim(), colour, numberFormat }),
    onSuccess: () => {
      setCode('')
      setName('')
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate()
  }
  return (
    <form onSubmit={submit} aria-label="Add department" className="settings-form">
      <input
        aria-label="New department code"
        placeholder="Code (PYRO)"
        value={code}
        maxLength={8}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      <input
        aria-label="New department name"
        placeholder="Name"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        type="color"
        aria-label="New department colour"
        value={colour}
        onChange={(e) => setColour(e.target.value.toUpperCase())}
      />
      <select
        aria-label="New department number format"
        value={numberFormat}
        onChange={(e) => setNumberFormat(e.target.value as NumberFormat)}
      >
        <option value="decimal">10.5</option>
        <option value="point">10.50</option>
      </select>
      <button type="submit" disabled={add.isPending}>
        Add department
      </button>
      {add.isError && <span role="alert"> {errorText(add.error)}</span>}
    </form>
  )
}

function MembersSection({
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
  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading">Members</h2>
      {members.isError && <p role="alert">Members are not available offline.</p>}
      <ul aria-label="Members" className="settings-list">
        {members.data?.members.map((m) => (
          <li key={m.membershipId}>
            <MemberRow showId={showId} member={m} departments={departments} editable={editable} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function scopeLabel(member: Member, departments: DepartmentRow[]): string {
  if (member.departments.includes('*')) return 'all departments'
  const names = member.departments.map((id) => departments.find((d) => d.id === id)?.code ?? id)
  return names.join(', ')
}

function MemberRow({
  showId,
  member,
  departments,
  editable,
}: {
  showId: string
  member: Member
  departments: DepartmentRow[]
  editable: boolean
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (patch: { role?: Role; departments?: string[] }) =>
      api.patch(`/memberships/${member.membershipId}`, patch),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['members', showId] })
    },
    onError: (err) => setError(errorText(err)),
  })
  const all = member.departments.includes('*')
  const toggle = (id: string, on: boolean) => {
    const next = nextScope(member.departments, id, on)
    if (next) save.mutate({ departments: next })
  }
  if (!editable) {
    return (
      <>
        <strong>{member.name}</strong> {member.role}
        {member.role === 'editor' && (
          <span className="muted"> ({scopeLabel(member, departments)})</span>
        )}
      </>
    )
  }
  return (
    <>
      <strong>{member.name}</strong>
      {member.email && <span className="muted"> {member.email}</span>}
      <select
        aria-label={`${member.name} role`}
        value={member.role}
        onChange={(e) => save.mutate({ role: e.target.value as Role })}
      >
        <option value="owner">Owner</option>
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      {member.role === 'editor' && (
        <fieldset className="scope">
          <legend>Edits</legend>
          <label>
            <input
              type="checkbox"
              checked={all}
              onChange={(e) =>
                save.mutate({
                  departments: e.target.checked ? ['*'] : departments.slice(0, 1).map((d) => d.id),
                })
              }
            />{' '}
            All departments
          </label>
          {!all &&
            departments.map((d) => (
              <label
                key={d.id}
                title={
                  member.departments.includes(d.id) &&
                  !canUncheckDepartment(member.departments, d.id)
                    ? LAST_DEPARTMENT_HINT
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={member.departments.includes(d.id)}
                  disabled={
                    member.departments.includes(d.id) &&
                    !canUncheckDepartment(member.departments, d.id)
                  }
                  onChange={(e) => toggle(d.id, e.target.checked)}
                />{' '}
                {d.code}
              </label>
            ))}
          {!all && member.departments.length === 1 && (
            <span className="muted">{LAST_DEPARTMENT_HINT}</span>
          )}
        </fieldset>
      )}
      {error && <span role="alert"> {error}</span>}
    </>
  )
}
