
-- ============================================================
-- Security hardening: branch-scope sensitive cross-branch reads
-- ============================================================

-- 1. profiles: replace wide-open staff/trainer SELECT with branch-scoped policy
DROP POLICY IF EXISTS "Staff can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Staff view profiles for management" ON public.profiles;

CREATE POLICY "Staff read profiles in their branches"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND (
      EXISTS (SELECT 1 FROM public.members m
              WHERE m.user_id = profiles.id
                AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR EXISTS (SELECT 1 FROM public.staff_branches sb
                 WHERE sb.user_id = profiles.id
                   AND sb.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR EXISTS (SELECT 1 FROM public.trainers t
                 WHERE t.user_id = profiles.id
                   AND t.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR EXISTS (SELECT 1 FROM public.employees e
                 WHERE e.user_id = profiles.id
                   AND e.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
    )
  )
);

-- 2. trainers: drop wide-open staff_access_trainers
DROP POLICY IF EXISTS staff_access_trainers ON public.trainers;
-- (Admin manage trainers, Admins view all trainers, Staff view active trainers,
--  Trainers view own record remain in place; staff still see active trainers
--  without salary exposure via app-level projection / trainers_directory.)

-- 3. ai_memory: branch-scope staff/manager SELECT
DROP POLICY IF EXISTS ai_memory_select_staff ON public.ai_memory;
CREATE POLICY ai_memory_select_staff
ON public.ai_memory
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
);

-- 4. whatsapp_chat_settings: branch-scope staff/trainer/manager
DROP POLICY IF EXISTS "Staff can view chat settings" ON public.whatsapp_chat_settings;
DROP POLICY IF EXISTS "Staff can update chat settings" ON public.whatsapp_chat_settings;

CREATE POLICY "Staff can view chat settings"
ON public.whatsapp_chat_settings
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
);

CREATE POLICY "Staff can update chat settings"
ON public.whatsapp_chat_settings
FOR UPDATE
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
);

-- 5. campaign_recipients: branch-scope via parent campaign
DROP POLICY IF EXISTS campaign_recipients_staff ON public.campaign_recipients;
CREATE POLICY campaign_recipients_staff
ON public.campaign_recipients
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_recipients.campaign_id
        AND (c.branch_id IS NULL
             OR c.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_recipients.campaign_id
        AND (c.branch_id IS NULL
             OR c.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
    )
  )
);

-- 6. contracts: branch-scope manager arm
DROP POLICY IF EXISTS admin_access_contracts ON public.contracts;
CREATE POLICY admin_access_contracts
ON public.contracts
FOR ALL
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
);

-- 7. employees: branch-scope manager arm; self-view preserved
DROP POLICY IF EXISTS admin_access_employees ON public.employees;
CREATE POLICY admin_access_employees
ON public.employees
FOR ALL
USING (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
);

-- 8. trainers_directory view: switch to SECURITY INVOKER so caller RLS applies
ALTER VIEW public.trainers_directory SET (security_invoker = true);
