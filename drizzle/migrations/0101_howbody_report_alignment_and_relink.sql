ALTER TABLE public.howbody_body_reports
  ADD COLUMN IF NOT EXISTS ffm numeric,
  ADD COLUMN IF NOT EXISTS minerals numeric,
  ADD COLUMN IF NOT EXISTS age integer,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS segment_fat numeric[],
  ADD COLUMN IF NOT EXISTS segment_muscle numeric[],
  ADD COLUMN IF NOT EXISTS reference_ranges jsonb;
ALTER TABLE public.howbody_posture_reports
  ADD COLUMN IF NOT EXISTS age integer,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS sex text;

UPDATE public.howbody_body_reports SET
  ffm = NULLIF(full_payload->>'ffb','')::numeric,
  minerals = NULLIF(full_payload->>'isSalt','')::numeric,
  age = NULLIF(full_payload->>'age','')::numeric::int,
  height_cm = NULLIF(full_payload->>'height','')::numeric,
  sex = CASE full_payload->>'indexSex' WHEN '1' THEN 'male' WHEN '0' THEN 'female' END,
  segment_fat = CASE WHEN jsonb_typeof(full_payload->'jdzf')='array' THEN ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(full_payload->'jdzf') x) END,
  segment_muscle = CASE WHEN jsonb_typeof(full_payload->'jrjh')='array' THEN ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(full_payload->'jrjh') x) END,
  reference_ranges = (SELECT jsonb_object_agg(k, v) FROM jsonb_each(full_payload) e(k,v) WHERE k ~ '(RangeBottom|RangeTop|Bottom|Top)$')
WHERE ffm IS NULL;
UPDATE public.howbody_posture_reports SET
  age = NULLIF(full_payload->>'age','')::numeric::int,
  height_cm = NULLIF(full_payload->>'height','')::numeric,
  sex = CASE full_payload->>'indexSex' WHEN '1' THEN 'male' WHEN '0' THEN 'female' END
WHERE age IS NULL;

-- Staff link an unmatched scanner push (logged as "member not found") to a member.
CREATE OR REPLACE FUNCTION public.howbody_link_unmatched_scan(_data_key text, _member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; p jsonb; t timestamptz; rid uuid;
BEGIN
  IF rpc_guard_applies('howbody_link_unmatched_scan') AND NOT (SELECT has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[])) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO l FROM howbody_webhook_log WHERE data_key=_data_key AND raw_payload ? 'dataKey' ORDER BY created_at LIMIT 1;
  IF l IS NULL THEN RETURN jsonb_build_object('ok',false,'error','scan_not_found'); END IF;
  p := l.raw_payload;
  t := to_timestamp((p->>'testTime')::numeric);
  IF l.endpoint='body' THEN
    INSERT INTO howbody_body_reports(member_id,data_key,equipment_no,scan_id,test_time,health_score,weight,bmi,pbf,fat,smm,tbw,pr,bmr,whr,vfr,metabolic_age,target_weight,weight_control,muscle_control,fat_control,icf,ecf,ffm,minerals,age,height_cm,sex,segment_fat,segment_muscle,reference_ranges,full_payload)
    VALUES(_member_id,_data_key,p->>'equipmentNo',p->>'scanId',t,(p->>'healthScore')::numeric,(p->>'weight')::numeric,(p->>'bmi')::numeric,(p->>'pbf')::numeric,(p->>'fat')::numeric,(p->>'smm')::numeric,(p->>'tbw')::numeric,(p->>'pr')::numeric,(p->>'bmr')::numeric,(p->>'whr')::numeric,(p->>'vfr')::numeric,round((p->>'metabolicAge')::numeric)::int,(p->>'targetWeight')::numeric,(p->>'weightControl')::numeric,(p->>'muscleControl')::numeric,(p->>'fatControl')::numeric,(p->>'icf')::numeric,(p->>'ecf')::numeric,(p->>'ffb')::numeric,(p->>'isSalt')::numeric,(p->>'age')::numeric::int,(p->>'height')::numeric,CASE p->>'indexSex' WHEN '1' THEN 'male' WHEN '0' THEN 'female' END,
      ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(p->'jdzf') x),ARRAY(SELECT x::numeric FROM jsonb_array_elements_text(p->'jrjh') x),
      (SELECT jsonb_object_agg(k,v) FROM jsonb_each(p) e(k,v) WHERE k ~ '(Bottom|Top)$'),p)
    ON CONFLICT (data_key) DO UPDATE SET member_id=EXCLUDED.member_id RETURNING id INTO rid;
  ELSE
    INSERT INTO howbody_posture_reports(member_id,data_key,equipment_no,scan_id,test_time,score,head_forward,head_slant,shoulder_left,shoulder_right,high_low_shoulder,pelvis_forward,knee_left,knee_right,leg_left,leg_right,body_slope,bust,waist,hip,left_thigh,right_thigh,calf_left,calf_right,shoulder_back,up_arm_left,up_arm_right,front_img,left_img,right_img,back_img,model_url,age,height_cm,sex,full_payload)
    VALUES(_member_id,_data_key,p->>'equipmentNo',p->>'scanId',t,(p->>'score')::numeric,(p->>'headForward')::numeric,(p->>'headSlant')::numeric,(p->>'shoulderLeft')::numeric,(p->>'shoulderRight')::numeric,(p->>'highLowShoulder')::numeric,(p->>'pelvisForward')::numeric,(p->>'kneeLeft')::numeric,(p->>'kneeRight')::numeric,(p->>'legLeft')::numeric,(p->>'legRight')::numeric,(p->>'bodySlope')::numeric,(p->>'bust')::numeric,(p->>'waist')::numeric,(p->>'hip')::numeric,(p->>'leftThigh')::numeric,(p->>'rightThigh')::numeric,(p->>'calfLeft')::numeric,(p->>'calfRight')::numeric,(p->>'shoulderBack')::numeric,(p->>'upArmLeft')::numeric,(p->>'upArmRight')::numeric,p->>'frontImg',p->>'leftImg',p->>'rightImg',p->>'backImg',p->>'murl',(p->>'age')::numeric::int,(p->>'height')::numeric,CASE p->>'indexSex' WHEN '1' THEN 'male' WHEN '0' THEN 'female' END,p)
    ON CONFLICT (data_key) DO UPDATE SET member_id=EXCLUDED.member_id RETURNING id INTO rid;
  END IF;
  INSERT INTO audit_logs(action, table_name, record_id, new_data) VALUES('HOWBODY_SCAN_LINKED', 'howbody_'||l.endpoint||'_reports', rid, jsonb_build_object('data_key',_data_key,'member_id',_member_id,'scanner_user',l.third_uid));
  RETURN jsonb_build_object('ok',true,'report_id',rid,'kind',l.endpoint);
END $$;
REVOKE ALL ON FUNCTION public.howbody_link_unmatched_scan(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.howbody_link_unmatched_scan(text, uuid) TO authenticated, service_role;