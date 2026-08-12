# Face Enrolment Per Gate — make it real

## What I found (verified against live data)

The "94 / 94 enrolled · 0 pending" panel is not measuring anything. Three separate reasons:

1. **Everyone is bulk-marked "enrolled" without proof.** The sweep worker contains a shortcut: if a gate's live face counter is greater than or equal to the number of people in the roster, it flips *every* ledger row for that gate to `enrolled`. The gate reports 104 faces, the ledger holds 94 rows, so all 94 flip green — no per-person verification ever happened. The database confirms it: 188 rows, all `enrolled`, last stamped today 15:50, while the last real push attempt was 4 Aug.

2. **The denominator is the ledger itself.** The card renders `enrolled / rows-in-ledger`. Since every row is `enrolled`, it can only ever print "94 / 94". It can never show a gap, by construction.

3. **The ledger is incomplete.** It holds 94 member rows per gate and zero staff/trainer rows, while the branch roster with photos is 100 people (94 members + 1 employee + 5 trainers), the MIPS server holds 110 face photos, and each gate reports 114 people / 104–105 faces. Four different numbers, none of which the panel shows.

The header strip above it ("104/110 faces", "114 people on device") is real — it reads live device counters. Only the per-gate enrolment card is fabricated.

## The fix

### 1. Stop fabricating enrolment
Remove the blanket parity-settle from the sweep. A person is only marked `enrolled` when a single-person push moves that gate's face counter — the attribution mechanism that already exists. Rows that were never proven get an honest `unverified` state instead of a false green.

One-time data repair: reset the 188 falsely-enrolled rows to `unverified` so the panel starts from truth rather than from the fabricated state.

### 2. Seed the ledger completely, every tick
Seed staff and trainers alongside members, and re-seed on every sweep so newly registered people appear immediately. Drop rows for people who no longer belong to the branch or lost their photo.

### 3. Redesign the card around real numbers
Replace the self-referential "94 / 94" with the four numbers that actually exist, per gate:

```text
Gate 1                                    online · synced 21:35
Faces on gate        104        (live counter from the turnstile)
People on gate       114        (live counter from the turnstile)
Should carry a face  110        (MIPS server photo count)
──────────────────────────────────────────────────────────
Verified by name      21        proven by a single-person push
Unverified            83        on the gate's counter, not yet attributed
Awaiting push          6        queued, never pushed
Retake needed          0        gate refused the photo 3x
```

- The gap between "faces on gate" and "should carry a face" becomes the single headline number: **6 behind** — the only figure that means "something is wrong".
- "Unverified" is stated plainly as *counted but not attributed to a name*, not disguised as enrolled. The firmware exposes only a count, never a roster, so this honesty is permanent.
- The named list stays, but now lists awaiting-push and retake-needed people, with attempt counts and the gate's actual refusal reason.
- Empty and error states: if the gate is offline or the server is unreachable, the card says so and shows the last known reading with its timestamp — never a zero and never a green tick.

Visual language stays on the existing system: `rounded-2xl` cards, soft slate shadows, emerald/amber/red status pills, lucide icons, skeletons while loading.

### 4. Make the sweep visibly do work
"Run sweep" reports what it actually did — pushed N, verified N, refused N — instead of "All gates already at face parity", which today is printed off the fabricated ledger.

## Technical notes

- `supabase/functions/mips-face-sweep/index.ts` — delete the parity-settle block; add `unverified` handling; seed employees/trainers; prune stale rows.
- `supabase/functions/_shared/mipsFaceState.ts` — add `unverified` to the state union and a prune helper.
- Migration — extend the state check constraint with `unverified`; one-time UPDATE resetting the falsely-enrolled rows.
- `src/components/devices/FaceEnrolmentPanel.tsx` — rebuild to read live device counters (via `mips-face-parity` `report`) joined with ledger counts; add gate-offline / stale-read states.
- No change to gate hardware behaviour or access control — this is reporting truth only.
