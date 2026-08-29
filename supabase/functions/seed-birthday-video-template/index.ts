// One-shot: submit the VIDEO-header birthday template to Meta.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/functions/v1/manage-whatsapp-templates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      apikey: key,
      "x-system-call": "template-manager-worker",
    },
    body: JSON.stringify({
      action: "create",
      branch_id: "11111111-1111-1111-1111-111111111111",
      template_data: {
        name: "member_birthday_wish_video",
        category: "UTILITY",
        language: "en",
        body_text:
          "Happy Birthday, {{1}}! 🎉 The entire team at The Incline Life by Incline wishes you a year of strength, energy and progress. Rise. Reflect. Repeat.",
        header_type: "video",
        header_sample_url:
          "https://iyqqpbvnszyrrgerniog.supabase.co/storage/v1/object/public/template-media/birthday%2Fincline-birthday-video.mp4",
        local_template_id: "176be82b-66e5-41d3-9322-bcd080d2209e",
      },
    }),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
