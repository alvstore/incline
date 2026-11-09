CREATE OR REPLACE FUNCTION public._audit_person_name(p_user uuid, p_member uuid DEFAULT NULL, p_employee uuid DEFAULT NULL, p_trainer uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v text;
BEGIN
  IF p_user IS NOT NULL THEN SELECT NULLIF(full_name,'') INTO v FROM profiles WHERE id = p_user; END IF;
  IF v IS NULL AND p_member IS NOT NULL THEN
    SELECT COALESCE(NULLIF(pr.full_name,''), m.member_code) INTO v FROM members m LEFT JOIN profiles pr ON pr.id = m.user_id WHERE m.id = p_member;
  END IF;
  IF v IS NULL AND p_employee IS NOT NULL THEN
    SELECT COALESCE(NULLIF(pr.full_name,''), e.employee_code) INTO v FROM employees e LEFT JOIN profiles pr ON pr.id = e.user_id WHERE e.id = p_employee;
  END IF;
  IF v IS NULL AND p_trainer IS NOT NULL THEN
    SELECT NULLIF(pr.full_name,'') INTO v FROM trainers t LEFT JOIN profiles pr ON pr.id = t.user_id WHERE t.id = p_trainer;
  END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public._audit_person_name(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._audit_person_name(uuid,uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._resolve_audit_target_name(p_table text, p_row jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_name text;
  u uuid; m uuid; e uuid; t uuid;
BEGIN
  IF p_row IS NULL THEN RETURN NULL; END IF;
  BEGIN u := NULLIF(p_row->>'user_id','')::uuid; EXCEPTION WHEN OTHERS THEN u := NULL; END;
  BEGIN m := NULLIF(p_row->>'member_id','')::uuid; EXCEPTION WHEN OTHERS THEN m := NULL; END;
  BEGIN e := NULLIF(p_row->>'employee_id','')::uuid; EXCEPTION WHEN OTHERS THEN e := NULL; END;
  BEGIN t := NULLIF(p_row->>'trainer_id','')::uuid; EXCEPTION WHEN OTHERS THEN t := NULL; END;

  CASE p_table
    WHEN 'members' THEN RETURN COALESCE(public._audit_person_name(u), p_row->>'member_code');
    WHEN 'employees' THEN RETURN COALESCE(public._audit_person_name(u), p_row->>'employee_code');
    WHEN 'trainers' THEN RETURN public._audit_person_name(u);
    WHEN 'leads' THEN RETURN p_row->>'full_name';
    WHEN 'invoices' THEN RETURN COALESCE(p_row->>'invoice_number', public._audit_person_name(NULL, m));
    WHEN 'payments' THEN RETURN COALESCE(public._audit_person_name(NULL, m) || ' · ₹' || (p_row->>'amount'), p_row->>'reference_id', '₹' || (p_row->>'amount'));
    WHEN 'memberships' THEN RETURN public._audit_person_name(NULL, m);
    WHEN 'member_pt_packages' THEN RETURN public._audit_person_name(NULL, m);
    WHEN 'pt_sessions' THEN RETURN public._audit_person_name(NULL, m, NULL, t);
    WHEN 'staff_attendance' THEN RETURN public._audit_person_name(u);
    WHEN 'member_attendance' THEN RETURN public._audit_person_name(NULL, m);
    WHEN 'contracts' THEN RETURN COALESCE(public._audit_person_name(u, NULL, e, t), p_row->>'contract_type');
    WHEN 'lockers' THEN RETURN 'Locker ' || (p_row->>'locker_number');
    WHEN 'locker_assignments' THEN RETURN public._audit_person_name(NULL, m);
    WHEN 'classes' THEN RETURN p_row->>'name';
    WHEN 'tasks' THEN RETURN p_row->>'title';
    WHEN 'equipment' THEN RETURN COALESCE(p_row->>'name', p_row->>'serial_number');
    WHEN 'equipment_maintenance' THEN RETURN p_row->>'maintenance_type';
    WHEN 'member_comps' THEN RETURN COALESCE(public._audit_person_name(NULL, m), p_row->>'reason');
    WHEN 'lead_followups' THEN RETURN p_row->>'outcome';
    WHEN 'benefit_bookings' THEN RETURN public._audit_person_name(NULL, m);
    WHEN 'class_bookings' THEN RETURN public._audit_person_name(NULL, m);
    WHEN 'member_documents' THEN RETURN COALESCE(p_row->>'file_name', p_row->>'document_type');
    WHEN 'pt_packages' THEN RETURN p_row->>'name';
    WHEN 'products' THEN RETURN p_row->>'name';
    WHEN 'expenses' THEN RETURN COALESCE(p_row->>'description', '₹' || (p_row->>'amount'));
    WHEN 'wallet_transactions' THEN RETURN COALESCE(public._audit_person_name(NULL, m), p_row->>'description');
    WHEN 'referrals' THEN RETURN p_row->>'status';
    WHEN 'announcements' THEN RETURN p_row->>'title';
    WHEN 'campaigns' THEN RETURN p_row->>'name';
    WHEN 'membership_plans' THEN RETURN p_row->>'name';
    WHEN 'branches' THEN RETURN p_row->>'name';
    WHEN 'user_roles' THEN RETURN COALESCE(public._audit_person_name(u) || ' · ' || (p_row->>'role'), p_row->>'role');
    WHEN 'integration_settings' THEN RETURN initcap(replace(COALESCE(p_row->>'provider', p_row->>'integration_type',''),'_',' '));
    ELSE
      v_name := COALESCE(p_row->>'name', p_row->>'title', p_row->>'full_name', p_row->>'label', p_row->>'code');
      RETURN COALESCE(v_name, public._audit_person_name(u, m, e, t));
  END CASE;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._audit_fill_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.target_name IS NULL AND NEW.table_name IS NOT NULL THEN
    BEGIN
      NEW.target_name := public._resolve_audit_target_name(NEW.table_name, COALESCE(NEW.new_data, NEW.old_data));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._audit_fill_target() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_logs_fill_target ON public.audit_logs;
CREATE TRIGGER audit_logs_fill_target BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public._audit_fill_target();