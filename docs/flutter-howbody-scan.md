# Flutter — HOWBODY scanner QR link (`/scan-login`)

How the member app links a member to a HOWBODY body-composition or posture scanner, matching the web page at `https://theincline.in/scan-login`.

## 1. What the scanner QR contains

The scanner screen shows a QR that opens:

```text
https://theincline.in/scan-login?equipmentNo=<DEVICE_NO>&scanId=<SCAN_ID>&kind=body|posture
```

`kind` may also arrive as `scanType`. Missing/unknown → `body`. Older devices may use the path `/howbody-login` — treat it the same.

## 2. Flow

```text
Scanner QR ──► in-app scanner (mobile_scanner) or OS camera via App/Universal Link
          ──► parse equipmentNo, scanId, kind
          ──► "Link to scanner" sheet: device name, scan type toggle, height (cm ⇄ ft/in)
          ──► POST howbody-bind-user
          ──► "Step on the scanner" state, poll session until completed
          ──► open the new report in Progress → Scan Reports
```

## 3. Deep links

- Android App Links + iOS Universal Links for host `theincline.in`, paths `/scan-login*` and `/howbody-login*`.
- If the app is not installed, the OS opens the web page — which already works. No fallback code needed.
- If the member is signed out, keep the parsed params, sign in, then resume the sheet.

## 4. Parsing

```dart
ScanLink? parseScanLink(String raw) {
  final uri = Uri.tryParse(raw);
  if (uri == null || uri.host.replaceFirst('www.', '') != 'theincline.in') return null;
  if (!uri.path.startsWith('/scan-login') && !uri.path.startsWith('/howbody-login')) return null;
  final equipmentNo = uri.queryParameters['equipmentNo']?.trim() ?? '';
  final scanId = uri.queryParameters['scanId']?.trim() ?? '';
  if (equipmentNo.isEmpty || scanId.isEmpty) return null; // ask to re-scan
  final k = (uri.queryParameters['kind'] ?? uri.queryParameters['scanType'] ?? '').toLowerCase();
  return ScanLink(equipmentNo, scanId, k == 'posture' ? 'posture' : 'body');
}
```

Reject any other host — never call the backend for a QR from another domain.

## 5. Device name

Show the friendly device name from the device inventory (same lookup the web uses, `howbody_devices` by `equipment_no`); fall back to the raw `equipmentNo`.

## 6. Height (required)

The scanner cannot calculate BMI or body fat without height.

- Prefill from the member's latest `member_measurements.height_cm` (newest `recorded_at`, non-null). Show "Taken from the last record — correct it if it has changed."
- Unit toggle **cm | ft / in**. Remember the member's choice locally.
- Conversion (same as web `src/lib/scans/height.ts`):
  - `cm = round((feet × 12 + inches) × 2.54, 1 decimal)` — 5 ft 9 in → 175.3 cm
  - `totalInches = round(cm / 2.54)`, `feet = totalInches ~/ 12`, `inches = totalInches % 12` — 168 cm → 5 ft 6 in
- Show the other unit as a live hint ("≈ 5 ft 6 in" / "≈ 175.3 cm").
- Valid range **100–250 cm** (≈ 3 ft 3 in – 8 ft 2 in). Feet 3–8, inches 0–11.
- **Always send centimetres** (`heightCm`, number). Never send feet/inches.

## 7. Bind call

```dart
final res = await supabase.functions.invoke('howbody-bind-user', body: {
  'equipmentNo': link.equipmentNo,
  'scanId': link.scanId,
  'memberId': myMemberId,      // server checks it belongs to the signed-in user
  'kind': selectedKind,        // 'body' | 'posture'
  'heightCm': heightCm,        // 100.0–250.0
});
final data = res.data as Map<String, dynamic>?;
if (data?['ok'] != true) showError(data?['error'] ?? 'Could not link to the scanner.');
```

Server rules (do not duplicate on the client, just show the message verbatim):
- Scanner must be authorised (`howbody_device_authorized`), member must be active.
- Scan entitlement is checked per kind (`howbody_scan_quota`) — body credits never pay for posture and vice versa. The error says which credit is missing.
- A scan already bound to someone else is refused.

## 8. Waiting for the result

`howbody_scan_sessions` is **not** on Realtime. Poll instead:

```dart
// every 5 s, stop after 10 min or when the screen closes
final row = await supabase
  .from('howbody_scan_sessions')
  .select('status, completed_at, kind')
  .eq('scan_id', link.scanId)
  .maybeSingle();
if (row?['status'] == 'completed') openLatestReport(kind: row!['kind']);
```

Statuses: `pending` → `bound` → `completed`. Members can read only their own session (RLS). The member also gets the normal "scan report ready" notification, so the inbox is a second path.

Reports: body → `howbody_body_reports`, posture → `howbody_posture_reports`, newest for this member.

## 9. UX & accessibility

- Camera permission: explain why before asking; if denied, offer "Open settings" or suggest scanning with the phone's own camera (the App/Universal Link opens the app).
- Torch toggle, 44×44 targets, haptic tick on successful parse.
- Unit toggle is a radio group with labels "Centimetres" / "Feet and inches"; inputs labelled "Height in centimetres", "Feet", "Inches".
- Never show prices or credit costs on this screen.

## 10. Feature flag

There is no server flag for this yet. Ship the in-app scanner button behind a client remote-config switch (default **on**). Turning it off only hides the button — deep links still fall back to the working web page. If a server flag is needed later, add it to `settings` in the web project first and read it the standard way (README §7).

## 11. Tests

- Parser: valid URL, `scanType` alias, `/howbody-login`, foreign host rejected, missing scanId rejected.
- Height: 5'9" → 175.3, 168 → 5'6", 182.6 → 6'0", 99.9/250.1 invalid.
- Bind: error message shown verbatim; height always sent in cm.
