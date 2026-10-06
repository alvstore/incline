// v1.0.0 — opt-in browser delivery of existing in-app notifications.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import webpush from 'npm:web-push@3.6.7';
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const allowedOrigins = new Set(['https://theincline.in', 'https://www.theincline.in', 'https://incline.lovable.app', 'http://localhost:8080']);
function headers(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = allowedOrigins.has(origin) || /^https:\/\/id-preview--[a-z0-9-]+\.lovable\.app$/.test(origin);
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowed ? origin : 'https://theincline.in', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
}
const endpointAllowed = (endpoint: string) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' || u.hostname.endsWith('.push.services.mozilla.com') || u.hostname === 'web.push.apple.com' || u.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
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
    if (!token) return respond(401, { error: 'Sign in first' });
    const system = token === serviceKey;
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
          if (!sub || !notice || notice.user_id !== sub.user_id || (notice.branch_id && notice.branch_id !== sub.branch_id) || !endpointAllowed(sub.endpoint) || Date.now() - Date.parse(notice.created_at) > 86400000) {
            await finish('suppressed', 'Unavailable or stale notification'); return;
          }
          const { data: member } = await db.from('members').select('id').eq('user_id', sub.user_id).eq('branch_id', sub.branch_id).maybeSingle();
          if (member) {
            const { data: prefs } = await db.from('member_communication_preferences').select('*').eq('member_id', member.id).eq('branch_id', sub.branch_id).maybeSingle();
            const topics: Record<string, string> = { membership_reminder: 'membership_reminders', payment_receipt: 'payment_receipts', class_notification: 'class_notifications', announcement: 'announcements', retention_nudge: 'retention_nudges', review_request: 'review_requests', marketing: 'marketing' };
            const category = notice.category || 'transactional';
            const topic = topics[category];
            if (prefs && topic && (prefs as Record<string, unknown>)[topic] === false) { await finish('suppressed', 'Topic disabled'); return; }
            // Respect quiet hours without sending an unexpected delayed lock-screen alert.
            if (prefs?.quiet_hours_start && prefs.quiet_hours_end && category !== 'transactional' && category !== 'payment_receipt') {
              const time = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.timezone || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
              const start = prefs.quiet_hours_start.slice(0, 5), end = prefs.quiet_hours_end.slice(0, 5);
              if (start !== end && (start < end ? time >= start && time < end : time >= start || time < end)) { await finish('suppressed', 'Quiet hours; notification remains in inbox'); return; }
            }
          }
          const rawUrl = notice.action_url || '/member-dashboard';
          const url = rawUrl.startsWith('/') && !rawUrl.startsWith('//') ? rawUrl : '/member-dashboard';
          // Never expose names, prices, attendance, or health data on the lock screen.
          const payload = JSON.stringify({ title: 'Incline', body: 'You have a new update. Open Incline to view it.', url, tag: notice.id });
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
        EdgeRuntime.waitUntil(db.functions.invoke('web-push', { body: { action: 'deliver' } }));
      }
      return respond(200, { processed: rows.length, sent });
    }
    const user = authData.user;
    if (!user) return respond(403, { error: 'Not permitted' });
    if (input.action === 'unsubscribe') {
      const { error } = await db.from('web_push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', String(input.endpoint || ''));
      if (error) throw error;
      return respond(200, { ok: true });
    }
    const { data: member, error: memberError } = await db.from('members').select('id,branch_id').eq('user_id', user.id).eq('branch_id', input.branch_id).maybeSingle();
    if (memberError || !member) return respond(403, { error: 'Member account required for this branch' });
    if (input.action === 'subscribe') {
      const sub = input.subscription;
      if (!sub || !endpointAllowed(sub.endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(sub.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{20,30}$/.test(sub.keys?.auth || '')) return respond(400, { error: 'Invalid browser subscription' });
      // A browser can belong to only the account currently signed in on it.
      const { error } = await db.from('web_push_subscriptions').upsert({ user_id: user.id, branch_id: member.branch_id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth_key: sub.keys.auth }, { onConflict: 'endpoint' });
      if (error) throw error;
      return respond(200, { ok: true });
    }
    if (input.action === 'test') {
      const { data: subscription } = await db.from('web_push_subscriptions').select('id').eq('user_id', user.id).eq('branch_id', member.branch_id).eq('endpoint', String(input.endpoint || '')).maybeSingle();
      if (!subscription) return respond(400, { error: 'Enable notifications on this device first' });
      const result = await db.functions.invoke('dispatch-communication', { body: { branch_id: member.branch_id, channel: 'in_app', category: 'transactional', recipient: user.id, user_id: user.id, member_id: member.id, payload: { subject: 'Browser notification test', body: 'Your browser notification test was requested.' }, dedupe_key: `web-push-test:${user.id}:${Math.floor(Date.now() / 60000)}`, source_caller: 'web-push' } });
      if (result.error || result.data?.status === 'failed') return respond(502, { error: 'Test notification could not be queued' });
      return respond(200, { ok: true, status: result.data?.status });
    }
    return respond(400, { error: 'Unknown action' });
  } catch {
    return respond(500, { error: 'Browser notifications temporarily unavailable. Please retry.' });
  }
});