-- Convert moves atomically under the migration runner's transaction.
-- Run during a maintenance window: the copy holds an ACCESS EXCLUSIVE lock
-- and needs space for both the source and destination plus their indexes.
-- PostgreSQL requires created_at in the primary key of a range partition.
-- UUID defaults and all move columns are retained; queries still use moves.
-- No CASCADE is used: unsupported dependencies cause a complete rollback.

DO $$
DECLARE
  month_start timestamptz;
  month_end timestamptz;
  item record;
  policy_command text;
  policy_roles text;
  ddl text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_partitioned_table WHERE partrelid = 'public.moves'::regclass) THEN
    RETURN;
  END IF;

  LOCK TABLE public.moves IN ACCESS EXCLUSIVE MODE;
  CREATE TABLE public.moves_partitioned
    (LIKE public.moves INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED
      INCLUDING STORAGE INCLUDING COMMENTS)
    PARTITION BY RANGE (created_at);
  ALTER TABLE public.moves_partitioned ALTER COLUMN created_at SET NOT NULL;
  ALTER TABLE public.moves_partitioned ADD PRIMARY KEY (id, created_at);

  -- Historical occupied months plus the current and next two months, in UTC.
  FOR month_start IN
    SELECT DISTINCT date_trunc('month', COALESCE(created_at, now()) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      FROM public.moves
    UNION
    SELECT (date_trunc('month', now() AT TIME ZONE 'UTC') + n * interval '1 month') AT TIME ZONE 'UTC'
      FROM generate_series(0, 2) n
  LOOP
    month_end := ((month_start AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
    EXECUTE format('CREATE TABLE public.%I PARTITION OF public.moves_partitioned FOR VALUES FROM (%L) TO (%L)',
      'moves_' || to_char(month_start AT TIME ZONE 'UTC', 'YYYY_MM'), month_start, month_end);
  END LOOP;
  CREATE TABLE public.moves_default PARTITION OF public.moves_partitioned DEFAULT;

  -- Copy every column (including telemetry added by later migrations).
  -- Legacy NULL timestamps receive the transaction timestamp before copying.
  UPDATE public.moves SET created_at = now() WHERE created_at IS NULL;
  INSERT INTO public.moves_partitioned SELECT * FROM public.moves;

  -- Retain outbound foreign keys and their ON DELETE behavior when present.
  -- The existing games partition migration may already have removed this FK.
  FOR item IN SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid = 'public.moves'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE public.moves_partitioned ADD CONSTRAINT %I %s', item.conname, item.definition);
  END LOOP;

  -- Copy secondary indexes, using temporary names until the source is gone.
  FOR item IN SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.moves'::regclass AND NOT i.indisprimary
  LOOP
    ddl := regexp_replace(item.definition, '^CREATE (UNIQUE )?INDEX [^ ]+ ON [^ ]+',
      format('CREATE %sINDEX %I ON public.moves_partitioned',
        CASE WHEN item.definition LIKE 'CREATE UNIQUE%%' THEN 'UNIQUE ' ELSE '' END,
        item.name || '_monthly'));
    EXECUTE ddl;
  END LOOP;

  -- Preserve existing policies rather than reverting hardened RLS to allow-all.
  FOR item IN SELECT * FROM pg_policy WHERE polrelid = 'public.moves'::regclass LOOP
    policy_command := CASE item.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END;
    SELECT string_agg(CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE quote_ident(rolname) END, ', ')
      INTO policy_roles FROM unnest(item.polroles) role_oid LEFT JOIN pg_roles ON oid = role_oid;
    EXECUTE format('CREATE POLICY %I ON public.moves_partitioned AS %s FOR %s TO %s%s%s',
      item.polname, CASE WHEN item.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      policy_command, policy_roles,
      -- Deparse against the copy so correlated references use its name.
      -- Column positions are identical because the table was created with LIKE.
      CASE WHEN item.polqual IS NULL THEN '' ELSE ' USING (' || pg_get_expr(item.polqual, 'public.moves_partitioned'::regclass) || ')' END,
      CASE WHEN item.polwithcheck IS NULL THEN '' ELSE ' WITH CHECK (' || pg_get_expr(item.polwithcheck, 'public.moves_partitioned'::regclass) || ')' END);
  END LOOP;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.moves'::regclass) THEN
    ALTER TABLE public.moves_partitioned ENABLE ROW LEVEL SECURITY;
  END IF;
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.moves'::regclass) THEN
    ALTER TABLE public.moves_partitioned FORCE ROW LEVEL SECURITY;
  END IF;

  -- Preserve explicit table grants (including service-role writes).
  FOR item IN
    SELECT a.*, r.rolname FROM pg_class c,
      LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      LEFT JOIN pg_roles r ON r.oid = a.grantee WHERE c.oid = 'public.moves'::regclass
  LOOP
    EXECUTE format('GRANT %s ON public.moves_partitioned TO %s%s', item.privilege_type,
      CASE WHEN item.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(item.rolname) END,
      CASE WHEN item.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;

  -- Fail safely if a view, incoming FK, or other unsupported object depends
  -- on the old table. The runner rolls the whole transaction back.
  DROP TABLE public.moves;
  ALTER TABLE public.moves_partitioned RENAME TO moves;
  FOR item IN SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.moves'::regclass AND c.relname LIKE '%_monthly'
  LOOP
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I', item.name, left(item.name, length(item.name) - 8));
  END LOOP;

  -- Parent policies govern normal queries. Direct child access stays closed.
  FOR item IN SELECT inhrelid::regclass AS child FROM pg_inherits WHERE inhparent = 'public.moves'::regclass LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', item.child);
  END LOOP;
END $$;
