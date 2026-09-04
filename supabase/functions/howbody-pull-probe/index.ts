// TEMPORARY diagnostic — probes HOWBODY cloud for a report-pull endpoint. Delete after use.
import { corsHeaders, json, getHowbodyCreds, howbodyAuthedHeaders } from "../_shared/howbody.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const { dataKeys = [] } = await req.json().catch(() => ({ dataKeys: [] as string[] }));
  const { baseUrl } = await getHowbodyCreds();
  const headers = await howbodyAuthedHeaders();
  const paths = [
    "/openApi/getReport",
    "/openApi/getReportData",
    "/openApi/getBodyReport",
    "/openApi/getPostureReport",
    "/openApi/getScanData",
    "/openApi/getData",
    "/openApi/queryReport",
    "/openApi/getUserReport",
  ];
  const results: Record<string, unknown>[] = [];
  for (const p of paths) {
    for (const key of dataKeys.length ? dataKeys : [""]) {
      try {
        const r = await fetch(`${baseUrl}${p}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ dataKey: key, timeStamp: Date.now() }),
        });
        const text = (await r.text()).slice(0, 400);
        results.push({ path: p, dataKey: key, status: r.status, body: text });
      } catch (e) {
        results.push({ path: p, dataKey: key, error: String(e) });
      }
    }
  }
  return json({ results });
});
