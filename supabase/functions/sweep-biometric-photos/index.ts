// sweep-biometric-photos v1.0.0
// Self-healing photo pipeline.
//
// Any active member / employee / trainer that HAS a profile picture but NO
// biometric photo path is repaired here: the avatar is copied into the private
// `member-photos` bucket, the biometric path is stamped on the row (which fires
// tg_push_photo_to_mips_*), and a face sync queue entry is created for every
// face terminal so the gates enrol them on the next tick.
//
// Runs from the automation brain (worker `edge:sweep-biometric-photos`).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "member-photos";
const BATCH = 25;

type Entity = "members" | "employees" | "trainers";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // Face terminals that consume the queue.
    const { data: devices } = await admin
      .from("access_devices")
      .select("id")
      .in("device_type", ["face_terminal", "face terminal"]);
    const deviceIds = (devices ?? []).map((d: { id: string }) => d.id);

    const repaired: Array<{ entity: Entity; id: string }> = [];
    const failures: Array<{ entity: Entity; id: string; error: string }> = [];

    for (const entity of ["members", "employees", "trainers"] as Entity[]) {
      const { data: rows, error } = await admin
        .from(entity)
        .select("id, user_id, biometric_photo_path")
        .is("biometric_photo_path", null)
        .not("user_id", "is", null)
        .limit(BATCH);
      if (error) {
        failures.push({ entity, id: "-", error: error.message });
        continue;
      }
      if (!rows?.length) continue;

      const userIds = rows.map((r: { user_id: string }) => r.user_id);
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);
      const byUser = new Map(
        (profiles ?? []).map((p: { id: string; full_name: string | null; avatar_url: string | null }) => [p.id, p]),
      );

      for (const row of rows as Array<{ id: string; user_id: string }>) {
        const prof = byUser.get(row.user_id);
        const avatar = prof?.avatar_url;
        if (!avatar) continue;

        try {
          const resp = await fetch(avatar);
          if (!resp.ok) throw new Error(`avatar fetch ${resp.status}`);
          const bytes = new Uint8Array(await resp.arrayBuffer());
          if (bytes.byteLength < 1024) throw new Error("avatar too small");

          const path = `biometric/${entity}/${row.id}.jpg`;
          const { error: upErr } = await admin.storage
            .from(BUCKET)
            .upload(path, bytes, { upsert: true, contentType: "image/jpeg" });
          if (upErr) throw upErr;

          const { error: updErr } = await admin
            .from(entity)
            .update({ biometric_photo_path: path, biometric_photo_url: avatar })
            .eq("id", row.id);
          if (updErr) throw updErr;

          if (deviceIds.length) {
            const { data: signed } = await admin.storage
              .from(BUCKET)
              .createSignedUrl(path, 3600);
            const photoUrl = signed?.signedUrl ?? avatar;
            const personName = prof?.full_name ?? "Unknown";
            const idCol = entity === "members" ? "member_id" : "staff_id";
            await admin.from("biometric_sync_queue").insert(
              deviceIds.map((deviceId) => ({
                [idCol]: row.id,
                device_id: deviceId,
                sync_type: "add",
                photo_url: photoUrl,
                person_uuid: row.id,
                person_name: personName,
                status: "pending",
                retry_count: 0,
              })),
            );
          }

          repaired.push({ entity, id: row.id });
        } catch (e) {
          failures.push({
            entity,
            id: row.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    if (failures.length) {
      await admin.rpc("log_error_event", {
        p_source: "sweep-biometric-photos",
        p_severity: "warning",
        p_message: `Biometric sweep: ${repaired.length} repaired, ${failures.length} failed`,
        p_context: { failures: failures.slice(0, 20) },
      }).catch(() => {});
    }

    console.log(`[sweep-biometric-photos] repaired=${repaired.length} failed=${failures.length}`);
    return json(200, { success: true, repaired: repaired.length, failed: failures.length, failures });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[sweep-biometric-photos]", message);
    return json(500, { error: message });
  }
});
