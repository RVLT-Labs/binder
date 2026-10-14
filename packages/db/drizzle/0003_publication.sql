-- PowerSync replicates exactly these five tables through a publication named `powersync`.
-- The auth tables (account holds password hashes) and personal_access_tokens are never published.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    CREATE PUBLICATION powersync FOR TABLE shows, show_memberships, documents, document_versions, pages;
  END IF;
END
$$;
--> statement-breakpoint
-- The replication role is created by deploy/postgres/init.sql in the dev stack and by the operator in
-- production; databases without it (the per-file test databases) simply skip the grant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
    GRANT SELECT ON shows, show_memberships, documents, document_versions, pages TO powersync_role;
  END IF;
END
$$;
