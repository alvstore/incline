// v1.0.0 — RoundSMS URL builders shared by send-sms and tests.
export function roundBaseUrl(config: Record<string, string>) {
  return config.api_base_url || config.api_url || "http://voice.roundsms.co/api";
}

// Optional DLT query params — only sent when the account's parameter names are configured.
export function roundDltParams(config: Record<string, string>) {
  let q = "";
  if (config.dlt_template_param && config.dlt_template_id) q += `&${encodeURIComponent(config.dlt_template_param)}=${encodeURIComponent(config.dlt_template_id)}`;
  if (config.dlt_entity_param && config.dlt_entity_id) q += `&${encodeURIComponent(config.dlt_entity_param)}=${encodeURIComponent(config.dlt_entity_id)}`;
  return q;
}

export function roundAuthParams(credentials: Record<string, string>) {
  return `user=${encodeURIComponent(credentials.username || "")}&pass=${encodeURIComponent(credentials.password || "")}`;
}

export function roundSendUrl(phone: string, message: string, config: Record<string, string>, credentials: Record<string, string>) {
  const cleanPhone = phone.replace(/^(\+?91)/, "");
  const endpoint = config.send_endpoint || "/sendmsg.php";
  const priority = config.priority || "ndnd";
  const stype = config.stype || config.sms_type || "normal";
  return `${roundBaseUrl(config)}${endpoint}?${roundAuthParams(credentials)}&sender=${encodeURIComponent(config.sender_id || "")}&phone=${cleanPhone}&text=${encodeURIComponent(message)}&priority=${priority}&stype=${stype}${roundDltParams(config)}`;
}
