---
name: Member trainer visibility
description: Members have no RLS read access to trainers/profiles — trainer names come from the get_my_trainers() RPC
type: feature
---

Members (role `member`) have **no** RLS read path to `public.trainers` or trainer rows in `public.profiles`, and `trainers_directory` returns nothing for them because `user_visible_branch_ids()` only covers `staff_branches`.

Trainer display data for member-facing screens must come from `public.get_my_trainers()` (SECURITY DEFINER, `EXECUTE` to authenticated/service_role). It returns `trainer_id, full_name, avatar_url, trainer_code, specializations, relation` for trainers linked to the caller via: `members.assigned_trainer_id`, `member_pt_packages.trainer_id`, PT sessions of their packages, and trainers of booked classes.

Client helper: `src/lib/members/myTrainers.ts` (`fetchMyTrainers`, `trainersById`). `useMemberData()` exposes `myTrainers` + `trainerMap` and hydrates `member.assigned_trainer`, `ptPackages[].trainer`, and `upcomingClasses[].class.trainer`. Never add direct `trainers`/`profiles` joins on member pages.
