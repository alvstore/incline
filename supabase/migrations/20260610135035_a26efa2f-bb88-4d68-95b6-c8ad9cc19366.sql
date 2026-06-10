
-- Restore grants on high-traffic tables so owner/admin payroll/HR screens keep working.
GRANT SELECT (pan_number, aadhaar_last4, aadhaar_hash, bank_account, bank_ifsc, bank_name, uan_number, esic_ip_number, salary, tax_id, salary_type)
  ON public.employees TO authenticated;

GRANT SELECT (salary, base_salary, commission_percentage, terms, contract_variables)
  ON public.contracts TO authenticated;

GRANT SELECT (employer_pan, employer_firm_registration_no, posh_ic)
  ON public.hr_settings TO authenticated;

GRANT SELECT (government_id_number, government_id_type)
  ON public.trainers TO authenticated;

GRANT SELECT (government_id_number, government_id_type, government_id_verified)
  ON public.profiles TO authenticated;
