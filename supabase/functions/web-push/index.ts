// v2.3.0 — owners/admins/managers can subscribe; team alerts get generic lock-screen titles + deep links.
// v2.2.0 — one device-push worker: browser (web) + Flutter (fcm). Phone push uses direct Firebase settings; connector is fallback.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { classifyFcmError, loadFcmConfig, sendFcm } from '../_shared/fcm.ts';
import webpush from 'npm:web-push@3.6.7';
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const allowedOrigins = new Set(['https://theincline.in', 'https://www.theincline.in', 'https://incline.lovable.app', 'http://localhost:8080']);
function headers(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = allowedOrigins.has(origin) || /^https:\/\/id-preview--[a-z0-9-]+\.lovable\.app$/.test(origin);
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowed ? origin : 'https://theincline.in', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
}
const FCM_GATEWAY = 'https://connector-gateway.lovable.dev/firebase_messaging';
const fcmToken = (endpoint: string) => endpoint.startsWith('fcm:') ? endpoint.slice(4) : '';
const endpointAllowed = (endpoint: string) => {
  if (endpoint.startsWith('fcm:')) return /^[A-Za-z0-9:_-]{20,4096}$/.test(endpoint.slice(4));
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' || u.hostname.endsWith('.push.services.mozilla.com') || u.hostname === 'web.push.apple.com' || u.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
};

// Team access: owner/admin = every branch; manager = branches they manage.
async function teamAccess(db: any, userId: string, branchId: string | null) {
  const { data: roles } = await db.from('user_roles').select('role').eq('user_id', userId).in('role', ['owner', 'admin', 'manager']);
  const set = new Set((roles || []).map((r: any) => r.role));
  if (set.has('owner') || set.has('admin')) return true;
  if (!set.has('manager') || !branchId) return false;
  const { data: bm } = await db.from('branch_managers').select('branch_id').eq('user_id', userId).eq('branch_id', branchId).limit(1);
  if (bm?.length) return true;
  const { data: emp } = await db.from('employees').select('id').eq('user_id', userId).eq('branch_id', branchId).limit(1);
  return Boolean(emp?.length);
}
// Lock-screen safe titles per category (no names, amounts or health data).
const TEAM_TITLES: Record<string, [string, string]> = {
  staff_late: ['Late check-in', '/staff-attendance'],
  approval: ['Approval waiting', '/approvals'],
  task: ['New task', '/tasks'],
  payment: ['Payment update', '/invoices'],
};

Deno.serve(async req => {
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: headers(req) });
  if (req.method === 'OPTIONS') return respond(200, {});
  if (req.method !== 'POST') return respond(405, { error: 'Method not allowed' });
  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const serverUrl = Deno.env.get('SUPABASE_URL');
    if (!serviceKey || !serverUrl) return respond(503, { error: 'Notifications unavailable' });
    const db = createClient(serverUrl, serviceKey, { auth: { persistSession: false } });
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const input = await req.json();
    if (!token && !req.headers.get('x-internal-token')) return respond(401, { error: 'Sign in first' });
    // Gateway may swap Authorization on DB/edge calls; the service key stays in apikey.
    const internalTok = req.headers.get('x-internal-token') || '';
    let system = token === serviceKey || req.headers.get('apikey') === serviceKey;
    if (!system && internalTok.length >= 32) { const { data: ok } = await db.rpc('verify_internal_fn_token', { p_token: internalTok }); system = ok === true; }
    const { data: authData } = system ? { data: { user: null } } : await db.auth.getUser(token);
    if (!system && !authData.user) return respond(401, { error: 'Sign in first' });
    if (input.action === 'deliver' && !system) return respond(403, { error: 'Not permitted' });

    let { data: config, error: configError } = await db.from('web_push_config').select('*').eq('id', true).maybeSingle();
    if (configError) throw configError;
    if (!config) {
      const keys = webpush.generateVAPIDKeys();
      const inserted = await db.from('web_push_config').upsert({ id: true, public_key: keys.publicKey, private_key: keys.privateKey }, { onConflict: 'id', ignoreDuplicates: true });
      if (inserted.error) throw inserted.error;
      const result = await db.from('web_push_config').select('*').eq('id', true).single();
      if (result.error) throw result.error;
      config = result.data;
    }
    if (input.action === 'config') return respond(200, { publicKey: config.public_key });

    if (input.action === 'deliver') {
      webpush.setVapidDetails('https://theincline.in', config.public_key, config.private_key);
      const { data: jobs, error } = await db.rpc('claim_web_push_deliveries');
      if (error) throw error;
      let sent = 0;
      const rows = jobs || [];
      const fcmConfig = rows.length ? await loadFcmConfig(db) : null;
      for (let offset = 0; offset < rows.length; offset += 5) {
        await Promise.all(rows.slice(offset, offset + 5).map(async job => {
          const [{ data: sub }, { data: notice }] = await Promise.all([
            db.from('web_push_subscriptions').select('*').eq('id', job.subscription_id).maybeSingle(),
            db.from('notifications').select('*').eq('id', job.notification_id).maybeSingle(),
          ]);
          const finish = async (status: string, lastError: string | null = null) => {
            const result = await db.from('web_push_deliveries').update({ status, last_error: lastError }).eq('id', job.id);
            if (result.error) throw result.error;
          };
          const isTeam = await teamAccess(db, sub?.user_id ?? '', notice?.branch_id ?? sub?.branch_id ?? null);
          if (!sub || !notice || notice.user_id !== sub.user_id || (!isTeam && notice.branch_id && notice.branch_id !== sub.branch_id) || !endpointAllowed(sub.endpoint) || Date.now() - Date.parse(notice.created_at) > 86400000) {
            await finish('suppressed', 'Unavailable or stale notification'); return;
          }
          const { data: member, error: memberLookupError } = isTeam ? { data: null, error: null } : await db.from('members').select('id,do_not_contact').eq('user_id', sub.user_id).eq('branch_id', sub.branch_id).maybeSingle();
          if (memberLookupError) { await finish('suppressed', 'Member access unavailable'); return; }
          if (!member && !isTeam) {
            // Trainers receive coaching alerts (client check-ins, PT dues) on opted-in devices.
            const { data: coach } = await db.from('trainers').select('id').eq('user_id', sub.user_id).eq('branch_id', sub.branch_id).eq('is_active', true).maybeSingle();
            if (!coach) { await finish('suppressed', 'Account access unavailable'); return; }
          }
          if (member) {
            const { data: prefs, error: preferencesError } = await db.from('member_communication_preferences').select('*').eq('member_id', member.id).eq('branch_id', sub.branch_id).maybeSingle();
            if (preferencesError) { await finish('suppressed', 'Preferences unavailable'); return; }
            const topics: Record<string, string> = { membership_reminder: 'membership_reminders', payment_receipt: 'payment_receipts', class_notification: 'class_notifications', announcement: 'announcements', retention_nudge: 'retention_nudges', review_request: 'review_requests', marketing: 'marketing' };
            const category = notice.category || 'transactional';
            if (member.do_not_contact && ['marketing', 'retention_nudge', 'review_request', 'announcement'].includes(category)) { await finish('suppressed', 'Do not contact'); return; }
            const topic = topics[category];
            if (prefs && topic && (prefs as Record<string, unknown>)[topic] === false) { await finish('suppressed', 'Topic disabled'); return; }
            // Respect quiet hours without sending an unexpected delayed lock-screen alert.
            if (prefs?.quiet_hours_start && prefs.quiet_hours_end && category !== 'transactional' && category !== 'payment_receipt') {
              const time = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.timezone || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
              const start = prefs.quiet_hours_start.slice(0, 5), end = prefs.quiet_hours_end.slice(0, 5);
              if (start !== end && (start < end ? time >= start && time < end : time >= start || time < end)) { await finish('suppressed', 'Quiet hours; notification remains in inbox'); return; }
            }
          }
          const teamKey = isTeam ? Object.keys(TEAM_TITLES).find(k => String(notice.category || '').includes(k)) : undefined;
          const home = isTeam ? (teamKey ? TEAM_TITLES[teamKey][1] : '/dashboard') : member ? '/member-dashboard' : '/trainer-dashboard';
          const rawUrl = notice.action_url || home;
          const url = rawUrl.startsWith('/') && !rawUrl.startsWith('//') ? rawUrl : home;
          // Never expose names, prices, attendance, or health data on the lock screen.
          const title = teamKey ? TEAM_TITLES[teamKey][0] : 'Incline';
          const payload = JSON.stringify({ title, body: teamKey ? 'Tap to view in Incline.' : 'You have a new update. Open Incline to view it.', url, tag: notice.id });
          if (sub.kind === 'fcm') {
            const title = String(notice.title || 'Incline Alert');
            const body = String(notice.message || notice.body || 'You have a new update.');
            const fcmMessage = { token: fcmToken(sub.endpoint), notification: { title, body },
              android: { priority: 'high', notification: { tag: String(notice.id), channel_id: 'incline_club_alerts', notification_priority: 'PRIORITY_MAX', default_sound: true, default_vibrate_timings: true } },
              data: { notification_id: String(notice.id), title, message: body, body, url } };
            if (fcmConfig) {
              // Direct Firebase (configured in Settings → Integrations); connector is fallback only.
              if (!fcmConfig.enabled) { await finish('suppressed', 'Phone push disabled; notification remains in inbox'); return; }
              try {
                const r = await sendFcm(fcmConfig.sa, fcmMessage);
                if (r.ok) { await finish('sent'); sent++; return; }
                const kind = classifyFcmError(r.status, r.body);
                if (kind === 'stale') { await db.from('web_push_subscriptions').delete().eq('id', sub.id); return; }
                if (kind === 'retry' && (job.attempts ?? 0) < 3) {
                  await db.from('web_push_deliveries').update({ status: 'pending', last_error: `Phone push HTTP ${r.status}`, next_attempt_at: new Date(Date.now() + 300000).toISOString() }).eq('id', job.id); return;
                }
                await finish('failed', `Phone push HTTP ${r.status}`); return;
              } catch { await finish('failed', 'Phone push sign-in failed'); return; }
            }
            const lovableKey = Deno.env.get('LOVABLE_API_KEY'), connKey = Deno.env.get('FIREBASE_MESSAGING_API_KEY');
            if (!lovableKey || !connKey) { await finish('suppressed', 'Phone push not connected; notification remains in inbox'); return; }
            const res = await fetch(`${FCM_GATEWAY}/v1/projects/_/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': connKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: (() => {
                const title = String(notice.title || 'Incline Alert');
                const body = String(notice.message || notice.body || 'You have a new update.');
                return { token: fcmToken(sub.endpoint), notification: { title, body },
                  android: { priority: 'high', notification: { tag: String(notice.id), channel_id: 'incline_club_alerts', notification_priority: 'PRIORITY_MAX', default_sound: true, default_vibrate_timings: true } },
                  data: { notification_id: String(notice.id), title, message: body, body, url } };
              })() }) });
            if (res.ok) { await finish('sent'); sent++; return; }
            const text = await res.text();
            if (res.status === 404 || (res.status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(text))) { await db.from('web_push_subscriptions').delete().eq('id', sub.id); return; }
            await finish('failed', `Phone push HTTP ${res.status}`); return;
          }
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload, { TTL: 3600, timeout: 8000 });
              await finish('sent'); sent++; return;
            } catch (err) {
              const status = typeof err === 'object' && err !== null && 'statusCode' in err ? Number(err.statusCode) : 0;
              if (status === 404 || status === 410) { await db.from('web_push_subscriptions').delete().eq('id', sub.id); return; }
              if (attempt === 2 || (status >= 400 && status < 500 && status !== 429)) { await finish('failed', status ? `Push provider HTTP ${status}` : 'Push provider connection failed'); return; }
              await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            }
          }
        }));
      }
      if (rows.length === 30) {
        // Drain bursts in bounded batches; never permanently poll an empty queue.
        EdgeRuntime.waitUntil(fetch(`${serverUrl}/functions/v1/web-push`, { method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deliver' }) }));
      }
      return respond(200, { processed: rows.length, sent });
    }
    const user = authData.user;
    if (!user) return respond(403, { error: 'Not permitted' });
    if (input.action === 'unsubscribe') {
      const ep = input.token ? `fcm:${String(input.token)}` : String(input.endpoint || '');
      const { error } = await db.from('web_push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', ep);
      if (error) throw error;
      return respond(200, { ok: true });
    }
    const { data: member, error: memberError } = await db.from('members').select('id,branch_id').eq('user_id', user.id).eq('branch_id', input.branch_id).maybeSingle();
    let coachId: string | null = null;
    if (!memberError && !member) {
      const { data: coach } = await db.from('trainers').select('id').eq('user_id', user.id).eq('branch_id', input.branch_id).eq('is_active', true).maybeSingle();
      coachId = coach?.id ?? null;
    }
    const team = !member && !coachId ? await teamAccess(db, user.id, String(input.branch_id || '')) : false;
    if (memberError || (!member && !coachId && !team)) return respond(403, { error: 'Member, trainer or team account required for this branch' });
    const accountBranch = member?.branch_id ?? String(input.branch_id);
    if (input.action === 'subscribe') {
      const sub = input.subscription;
      if (!sub || !endpointAllowed(sub.endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(sub.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{20,30}$/.test(sub.keys?.auth || '')) return respond(400, { error: 'Invalid browser subscription' });
      // A browser can belong to only the account currently signed in on it.
      const { error } = await db.from('web_push_subscriptions').upsert({ user_id: user.id, branch_id: accountBranch, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth_key: sub.keys.auth }, { onConflict: 'endpoint' });
      if (error) throw error;
      return respond(200, { ok: true });
    }
    if (input.action === 'register_device') {
      // Flutter: same register path as the browser; token stored as endpoint fcm:<token>.
      const token = String(input.token || '');
      if (!/^[A-Za-z0-9:_-]{20,4096}$/.test(token)) return respond(400, { error: 'Invalid device token' });
      const platform = ['android', 'ios'].includes(input.platform) ? input.platform : 'android';
      const { error } = await db.from('web_push_subscriptions').upsert({ user_id: user.id, branch_id: accountBranch, endpoint: `fcm:${token}`, kind: 'fcm', platform, p256dh: null, auth_key: null }, { onConflict: 'endpoint' });
      if (error) throw error;
      return respond(200, { ok: true });
    }
    if (input.action === 'test') {
      const { data: subscription } = await db.from('web_push_subscriptions').select('id').eq('user_id', user.id).eq('branch_id', accountBranch).eq('endpoint', String(input.endpoint || '')).maybeSingle();
      if (!subscription) return respond(400, { error: 'Enable notifications on this device first' });
      const result = await db.functions.invoke('dispatch-communication', { body: { branch_id: accountBranch, channel: 'in_app', category: 'transactional', recipient: user.id, user_id: user.id, member_id: member?.id ?? null, payload: { subject: 'Browser notification test', body: 'Your browser notification test was requested.' }, dedupe_key: `web-push-test:${user.id}:${Math.floor(Date.now() / 60000)}`, source_caller: 'web-push' } });
      if (result.error || result.data?.status === 'failed') return respond(502, { error: 'Test notification could not be queued' });
      return respond(200, { ok: true, status: result.data?.status });
    }
    return respond(400, { error: 'Unknown action' });
  } catch {
    return respond(500, { error: 'Browser notifications temporarily unavailable. Please retry.' });
  }
});