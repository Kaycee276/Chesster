-- Migration 015: Harden Row-Level Security (RLS) Policies across all Supabase Tables
-- Fixes security vulnerabilities identified in audit:
-- 1. Closes auth.jwt() IS NULL anonymous write bypasses on moves, users, and tournament_participants.
-- 2. Closes unauthenticated update exploit on games (status IN ('waiting', 'active')).
-- 3. Enables RLS on previously unmanaged tables (players, player_stats, match_audit_logs, token_wager_ledger).
-- 4. Restricts all INSERT/UPDATE/DELETE mutations strictly to service_role (the backend service).
-- 5. Preserves public SELECT access for spectators, lobbies, and audit transparency.

-- ============================================================
-- UP
-- ============================================================

DO $$
DECLARE
  tbl text;
  pol record;
  tables text[] := ARRAY[
    'games',
    'moves',
    'chat_messages',
    'users',
    'players',
    'player_stats',
    'match_audit_logs',
    'token_wager_ledger',
    'tournaments',
    'tournament_participants',
    'bracket_matches'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      -- 1. Ensure RLS is enabled on the table
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

      -- 2. Dynamically drop all existing policies on this table
      FOR pol IN (
        SELECT policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = tbl
      ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, tbl);
      END LOOP;

      -- 3. Create public read-only policy for transparency & match spectators
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (true);',
        tbl || '_select_policy',
        tbl
      );

      -- 4. Create explicit service_role policy for all mutations (backend service)
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
        tbl || '_service_role_all',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- DOWN (Rollback)
-- ============================================================
-- Note: Rolling back will reinstate the policies from Migration 014
-- and restore 'Allow all' policies on legacy ledger/audit tables.
-- Run 014_implement_rls_policies.sql to restore previous state.
