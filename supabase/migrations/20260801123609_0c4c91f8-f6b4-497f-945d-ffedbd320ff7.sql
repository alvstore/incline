update integration_settings
set config = coalesce(config,'{}'::jsonb) || jsonb_build_object('place_id','ChIJq7uKbjXvZzkRnYxCp0uL3uo','place_name','Incline - Rise.Reflect.Repeat.','auto_fetch_reviews',true)
where integration_type='google_business' and branch_id='11111111-1111-1111-1111-111111111111';