import { supabase } from '@/integrations/supabase/client';

interface PushResponse { publicKey?: string; error?: string; ok?: boolean }
async function request(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke<PushResponse>('web-push', { body });
  if (error) throw new Error('Notifications could not be updated. Please try again.');
  if (!data || data.error) throw new Error(data?.error || 'Notifications unavailable');
  return data;
}
export function pushSupport() {
  if (typeof window === 'undefined') return 'unsupported';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !standalone) return 'install';
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return Notification.permission === 'denied' ? 'blocked' : 'supported';
}
async function registration() { return navigator.serviceWorker.register('/push-sw.js', { scope: '/' }); }
export async function currentPushSubscription() {
  if (pushSupport() !== 'supported') return null;
  const worker = await navigator.serviceWorker.getRegistration('/');
  return worker?.pushManager.getSubscription() || null;
}
export async function enablePush(branchId: string, publicKey: string) {
  // Permission is requested only in response to an explicit click.
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was not granted.');
  const worker = await registration();
  await navigator.serviceWorker.ready;
  const padding = '='.repeat((4 - publicKey.length % 4) % 4);
  const raw = atob((publicKey + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const applicationServerKey = Uint8Array.from(raw, char => char.charCodeAt(0));
  let subscription = await worker.pushManager.getSubscription();
  if (!subscription) subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  await request({ action: 'subscribe', branch_id: branchId, subscription: subscription.toJSON() });
}
export async function disablePush() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await request({ action: 'unsubscribe', endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
export async function testPush(branchId: string) {
  const subscription = await currentPushSubscription();
  if (!subscription) throw new Error('Enable notifications first.');
  await request({ action: 'test', branch_id: branchId, endpoint: subscription.endpoint });
}
export async function pushPublicKey() {
  const result = await request({ action: 'config' });
  if (!result.publicKey) throw new Error('Notifications unavailable');
  return result.publicKey;
}
export async function pushEnabled(userId: string, branchId: string) {
  const subscription = await currentPushSubscription();
  if (!subscription) return false;
  const { data, error } = await supabase.from('web_push_subscriptions').select('id').eq('user_id', userId).eq('branch_id', branchId).eq('endpoint', subscription.endpoint).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}