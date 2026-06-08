## Goal

Lead nurture must catch every fresh lead **inside the 24-hour WhatsApp window** with **freeform AI messages only** (no template reliance) and rotate tone/angle on every retry. We've already built the angle catalogue + similarity guard in v7.0.0 — this change is about cadence and removing the template crutch.

## Changes

### 1. Cadence: multi-touch inside the 24h window (DB-driven)
Replace the single `delay_hours` / `cooldown_hours` knobs with a **retry schedule** stored on `ai_purposes.ops_config` for `lead_nurture`:

```json
{
  "enabled": true,
  "schedule_minutes": [120, 360, 1200],   // +2h, +6h, +20h after last outbound
  "max_retries": 3,
  "window_hours": 24                       // only fire inside Meta 24h freeform window
}
```

- `schedule_minutes[i]` = minutes to wait after the **last outbound** before sending retry `i+1`.
- A nudge fires when `now - last_outbound_at >= schedule_minutes[retry_count]` AND `retry_count < max_retries` AND `now - last_inbound_at < window_hours`.
- All values editable from Settings → Automation Brain (no code redeploy).

### 2. Remove the approved-template fallback path
In `lead-nurture-followup/index.ts`:
- Delete the `outsideWindow` / `templateRow` branch and the `dispatch-communication` template call.
- If the contact is outside the 24h window: **skip silently** and mark `last_nurture_at = now()` so we don't loop. Outside-window re-engagement is a different system (campaigns / broadcast), not nurture.
- Always send freeform via the existing `send-whatsapp` insert path. The AI brain (with angle rotation from v7.0.0) is the only writer.

### 3. Bump cron frequency so the 2-hour first touch is honest
The current `lead_nurture` rule in `automation_rules` is likely on a 4-hour or 1-hour cron. Move it to **every 15 minutes** so the +2h target hits within a 15-min tolerance. Cron change is a one-line UPDATE.

### 4. Tone variety on retries — already done, just wire to retry index
v7.0.0 picks a random un-recent angle every send. Add one tweak: pass the **current retry index** into the prompt's `<runtime>` as `attempt: 1/2/3` so the angle's `prompt_hint` can scale intensity (e.g., attempt 1 = warm welcome, attempt 3 = soft-urgency close). No new tables — purely a prompt addition inside `generateNurture`.

### 5. Seed two more "warm-open" angles
The current 9 angles are good for retries 1-2. Add:
- `quick_welcome` (tone: warm, hint: "30-second welcome — name only, no pitch, no question") — best for retry 1 when no inbound has arrived in 2 h.
- `gentle_check` (tone: warm, hint: "soft check-in, single low-pressure question about what they're looking for") — for retry 2.

Both seeded via migration; admin can re-weight.

### 6. Observability
- Log `attempt_index` + chosen `angle.slug` into `automation_runs.payload` per send.
- Existing "Nurture variety (7d)" card on `/system-health` already surfaces angle distribution and fallback rate — no UI change needed.

## Files to change

- **Migration** — update `ai_purposes.ops_config` for `lead_nurture` to the new shape; seed 2 extra angles; update the `lead_nurture` row in `automation_rules` to `*/15 * * * *`.
- `supabase/functions/lead-nurture-followup/index.ts` — read `schedule_minutes` + `window_hours`, drop the template branch, pass `attempt` into the prompt.

## Verification

1. Insert a synthetic inbound for a test phone, wait 2 min, manually invoke the function → first nurture lands with `attempt=1` and angle slug A.
2. Force `last_outbound_at` back 2.5 h, re-invoke → second nurture lands with `attempt=2`, different angle slug, different hash.
3. Force `last_inbound_at` back 25 h → function logs "outside 24h window — skipped" and writes no outbound.
4. `automation_runs` shows attempt + angle distribution across the cycle.

Used the engineering-skills + senior-architect skills.