// Posture pushes the scanner could not attribute; owners/managers link them (audited RPC).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, PersonStanding, Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Row { data_key: string; created_at: string; raw_payload: Record<string, unknown> | null }

export function HowbodyUnmatchedPostureCard() {
  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["howbody-unmatched-posture"],
    queryFn: async (): Promise<Row[]> => {
      const { data: logs } = await supabase.from("howbody_webhook_log")
        .select("data_key, created_at, raw_payload").eq("endpoint", "posture").eq("status_code", 404)
        .order("created_at", { ascending: false }).limit(60);
      const keys = [...new Set((logs || []).map((l) => l.data_key).filter(Boolean))] as string[];
      if (!keys.length) return [];
      const { data: saved } = await supabase.from("howbody_posture_reports").select("data_key").in("data_key", keys);
      const done = new Set((saved || []).map((s) => s.data_key));
      const seen = new Set<string>();
      return (logs || []).filter((l) => l.data_key && !done.has(l.data_key) && !seen.has(l.data_key) && seen.add(l.data_key)) as Row[];
    },
  });

  return (
    <Card className="rounded-2xl p-6 shadow-lg shadow-foreground/5">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-warning/10 p-2 text-warning"><PersonStanding className="h-5 w-5" /></div>
        <div>
          <h3 className="text-lg font-bold">Unmatched posture scans</h3>
          <p className="text-sm text-muted-foreground">The scanner couldn't tell who these posture scans belong to. Enter the member code to attach the photos and 3D model.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> :
          data.length === 0 ? <p className="text-sm text-muted-foreground">No unmatched posture scans. Every scan has been matched to a member.</p> :
          data.map((r) => <UnmatchedRow key={r.data_key} row={r} onDone={() => void refetch()} />)}
      </div>
    </Card>
  );
}

function UnmatchedRow({ row, onDone }: { row: Row; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const p = row.raw_payload || {};
  const img = typeof p.frontImg === "string" ? p.frontImg : null;
  async function link() {
    setBusy(true);
    try {
      const { data: m } = await supabase.from("members").select("id").ilike("member_code", code.trim()).maybeSingle();
      if (!m) throw new Error("No member found with that code.");
      const { data, error } = await supabase.rpc("howbody_link_unmatched_scan", { _data_key: row.data_key, _member_id: m.id });
      if (error) throw error;
      if ((data as { ok?: boolean })?.ok !== true) throw new Error("Scan could not be linked.");
      toast.success("Posture scan linked");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link scan");
    } finally { setBusy(false); }
  }
  const id = `link-${row.data_key}`;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted p-3">
      {img ? <img src={img} alt="Front posture view" className="h-16 w-12 rounded-lg object-cover" loading="lazy" /> : null}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{new Date(row.created_at).toLocaleString("en-IN")}</p>
        <p className="text-xs text-muted-foreground">Score {String(p.score ?? "—")} · Height {String(p.height ?? "—")} cm · Age {String(p.age ?? "—")}</p>
      </div>
      <Label htmlFor={id} className="sr-only">Member code</Label>
      <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} placeholder="INC-26-0251" className="h-11 w-36" />
      <Button onClick={link} disabled={busy || !code.trim()} className="min-h-11 gap-2">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Link
      </Button>
    </div>
  );
}
