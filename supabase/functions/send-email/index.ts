// v2.4.0 — Honor skip_log from dispatcher to avoid duplicate communication_logs rows.
//           Mirrors send-whatsapp v2.2.0. When dispatch-communication invokes send-email
//           it already owns the canonical log row (with channel + dedupe_key); this
//           prevents the second orphan row that was breaking Live Feed grouping.
// v2.3.0 — SMTP IO hardened: chunked DATA writes (16KB), proper readUntilSmtpResponse
//           loop with 120s post-DATA timeout — fixes Hostinger 421 timeout on
//           multipart messages with PDF attachments.
// v2.2.0 — Branded email shell now supports optional logo image and unsubscribe footer.
// v2.1.0 — SMTP path now sends multipart/mixed with base64 PDF attachments;
//           communication log records attachment metadata for auditability.
// v2.0.0 — Universal Email Dispatcher with Branded Template Support
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Branded HTML Email Template ─────────────────────────────────────────────
function wrapInBrandedTemplate(
  bodyHtml: string,
  subject: string,
  variables?: Record<string, string>,
  opts?: { logoUrl?: string; brandName?: string; unsubscribeUrl?: string; branchName?: string },
): string {
  let content = bodyHtml;
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
    }
  }

  const logoBlock = opts?.logoUrl
    ? `<img src="${opts.logoUrl}" alt="${opts?.brandName ?? 'Incline'}" style="max-height:48px;display:block;margin:0 auto 8px;" />`
    : `<p class="logo-text">INCLINE</p><p class="logo-sub">Rise. Reflect. Repeat.</p>`;

  // Branch name intentionally omitted from header — brand is single-identity "INCLINE".
  const branchLine = '';

  const unsubBlock = opts?.unsubscribeUrl
    ? `<p style="margin-top:14px;"><a href="${opts.unsubscribeUrl}" style="color:#ffffff40;font-size:11px;">Unsubscribe from marketing emails</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #000000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .wrapper { background-color: #000000; width: 100%; padding: 32px 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #111111; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #000000 0%, #1a1a1a 100%); padding: 32px 40px; text-align: center; border-bottom: 2px solid #EAB308; }
    .logo-text { color: #EAB308; font-size: 28px; font-weight: 800; letter-spacing: 2px; margin: 0; }
    .logo-sub { color: #ffffff60; font-size: 11px; letter-spacing: 4px; text-transform: uppercase; margin-top: 4px; }
    .body { padding: 40px; color: #ffffff; line-height: 1.7; font-size: 15px; }
    .body h1, .body h2, .body h3 { color: #ffffff; margin-top: 0; }
    .body p { color: #ffffffcc; margin: 0 0 16px; }
    .body a { color: #EAB308; }
    .body strong { color: #ffffff; }
    .cta-btn { display: inline-block; background: #EAB308; color: #000000 !important; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; margin: 16px 0; }
    .kpi { background: #1a1a1a; border: 1px solid #ffffff10; border-radius: 12px; padding: 20px; margin: 16px 0; }
    .kpi-label { color: #ffffff60; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 6px; }
    .kpi-value { color: #EAB308; font-size: 28px; font-weight: 700; margin: 0; }
    .details { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .details td { padding: 10px 0; border-bottom: 1px solid #ffffff10; color: #ffffffcc; font-size: 14px; }
    .details td:first-child { color: #ffffff60; width: 40%; }
    .footer { background-color: #0a0a0a; padding: 24px 40px; text-align: center; border-top: 1px solid #ffffff10; }
    .footer p { color: #ffffff40; font-size: 12px; margin: 0 0 4px; }
    .footer a { color: #EAB308; text-decoration: none; }
    @media (max-width: 640px) { .body { padding: 24px; } .header { padding: 24px; } }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        ${logoBlock}
        ${branchLine}
      </div>
      <div class="body">
        ${content}
      </div>
      <div class="footer">
        <p><strong style="color:#EAB308;">The Incline Life by Incline</strong></p>
        <p style="margin-top: 8px;"><a href="https://theincline.in">theincline.in</a></p>
        ${unsubBlock}
      </div>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { to, subject, html, text, branch_id, attachments, from_override, use_branded_template, variables, skip_log } = body;

    if (!to || !subject || (!html && !text)) {
      return json({ error: "Missing required fields: to, subject, html or text" }, 400);
    }

    // Apply branded template (default ON via dispatcher).
    // Optional: branch logo + name pulled from branches table when branch_id provided.
    let finalHtml = html || text!;
    if (use_branded_template) {
      let logoUrl: string | undefined;
      let branchName: string | undefined;
      if (branch_id) {
        // logo_url column may not exist on branches yet — graceful fallback to text logo.
        const { data: br } = await supabase
          .from('branches')
          .select('name')
          .eq('id', branch_id)
          .maybeSingle();
        branchName = (br as any)?.name || undefined;
      }
      finalHtml = wrapInBrandedTemplate(finalHtml, subject, variables, {
        logoUrl,
        branchName,
        brandName: 'Incline',
        unsubscribeUrl: body?.unsubscribe_url,
      });
    }

    // Fetch active email integration
    const { data: integrations, error: intErr } = await supabase
      .from("integration_settings")
      .select("*")
      .eq("integration_type", "email")
      .eq("is_active", true)
      .limit(1);

    if (intErr || !integrations?.length) {
      return json({ error: "No active email provider configured. Please configure an email provider in Settings → Integrations." }, 400);
    }

    const integration = integrations[0];
    const config = integration.config || {};
    const credentials = integration.credentials || {};
    const provider = integration.provider;

    const fromEmail = from_override || config.from_email || "noreply@inclinefitness.in";
    const fromName = config.from_name || "Incline Fitness";

    let result: { success: boolean; message_id?: string; error?: string };

    switch (provider) {
      case "smtp":
        result = await sendViaSMTP(to, subject, finalHtml, fromEmail, fromName, config, credentials, attachments);
        break;
      case "sendgrid":
        result = await sendViaSendGrid(to, subject, finalHtml, fromEmail, fromName, credentials, attachments);
        break;
      case "mailgun":
        result = await sendViaMailgun(to, subject, finalHtml, fromEmail, fromName, config, credentials, attachments);
        break;
      case "ses":
        result = await sendViaSES(to, subject, finalHtml, fromEmail, fromName, config, credentials);
        break;
      default:
        result = { success: false, error: `Unsupported email provider: ${provider}` };
    }

    // Log to communication_logs (capture attachment metadata for auditability).
    // Skip when the dispatcher already owns the canonical row (skip_log=true).
    if (branch_id && !skip_log) {
      const attachmentMeta = (attachments || []).map((a: any) => ({
        filename: a.filename, content_type: a.content_type,
        size_b64: (a.content_base64 || '').length,
      }));
      await supabase.from("communication_logs").insert({
        branch_id,
        type: "email",
        recipient: to,
        subject,
        content: (html || text || "").slice(0, 500),
        status: result.success ? "sent" : "failed",
        delivery_status: result.success ? "sent" : "failed",
        sent_at: new Date().toISOString(),
        delivery_metadata: { provider, attachments: attachmentMeta, attachment_count: attachmentMeta.length },
        error_message: result.success ? null : (result.error || null),
      });
    }

    if (result.success) {
      return json({ success: true, message_id: result.message_id, provider });
    } else {
      return json({ error: result.error, provider }, 500);
    }
  } catch (error: any) {
    await captureEdgeError('send-email', error);
    console.error("send-email error:", error);
    return json({ error: error.message }, 500);
  }
});

// === SendGrid ===
async function sendViaSendGrid(
  to: string, subject: string, html: string, fromEmail: string, fromName: string,
  credentials: Record<string, string>,
  attachments?: Array<{ filename: string; content_base64: string; content_type: string }>
) {
  const payload: any = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: fromName },
    subject,
    content: [{ type: "text/html", value: html }],
  };

  if (attachments?.length) {
    payload.attachments = attachments.map(a => ({
      content: a.content_base64,
      filename: a.filename,
      type: a.content_type,
      disposition: "attachment",
    }));
  }

  try {
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (resp.ok || resp.status === 202) {
      const msgId = resp.headers.get("x-message-id") || undefined;
      return { success: true, message_id: msgId };
    }
    const errText = await resp.text();
    return { success: false, error: `SendGrid ${resp.status}: ${errText}` };
  } catch (e) {
    return { success: false, error: `SendGrid failed: ${(e as Error).message}` };
  }
}

// === Mailgun ===
async function sendViaMailgun(
  to: string, subject: string, html: string, fromEmail: string, fromName: string,
  config: Record<string, string>, credentials: Record<string, string>,
  attachments?: Array<{ filename: string; content_base64: string; content_type: string }>
) {
  const domain = config.domain;
  if (!domain) return { success: false, error: "Mailgun domain not configured" };

  const formData = new FormData();
  formData.append("from", `${fromName} <${fromEmail}>`);
  formData.append("to", to);
  formData.append("subject", subject);
  formData.append("html", html);

  if (attachments?.length) {
    for (const att of attachments) {
      const bytes = Uint8Array.from(atob(att.content_base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: att.content_type });
      formData.append("attachment", blob, att.filename);
    }
  }

  try {
    const resp = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${credentials.api_key}`)}`,
      },
      body: formData,
    });

    if (resp.ok) {
      const data = await resp.json();
      return { success: true, message_id: data.id };
    }
    const errText = await resp.text();
    return { success: false, error: `Mailgun ${resp.status}: ${errText}` };
  } catch (e) {
    return { success: false, error: `Mailgun failed: ${(e as Error).message}` };
  }
}

// === SMTP (raw socket) — supports HTML body + base64 file attachments ===
type EmailAttachment = { filename: string; content_base64: string; content_type: string };

function buildMimeMessage(
  fromName: string, fromEmail: string, to: string, subject: string,
  html: string, attachments?: EmailAttachment[],
): string {
  const headers = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
  ];
  // Dot-stuffing required for SMTP DATA: any line starting with '.' must be doubled.
  const stuff = (s: string) => s.split(/\r?\n/).map(l => l.startsWith('.') ? '.' + l : l).join('\r\n');

  if (!attachments || attachments.length === 0) {
    headers.push(`Content-Type: text/html; charset=UTF-8`);
    headers.push(`Content-Transfer-Encoding: 8bit`);
    return [...headers, '', stuff(html), '.'].join('\r\n');
  }

  const boundary = `=_lov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const lines: string[] = [...headers, '', `This is a multi-part message in MIME format.`, '', `--${boundary}`];
  // HTML body part
  lines.push(`Content-Type: text/html; charset=UTF-8`);
  lines.push(`Content-Transfer-Encoding: 8bit`);
  lines.push('');
  lines.push(stuff(html));

  // Attachment parts (base64, wrapped at 76 cols)
  for (const a of attachments) {
    const wrapped = a.content_base64.replace(/.{1,76}/g, m => m).match(/.{1,76}/g)?.join('\r\n') || a.content_base64;
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${a.content_type || 'application/octet-stream'}; name="${a.filename}"`);
    lines.push(`Content-Transfer-Encoding: base64`);
    lines.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    lines.push('');
    lines.push(wrapped);
  }
  lines.push('');
  lines.push(`--${boundary}--`);
  lines.push('.');
  return lines.join('\r\n');
}

async function sendViaSMTP(
  to: string, subject: string, html: string, fromEmail: string, fromName: string,
  config: Record<string, string>, credentials: Record<string, string>,
  attachments?: EmailAttachment[],
) {
  const host = config.host;
  const port = config.port || "587";
  const username = credentials.username;
  const password = credentials.password;

  if (!host || !username || !password) {
    return { success: false, error: "SMTP host, username, and password are required" };
  }

  const portNum = parseInt(port);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const message = buildMimeMessage(fromName, fromEmail, to, subject, html, attachments);

  // Read until we see a complete SMTP reply: a line with "NNN " (space) at the start.
  // Loops with per-read timeout to handle servers (e.g. Hostinger) that flush
  // the final 250 only after fully ingesting a multi-MB DATA payload.
  const makeIO = (conn: Deno.Conn | Deno.TlsConn) => {
    const readResponse = async (overallTimeoutMs = 60_000): Promise<string> => {
      let acc = '';
      const deadline = Date.now() + overallTimeoutMs;
      while (Date.now() < deadline) {
        const buf = new Uint8Array(16384);
        const readPromise = conn.read(buf);
        const timeoutPromise = new Promise<null>((res) => setTimeout(() => res(null), 5000));
        const n = await Promise.race([readPromise, timeoutPromise]);
        if (n === null) {
          // 5s of silence — only break if we already have a parsable reply
          if (/(^|\n)\d{3} [^\n]*\r?\n?$/.test(acc)) return acc;
          continue;
        }
        if (!n) {
          // EOF
          return acc;
        }
        acc += decoder.decode(buf.subarray(0, n));
        // SMTP final line is "NNN <text>" (space, not dash). Multiline uses "NNN-".
        if (/(^|\n)\d{3} [^\n]*\r?\n?$/.test(acc)) return acc;
      }
      return acc;
    };
    const read = () => readResponse(15_000);
    const write = async (cmd: string) => {
      await conn.write(encoder.encode(cmd + "\r\n"));
      return await readResponse(15_000);
    };
    // Stream large messages in chunks, then read the final response with extended timeout.
    const writeRaw = async (raw: string) => {
      const data = encoder.encode(raw + "\r\n");
      const CHUNK = 16 * 1024;
      for (let i = 0; i < data.length; i += CHUNK) {
        await conn.write(data.subarray(i, i + CHUNK));
      }
      return await readResponse(120_000);
    };
    return { read, write, writeRaw, readResponse };
  };

  try {
    if (port === "465") {
      const tlsConn = await Deno.connectTls({ hostname: host, port: portNum });
      const { read, write, writeRaw } = makeIO(tlsConn);
      await read();
      await write(`EHLO ${host}`);
      await write("AUTH LOGIN");
      await write(btoa(username));
      const authResp = await write(btoa(password));
      if (!authResp.startsWith("235")) { tlsConn.close(); return { success: false, error: `SMTP auth failed (465): ${authResp}` }; }
      await write(`MAIL FROM:<${fromEmail}>`);
      await write(`RCPT TO:<${to}>`);
      await write("DATA");
      const dataResp = await writeRaw(message);
      await write("QUIT");
      tlsConn.close();
      return dataResp.includes("250")
        ? { success: true, message_id: `smtp-${Date.now()}` }
        : { success: false, error: `SMTP DATA error (465): ${dataResp}` };
    }

    const conn = await Deno.connect({ hostname: host, port: portNum });
    const plainIO = makeIO(conn);
    await plainIO.read();
    await plainIO.write(`EHLO ${host}`);

    if (port === "587") {
      await plainIO.write("STARTTLS");
      const tlsConn = await Deno.startTls(conn, { hostname: host });
      const { read, write, writeRaw } = makeIO(tlsConn);
      await write(`EHLO ${host}`);
      await write("AUTH LOGIN");
      await write(btoa(username));
      const authResp = await write(btoa(password));
      if (!authResp.startsWith("235")) { tlsConn.close(); return { success: false, error: "SMTP authentication failed" }; }
      await write(`MAIL FROM:<${fromEmail}>`);
      await write(`RCPT TO:<${to}>`);
      await write("DATA");
      const dataResp = await writeRaw(message);
      await write("QUIT");
      tlsConn.close();
      return dataResp.includes("250")
        ? { success: true, message_id: `smtp-${Date.now()}` }
        : { success: false, error: `SMTP DATA error (587): ${dataResp}` };
    }

    // Plain SMTP fallback (port 25)
    const { read: _r, write, writeRaw } = plainIO;
    await write("AUTH LOGIN");
    await write(btoa(username));
    const authResp = await write(btoa(password));
    if (!authResp.startsWith("235")) { conn.close(); return { success: false, error: "SMTP authentication failed" }; }
    await write(`MAIL FROM:<${fromEmail}>`);
    await write(`RCPT TO:<${to}>`);
    await write("DATA");
    const dataResp = await writeRaw(message);
    await write("QUIT");
    conn.close();
    return dataResp.includes("250")
      ? { success: true, message_id: `smtp-${Date.now()}` }
      : { success: false, error: `SMTP error: ${dataResp}` };
  } catch (e) {
    return { success: false, error: `SMTP failed: ${(e as Error).message}` };
  }
}
// === AWS SES (Simple REST approach) ===
async function sendViaSES(
  to: string, subject: string, html: string, fromEmail: string, fromName: string,
  config: Record<string, string>, credentials: Record<string, string>
) {
  const region = config.region || "ap-south-1";
  const accessKeyId = credentials.access_key_id;
  const secretKey = credentials.secret_access_key;

  if (!accessKeyId || !secretKey) {
    return { success: false, error: "AWS SES access key and secret key are required" };
  }

  const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;

  const body = JSON.stringify({
    Content: {
      Simple: {
        Body: { Html: { Charset: "UTF-8", Data: html } },
        Subject: { Charset: "UTF-8", Data: subject },
      },
    },
    Destination: { ToAddresses: [to] },
    FromEmailAddress: `${fromName} <${fromEmail}>`,
  });

  // SigV4 signing is complex; for simplicity, use SES v1 query API
  const params = new URLSearchParams({
    Action: "SendEmail",
    "Source": `${fromName} <${fromEmail}>`,
    "Destination.ToAddresses.member.1": to,
    "Message.Subject.Data": subject,
    "Message.Body.Html.Data": html,
  });

  try {
    const resp = await fetch(`https://email.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Amz-Date": new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
        Authorization: `AWS ${accessKeyId}:${secretKey}`,
      },
      body: params.toString(),
    });

    if (resp.ok) {
      const text = await resp.text();
      const messageIdMatch = text.match(/<MessageId>(.*?)<\/MessageId>/);
      return { success: true, message_id: messageIdMatch?.[1] };
    }
    const errText = await resp.text();
    return { success: false, error: `SES ${resp.status}: ${errText.slice(0, 300)}` };
  } catch (e) {
    return { success: false, error: `SES failed: ${(e as Error).message}` };
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
