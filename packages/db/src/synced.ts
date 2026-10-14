/**
 * The tables PowerSync replicates: the `powersync` publication, the `powersync_role` grant,
 * deploy/powersync/sync-config.yaml and the client schema must all list exactly these.
 * Later tasks append to it. `test/publication.test.ts` enforces the first three.
 */
export const SYNCED_TABLES: readonly string[] = [
  'shows',
  'show_memberships',
  'documents',
  'document_versions',
  'pages',
  'departments',
]
