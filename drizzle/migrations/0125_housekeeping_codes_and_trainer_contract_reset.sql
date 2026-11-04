UPDATE public.mips_person_aliases a SET target_type='employee', target_id=v.id
FROM (VALUES ('HS1001','bb2a5d7a-f84c-4450-98a2-e7b9e3c2267f'::uuid),('HS1002','b86fc3e2-548c-49b2-9832-3fa02bf90482'::uuid),('STAFF1','61c8522a-9209-4eb0-9d61-6f6c1cefb882'::uuid),('STAFF2','14961a89-5d2d-499c-914b-c2da03929430'::uuid)) v(code,id)
WHERE upper(a.person_code)=v.code;
UPDATE public.employees e SET hire_date='2026-07-27', employee_code=v.c, mips_person_sn=replace(v.c,'-',''), mips_sync_status='pending'
FROM (VALUES ('bb2a5d7a-f84c-4450-98a2-e7b9e3c2267f'::uuid,'EMP-INC-0005'),('b86fc3e2-548c-49b2-9832-3fa02bf90482'::uuid,'EMP-INC-0006'),('61c8522a-9209-4eb0-9d61-6f6c1cefb882'::uuid,'EMP-INC-0007'),('14961a89-5d2d-499c-914b-c2da03929430'::uuid,'EMP-INC-0008')) v(id,c) WHERE e.id=v.id;
DELETE FROM public.contracts WHERE trainer_id IS NOT NULL AND coalesce(signature_status,'')<>'signed';