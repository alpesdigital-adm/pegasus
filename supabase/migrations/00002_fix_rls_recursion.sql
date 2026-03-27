-- Fix infinite recursion in RLS policies for users and organizations tables.
-- The original policies queried the `users` table from within itself, causing
-- PostgreSQL to re-evaluate the policy in a loop.
--
-- Solution: a SECURITY DEFINER function that reads org_id bypassing RLS.

-- 1) Helper function (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid();
$$;

-- 2) Drop old recursive policies
DROP POLICY IF EXISTS "users_same_org" ON users;
DROP POLICY IF EXISTS "users_own_org" ON organizations;

-- 3) Users: own row access (all operations)
CREATE POLICY "users_own_row" ON users
  FOR ALL USING (id = auth.uid());

-- 4) Users: read access to same-org members
CREATE POLICY "users_same_org_read" ON users
  FOR SELECT USING (org_id = public.get_user_org_id());

-- 5) Organizations: full access to own org
CREATE POLICY "org_own" ON organizations
  FOR ALL USING (id = public.get_user_org_id());

-- 6) Organizations: any authenticated user can create (onboarding)
CREATE POLICY "org_insert" ON organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
