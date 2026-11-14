// Builds the "Group AI Fix Prompt" text from System Health error rows.
// Pure helpers so the classification and file hints stay testable.
export interface PromptErrorRow {
  id: string;
  error_message: string;
  stack_trace?: string | null;
  function_name?: string | null;
  route?: string | null;
  source?: string | null;
  severity?: string | null;
  fingerprint?: string | null;
  occurrence_count?: number | null;
  last_seen?: string | null;
  context?: any;
}

export interface ErrorClass { kind: string; hint: string }

const CLASSES: { kind: string; test: RegExp; hint: string }[] = [
  { kind: 'missing_function', test: /could not find the function|function .* does not exist|PGRST202/i,
    hint: 'Compare the client .rpc() call (name + argument names) with the live signature (pg_get_function_identity_arguments). It may be a stale published build calling a removed function, so check whether current src still calls it before recreating anything.' },
  { kind: 'unknown_column', test: /column .* does not exist|could not find the .* column/i,
    hint: 'Read the live function body (pg_get_functiondef) and the table columns (information_schema.columns); fix the column name in a NEW migration.' },
  { kind: 'on_conflict_twice', test: /ON CONFLICT DO UPDATE command cannot affect row a second time/i,
    hint: 'Either the upsert source has duplicate conflict keys (dedupe with DISTINCT ON), or a BEFORE INSERT trigger on the target table touches the same row the upsert later updates. Check triggers with pg_get_triggerdef.' },
  { kind: 'unique_violation', test: /duplicate key value|23505/i, hint: 'Find the unique index (pg_indexes) and the writer that skips the existence check; prefer an idempotent RPC.' },
  { kind: 'permission', test: /permission denied|42501|row-level security|NOT_AUTHORIZED/i,
    hint: 'Check GRANTs and RLS policies for the role, and the RPC role/branch guard. Never fix by adding SECURITY DEFINER blindly.' },
  { kind: 'csp', test: /CSP|content security policy|unlisted origin/i,
    hint: 'Add the exact origin to the right directive in src/config/contentSecurityPolicy.ts only if a real feature uses it, and extend its test.' },
  { kind: 'timeout', test: /timeout|timed out|57014|AbortError/i, hint: 'Check slow queries and missing indexes; an aborted call has an unknown outcome, so do not blindly retry writes.' },
  { kind: 'network', test: /failed to fetch|networkerror|load failed/i, hint: 'Usually a transient client network issue; only fix if it repeats for one endpoint.' },
];

export function classifyError(message: string): ErrorClass {
  const hit = CLASSES.find((c) => c.test.test(message || ''));
  return hit ? { kind: hit.kind, hint: hit.hint } : { kind: 'other', hint: 'Reproduce first, then read the code path named below.' };
}

export function extractRpcName(row: PromptErrorRow): string | null {
  const hay = `${row.stack_trace || ''} ${row.error_message || ''} ${row.context?.worker || ''}`;
  const m = hay.match(/\/rpc\/([a-z0-9_]+)/i) || hay.match(/rpc:([a-z0-9_]+)/i) || hay.match(/function public\.([a-z0-9_]+)/i);
  return m ? m[1] : null;
}

export function extractDbObjects(row: PromptErrorRow): string[] {
  const out = new Set<string>();
  const msg = row.error_message || '';
  const rpc = extractRpcName(row);
  if (rpc) out.add(`function public.${rpc}`);
  const col = msg.match(/column "([^"]+)" of relation "([^"]+)"/i);
  if (col) out.add(`table public.${col[2]} (column ${col[1]})`);
  const rel = msg.match(/relation "(?:public\.)?([^"]+)"/i);
  if (rel && !col) out.add(`table public.${rel[1]}`);
  const rule = row.context?.rule_key;
  if (rule && !rpc) out.add(`automation rule ${rule}`);
  return [...out];
}

export function suggestFiles(row: PromptErrorRow): string[] {
  const files: string[] = [];
  const rpc = extractRpcName(row);
  const kind = classifyError(row.error_message).kind;
  if (rpc) {
    files.push(`rg -n "${rpc}" src supabase/functions  (callers)`);
    files.push(`rg -ln "${rpc}" drizzle/migrations supabase/migrations  (latest definition; fix in a NEW migration)`);
  }
  const route = row.route || (row.function_name?.startsWith('/') ? row.function_name : null);
  if (route) files.push(`page for route ${route} (see src/App.tsx route table, then src/pages/*)`);
  if (row.function_name && !row.function_name.startsWith('/')) files.push(`supabase/functions/${row.function_name}/index.ts (if it is an edge function)`);
  if (row.context?.rule_key) files.push(`automation_rules row "${row.context.rule_key}" + supabase/functions/automation-brain-tick/index.ts`);
  if (kind === 'csp') files.push('src/config/contentSecurityPolicy.ts', 'src/config/contentSecurityPolicy.test.ts');
  return [...new Set(files)];
}

function clusterKey(e: PromptErrorRow) {
  return e.fingerprint || `${e.source}|${e.function_name || e.route || ''}|${(e.error_message || '').slice(0, 80)}`;
}

export function buildGroupPrompt(errors: PromptErrorRow[], groupedBy: 'fingerprint' | 'selection' = 'selection'): string {
  const total = errors.reduce((s, e) => s + (e.occurrence_count ?? 1), 0);
  const groups = new Map<string, PromptErrorRow[]>();
  for (const e of errors) {
    const k = clusterKey(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }

  const header = groupedBy === 'fingerprint'
    ? `I have ${groups.size} distinct error cluster(s) (${total} total occurrences) in the Incline gym app. Audit each against the LIVE database and current code, then give one consolidated fix plan, prioritised by severity and occurrence count.`
    : `I have ${groups.size} error cluster(s) (${total} total occurrences) selected from System Health. Audit them together against the LIVE database and current code. They may share a root cause.`;

  const objectToClusters = new Map<string, number[]>();
  const blocks: string[] = [];
  let i = 0;
  for (const [key, rows] of groups) {
    i += 1;
    const head = rows[0];
    const occ = rows.reduce((s, e) => s + (e.occurrence_count ?? 1), 0);
    const cls = classifyError(head.error_message);
    const objects = extractDbObjects(head);
    objects.forEach((o) => objectToClusters.set(o, [...(objectToClusters.get(o) || []), i]));
    const files = suggestFiles(head);
    blocks.push([
      `--- Cluster ${i}: ${cls.kind} (${occ} occurrences, ${head.severity || 'error'}) ---`,
      `Source: ${head.source || 'frontend'} | Route/function: ${head.function_name || head.route || '—'} | Last seen: ${head.last_seen || 'n/a'}`,
      `Fingerprint: ${head.fingerprint || key.slice(0, 16)}`,
      `Message: ${head.error_message}`,
      head.stack_trace ? `Top stack frame: ${(head.stack_trace.split('\n')[0] || '').slice(0, 240)}` : '',
      head.context ? `Context: ${JSON.stringify(head.context).slice(0, 400)}` : '',
      `Diagnosis hint: ${cls.hint}`,
      objects.length ? `Database objects to inspect: ${objects.join('; ')}` : '',
      files.length ? `Files to audit:\n${files.map((f) => `  - ${f}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'));
  }

  const shared = [...objectToClusters].filter(([, ids]) => ids.length > 1)
    .map(([o, ids]) => `- ${o} appears in clusters ${ids.join(', ')}: likely one shared fix.`);

  return [
    header,
    blocks.join('\n\n'),
    shared.length ? `Possible shared causes:\n${shared.join('\n')}` : '',
    `Project rules:
- Read the live function/trigger/index definitions before naming a cause; schema changes go in a NEW migration, never edit applied ones.
- Functions pin SET search_path = public; SECURITY DEFINER RPCs keep rpc_guard_applies() + branch/role checks; cron-only functions are granted to service_role only.
- Error capture uses the log_error_event RPC; outbound messages use dispatchCommunication.
- Do not change unrelated behaviour.`,
    `Answer per cluster:
1. Root cause, marked confirmed (with the query/file that proves it) or suspected.
2. Exact files / database objects to change.
3. Minimal fix.
4. How you verified it (query run, test, or browser check).
Then resolve the fixed error groups in System Health.`,
  ].filter(Boolean).join('\n\n');
}
