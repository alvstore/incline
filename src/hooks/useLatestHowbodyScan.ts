// Latest Howbody scan (body + posture) for a member.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HowbodyBodyReport {
  id: string;
  test_time: string | null;
  health_score: number | null;
  weight: number | null;
  bmi: number | null;
  pbf: number | null;
  fat: number | null;
  smm: number | null;
  bmr: number | null;
  vfr: number | null;
  metabolic_age: number | null;
  whr: number | null;
  tbw: number | null;
}

export interface HowbodyPostureReport {
  id: string;
  test_time: string | null;
  score: number | null;
  head_forward: number | null;
  head_slant: number | null;
  shoulder_left: number | null;
  shoulder_right: number | null;
  high_low_shoulder: number | null;
  pelvis_forward: number | null;
  knee_left: number | null;
  knee_right: number | null;
  body_slope: number | null;
  front_img: string | null;
  left_img: string | null;
  right_img: string | null;
  back_img: string | null;
  model_url: string | null;
}

export interface LatestHowbodyScan {
  body: HowbodyBodyReport | null;
  posture: HowbodyPostureReport | null;
}

export function useLatestHowbodyScan(memberId: string | null | undefined) {
  return useQuery<LatestHowbodyScan>({
    queryKey: ["howbody-latest-scan", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      if (!memberId) return { body: null, posture: null };
      const [bodyRes, postureRes] = await Promise.all([
        supabase
          .from("howbody_body_reports")
          .select("id, test_time, health_score, weight, bmi, pbf, fat, smm, bmr, vfr, metabolic_age, whr, tbw")
          .eq("member_id", memberId)
          .order("test_time", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("howbody_posture_reports")
          .select("id, test_time, score, head_forward, head_slant, shoulder_left, shoulder_right, high_low_shoulder, pelvis_forward, knee_left, knee_right, body_slope, front_img, left_img, right_img, back_img, model_url")
          .eq("member_id", memberId)
          .order("test_time", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (bodyRes.error) throw bodyRes.error;
      if (postureRes.error) throw postureRes.error;
      return {
        body: (bodyRes.data as HowbodyBodyReport | null) || null,
        posture: (postureRes.data as HowbodyPostureReport | null) || null,
      };
    },
    staleTime: 60_000,
  });
}
