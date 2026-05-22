export interface ProviderFieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password' | 'select';
  section: 'config' | 'credentials';
  options?: { value: string; label: string }[];
}

export interface ProviderWebhookInfo {
  label: string;
  url: string;
  description?: string;
}

const SUPABASE_FUNCTION_BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

export const getWebhookInfoForProvider = (type: string, provider: string): ProviderWebhookInfo | null => {
  if (type === 'payment_gateway') {
    return {
      label: 'Payment Webhook URL',
      url: `${SUPABASE_FUNCTION_BASE}/payment-webhook`,
      description: 'Paste this URL in your payment gateway\'s webhook settings to receive real-time payment confirmations.',
    };
  }
  if (type === 'whatsapp' && provider === 'meta_cloud') {
    return {
      label: 'WhatsApp Webhook URL',
      url: `${SUPABASE_FUNCTION_BASE}/whatsapp-webhook`,
      description: 'Paste this URL in your Meta Developer Portal → WhatsApp → Configuration → Webhook Callback URL.',
    };
  }
  if (type === 'instagram') {
    return {
      label: 'Instagram Webhook URL',
      url: `${SUPABASE_FUNCTION_BASE}/meta-webhook`,
      description: 'Paste this URL in your Meta Developer Portal → Instagram → Webhooks → Callback URL. Subscribe to "messages" field.',
    };
  }
  if (type === 'messenger') {
    return {
      label: 'Messenger Webhook URL',
      url: `${SUPABASE_FUNCTION_BASE}/meta-webhook`,
      description: 'Paste this URL in your Meta Developer Portal → Messenger → Webhooks → Callback URL. Subscribe to "messages" field.',
    };
  }
  return null;
};

export const getProviderDisplayName = (type: string, provider: string): string => {
  const map: Record<string, Record<string, string>> = {
    payment_gateway: { razorpay: 'Razorpay', phonepe: 'PhonePe', ccavenue: 'CCAvenue', payu: 'PayU' },
    sms: { roundsms: 'RoundSMS', msg91: 'MSG91', gupshup: 'Gupshup', twilio: 'Twilio', textlocal: 'TextLocal', fast2sms: 'Fast2SMS', custom: 'Custom API' },
    email: { smtp: 'Custom SMTP', sendgrid: 'SendGrid', ses: 'Amazon SES', mailgun: 'Mailgun' },
    whatsapp: { meta_cloud: 'Meta Cloud API', wati: 'WATI', interakt: 'Interakt', gupshup: 'Gupshup', aisensy: 'AiSensy', custom: 'Custom API' },
    instagram: {
      instagram_meta: 'Instagram via Facebook (EAA)',
      instagram_login: 'Instagram Business Login (IGAA)',
    },
    messenger: { messenger_meta: 'Facebook Messenger (Meta)' },
    google_business: { google_business: 'Google Business Profile' },
  };
  return map[type]?.[provider] || provider.replace(/_/g, ' ');
};

const PROVIDER_SCHEMAS: Record<string, ProviderFieldDef[]> = {
  // ── Payment Gateways ──
  payment_gateway_razorpay: [
    { key: 'key_id', label: 'Key ID', placeholder: 'rzp_live_xxxxxxxxxx', type: 'text', section: 'credentials' },
    { key: 'key_secret', label: 'Key Secret', placeholder: 'Enter Razorpay Key Secret', type: 'password', section: 'credentials' },
    { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'Enter Razorpay Webhook Secret', type: 'password', section: 'credentials' },
  ],
  payment_gateway_phonepe: [
    { key: 'environment', label: 'Environment', placeholder: '', type: 'select', section: 'config', options: [{ value: 'PROD', label: 'Production' }, { value: 'UAT', label: 'UAT / Sandbox' }] },
    { key: 'merchant_id', label: 'Merchant ID', placeholder: 'Enter PhonePe Merchant ID', type: 'text', section: 'credentials' },
    { key: 'salt_key', label: 'Salt Key', placeholder: 'Enter Salt Key', type: 'password', section: 'credentials' },
    { key: 'salt_index', label: 'Salt Index', placeholder: 'e.g. 1', type: 'text', section: 'credentials' },
  ],
  payment_gateway_ccavenue: [
    { key: 'merchant_id', label: 'Merchant ID', placeholder: 'Enter CCAvenue Merchant ID', type: 'text', section: 'credentials' },
    { key: 'access_code', label: 'Access Code', placeholder: 'Enter Access Code', type: 'password', section: 'credentials' },
    { key: 'working_key', label: 'Working Key', placeholder: 'Enter Working Key', type: 'password', section: 'credentials' },
  ],
  payment_gateway_payu: [
    { key: 'environment', label: 'Environment', placeholder: '', type: 'select', section: 'config', options: [{ value: 'PROD', label: 'Production' }, { value: 'UAT', label: 'UAT / Sandbox' }] },
    { key: 'merchant_key', label: 'Merchant Key', placeholder: 'Enter PayU Merchant Key', type: 'text', section: 'credentials' },
    { key: 'merchant_salt', label: 'Merchant Salt', placeholder: 'Enter Merchant Salt', type: 'password', section: 'credentials' },
  ],

  // ── WhatsApp ──
  whatsapp_meta_cloud: [
    { key: 'phone_number_id', label: 'Phone Number ID', placeholder: 'From Meta API Setup page', type: 'text', section: 'config' },
    { key: 'business_account_id', label: 'WhatsApp Business Account ID (WABA ID)', placeholder: 'From Meta Business Suite → Business Settings → WhatsApp Accounts', type: 'text', section: 'config' },
    { key: 'webhook_verify_token', label: 'Webhook Verify Token', placeholder: 'Any secret string you choose', type: 'text', section: 'config' },
    { key: 'access_token', label: 'Permanent Access Token', placeholder: 'Enter Meta permanent access token', type: 'password', section: 'credentials' },
    { key: 'app_secret', label: 'App Secret', placeholder: 'From Meta App Dashboard → Settings → Basic', type: 'password', section: 'credentials' },
  ],
  whatsapp_wati: [
    { key: 'api_endpoint_url', label: 'API Endpoint URL', placeholder: 'https://live-server-xxxxx.wati.io', type: 'text', section: 'config' },
    { key: 'access_token', label: 'Access Token', placeholder: 'Enter WATI access token', type: 'password', section: 'credentials' },
  ],
  whatsapp_interakt: [
    { key: 'api_key', label: 'API Key (Base64 Encoded)', placeholder: 'Enter Interakt API key', type: 'password', section: 'credentials' },
  ],
  whatsapp_gupshup: [
    { key: 'app_name', label: 'App Name', placeholder: 'Your Gupshup app name', type: 'text', section: 'config' },
    { key: 'source_phone_number', label: 'Source Phone Number', placeholder: '+91xxxxxxxxxx', type: 'text', section: 'config' },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter Gupshup API key', type: 'password', section: 'credentials' },
  ],
  whatsapp_aisensy: [
    { key: 'api_key', label: 'API Key', placeholder: 'Enter AiSensy API key', type: 'password', section: 'credentials' },
  ],
  whatsapp_custom: [
    { key: 'phone_number_id', label: 'Phone Number ID', placeholder: 'Provider phone number ID', type: 'text', section: 'config' },
    { key: 'business_account_id', label: 'Business Account ID', placeholder: 'Provider business account ID', type: 'text', section: 'config' },
    { key: 'webhook_verify_token', label: 'Webhook Verify Token', placeholder: 'Your chosen verify token', type: 'text', section: 'config' },
    { key: 'access_token', label: 'Access Token', placeholder: 'Enter access token', type: 'password', section: 'credentials' },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter API key', type: 'password', section: 'credentials' },
  ],

  // ── SMS ──
  sms_roundsms: [
    { key: 'sender_id', label: 'Sender ID', placeholder: 'e.g. GYMBLR', type: 'text', section: 'config' },
    { key: 'priority', label: 'Priority', placeholder: '', type: 'select', section: 'config', options: [{ value: 'ndnd', label: 'NDND' }, { value: 'dnd', label: 'DND' }] },
    { key: 'stype', label: 'SMS Type', placeholder: '', type: 'select', section: 'config', options: [{ value: 'normal', label: 'Normal' }, { value: 'flash', label: 'Flash' }, { value: 'unicode', label: 'Unicode' }] },
    { key: 'api_base_url', label: 'API Base URL', placeholder: 'http://voice.roundsms.co/api', type: 'text', section: 'config' },
    { key: 'send_endpoint', label: 'Send SMS Endpoint', placeholder: '/sendmsg.php', type: 'text', section: 'config' },
    { key: 'schedule_endpoint', label: 'Schedule SMS Endpoint', placeholder: '/schedulemsg.php', type: 'text', section: 'config' },
    { key: 'balance_endpoint', label: 'Check Balance Endpoint', placeholder: '/checkbalance.php', type: 'text', section: 'config' },
    { key: 'senderids_endpoint', label: 'Get Sender IDs Endpoint', placeholder: '/getsenderids.php', type: 'text', section: 'config' },
    { key: 'addsenderid_endpoint', label: 'Add Sender ID Endpoint', placeholder: '/addsenderid.php', type: 'text', section: 'config' },
    { key: 'dlr_endpoint', label: 'Delivery Report Endpoint', placeholder: '/recdlr.php', type: 'text', section: 'config' },
    { key: 'username', label: 'Username', placeholder: 'Your RoundSMS user value', type: 'text', section: 'credentials' },
    { key: 'password', label: 'Password', placeholder: 'Your RoundSMS pass value', type: 'password', section: 'credentials' },
  ],
  sms_msg91: [
    { key: 'sender_id', label: 'Sender ID', placeholder: 'e.g. GYMBLR', type: 'text', section: 'config' },
    { key: 'dlt_entity_id', label: 'DLT Principal Entity ID', placeholder: 'Enter DLT Entity ID', type: 'text', section: 'config' },
    { key: 'dlt_template_id', label: 'DLT Template ID', placeholder: 'Enter DLT Template ID from MSG91', type: 'text', section: 'config' },
    { key: 'template_id', label: 'MSG91 Flow Template ID', placeholder: 'Enter MSG91 Flow Template ID', type: 'text', section: 'config' },
    { key: 'route', label: 'Route', placeholder: '', type: 'select', section: 'config', options: [{ value: '4', label: 'Transactional' }, { value: '1', label: 'Promotional' }] },
    { key: 'auth_key', label: 'Auth Key', placeholder: 'Enter MSG91 Auth Key', type: 'password', section: 'credentials' },
  ],
  sms_gupshup: [
    { key: 'app_name', label: 'App Name', placeholder: 'Your Gupshup app name', type: 'text', section: 'config' },
    { key: 'sender_id', label: 'Sender ID', placeholder: 'e.g. GYMBLR', type: 'text', section: 'config' },
    { key: 'dlt_entity_id', label: 'DLT Principal Entity ID', placeholder: 'Enter DLT Entity ID', type: 'text', section: 'config' },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter Gupshup API key', type: 'password', section: 'credentials' },
  ],
  sms_twilio: [
    { key: 'from_number', label: 'From Number', placeholder: '+1xxxxxxxxxx', type: 'text', section: 'config' },
    { key: 'account_sid', label: 'Account SID', placeholder: 'Enter Twilio Account SID', type: 'text', section: 'credentials' },
    { key: 'auth_token', label: 'Auth Token', placeholder: 'Enter Twilio Auth Token', type: 'password', section: 'credentials' },
  ],
  sms_textlocal: [
    { key: 'sender_name', label: 'Sender Name', placeholder: 'e.g. GYMFIT', type: 'text', section: 'config' },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter TextLocal API key', type: 'password', section: 'credentials' },
  ],
  sms_fast2sms: [
    { key: 'sender_id', label: 'Sender ID', placeholder: 'e.g. GYMBLR', type: 'text', section: 'config' },
    { key: 'dlt_entity_id', label: 'DLT Principal Entity ID', placeholder: 'Enter DLT Entity ID', type: 'text', section: 'config' },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter Fast2SMS API key', type: 'password', section: 'credentials' },
  ],
  sms_custom: [
    { key: 'sender_id', label: 'Sender ID', placeholder: 'Your sender ID', type: 'text', section: 'config' },
    { key: 'api_url', label: 'API URL', placeholder: 'https://your-api.com/sms', type: 'text', section: 'config' },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter API key', type: 'password', section: 'credentials' },
    { key: 'auth_token', label: 'Auth Token', placeholder: 'Enter auth token', type: 'password', section: 'credentials' },
  ],

  // ── Email ──
  email_smtp: [
    { key: 'host', label: 'SMTP Host', placeholder: 'smtp.gmail.com', type: 'text', section: 'config' },
    { key: 'port', label: 'Port', placeholder: '587', type: 'text', section: 'config' },
    { key: 'encryption', label: 'Encryption', placeholder: '', type: 'select', section: 'config', options: [{ value: 'tls', label: 'TLS' }, { value: 'ssl', label: 'SSL' }, { value: 'none', label: 'None' }] },
    { key: 'from_email', label: 'From Email', placeholder: 'noreply@yourgym.com', type: 'text', section: 'config' },
    { key: 'from_name', label: 'From Name', placeholder: 'Your Gym Name', type: 'text', section: 'config' },
    { key: 'username', label: 'Username', placeholder: 'SMTP username', type: 'text', section: 'credentials' },
    { key: 'password', label: 'Password', placeholder: 'SMTP password', type: 'password', section: 'credentials' },
  ],
  email_sendgrid: [
    { key: 'from_email', label: 'From Email', placeholder: 'noreply@yourgym.com', type: 'text', section: 'config' },
    { key: 'from_name', label: 'From Name', placeholder: 'Your Gym Name', type: 'text', section: 'config' },
    { key: 'api_key', label: 'API Key', placeholder: 'SG.xxxxxxxxxx', type: 'password', section: 'credentials' },
  ],
  email_ses: [
    { key: 'region', label: 'AWS Region', placeholder: 'ap-south-1', type: 'text', section: 'config' },
    { key: 'from_email', label: 'From Email', placeholder: 'noreply@yourgym.com', type: 'text', section: 'config' },
    { key: 'from_name', label: 'From Name', placeholder: 'Your Gym Name', type: 'text', section: 'config' },
    { key: 'access_key_id', label: 'Access Key ID', placeholder: 'AKIA...', type: 'text', section: 'credentials' },
    { key: 'secret_access_key', label: 'Secret Access Key', placeholder: 'Enter AWS Secret Access Key', type: 'password', section: 'credentials' },
  ],
  email_mailgun: [
    { key: 'domain', label: 'Domain', placeholder: 'mg.yourgym.com', type: 'text', section: 'config' },
    { key: 'from_email', label: 'From Email', placeholder: 'noreply@yourgym.com', type: 'text', section: 'config' },
    { key: 'from_name', label: 'From Name', placeholder: 'Your Gym Name', type: 'text', section: 'config' },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter Mailgun API key', type: 'password', section: 'credentials' },
  ],

  // ── Instagram ──
  instagram_instagram_meta: [
    { key: 'instagram_account_id', label: 'Instagram Business Account ID', placeholder: 'From Meta Business Suite → Instagram Accounts', type: 'text', section: 'config' },
    { key: 'page_id', label: 'Linked Facebook Page ID', placeholder: 'The Facebook Page linked to your IG account', type: 'text', section: 'config' },
    { key: 'webhook_verify_token', label: 'Webhook Verify Token', placeholder: 'Any secret string you choose', type: 'text', section: 'config' },
    { key: 'access_token', label: 'Page Access Token', placeholder: 'Enter Meta permanent page access token', type: 'password', section: 'credentials' },
    { key: 'app_secret', label: 'App Secret', placeholder: 'From Meta App Dashboard → Settings → Basic', type: 'password', section: 'credentials' },
  ],

  // ── Messenger ──
  messenger_messenger_meta: [
    { key: 'page_id', label: 'Facebook Page ID', placeholder: 'From Facebook Page → About → Page ID', type: 'text', section: 'config' },
    { key: 'webhook_verify_token', label: 'Webhook Verify Token', placeholder: 'Any secret string you choose', type: 'text', section: 'config' },
    { key: 'access_token', label: 'Page Access Token', placeholder: 'Enter Meta permanent page access token', type: 'password', section: 'credentials' },
    { key: 'app_secret', label: 'App Secret', placeholder: 'From Meta App Dashboard → Settings → Basic', type: 'password', section: 'credentials' },
  ],

  // ── Google Business ──
  // Used ONLY to fetch Google reviews and post replies. Customer reviews can
  // never be created via API — members must post them on Google themselves.
  google_business_google_business: [
    { key: 'account_id', label: 'Account ID', placeholder: 'Google Business Account ID', type: 'text', section: 'config' },
    { key: 'location_id', label: 'Location ID', placeholder: 'Google Business Location ID', type: 'text', section: 'config' },
    { key: 'auto_fetch_reviews', label: 'Auto-fetch new Google reviews', placeholder: '', type: 'select', section: 'config', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
    { key: 'client_id', label: 'OAuth Client ID', placeholder: 'Enter Google OAuth Client ID', type: 'text', section: 'credentials' },
    { key: 'client_secret', label: 'OAuth Client Secret', placeholder: 'Enter Client Secret', type: 'password', section: 'credentials' },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter Google API key', type: 'password', section: 'credentials' },
  ],
};

export const getProviderSchema = (type: string, provider: string): ProviderFieldDef[] => {
  const key = `${type}_${provider}`;
  return PROVIDER_SCHEMAS[key] || [];
};

export const getDefaultConfigForProvider = (type: string, provider: string): Record<string, string> => {
  if (type === 'sms' && provider === 'roundsms') {
    return {
      api_base_url: 'http://voice.roundsms.co/api',
      send_endpoint: '/sendmsg.php',
      schedule_endpoint: '/schedulemsg.php',
      balance_endpoint: '/checkbalance.php',
      senderids_endpoint: '/getsenderids.php',
      addsenderid_endpoint: '/addsenderid.php',
      dlr_endpoint: '/recdlr.php',
      priority: 'ndnd',
      stype: 'normal',
    };
  }
  return {};
};
