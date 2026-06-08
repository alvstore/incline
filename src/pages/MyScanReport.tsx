// Static landing page for HOWBODY's "Send to Phone" QR (vendor doc §3.2).
// The vendor URL is fully static (no params), so we resolve the latest scan
// for whoever is logged in. Auto-delivery (WhatsApp + Email) already fired
// from the webhook — this page is for re-viewing.
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ScanLine, CheckCircle2, AlertTriangle, Search,
  Activity, PersonStanding, Smartphone, Mail, ArrowRight,
} from "lucide-react";

interface BodyReport {
  id: string;
  test_time: string | null;
  health_score: number | null;
  weight: number | null;
  bmi: number | null;
  pbf: number | null;
  smm: number | null;
}
interface PostureReport {
  id: string;
  test_time: string | null;
  equipment_no: string | null;
}
interface MemberHit {
  id: string;
  member_code: string;
  full_name: string | null;
  phone: string | null;
}

export default function MyScanReport() {
  const { user, profile, hasAnyRole, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const isStaff = useMemo(
    () => hasAnyRole(["owner", "admin", "manager", "staff", "trainer"]),
    [hasAnyRole],
  );

  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberLabel, setMemberLabel] = useState<string | null>(null);
  const [body, setBody] = useState<BodyReport | null>(null);
  const [posture, setPosture] = useState<PostureReport | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);

  // Auto-resolve self for members
  useEffect(() => {
    if (!user || isStaff) return;
    (async () => {
      const { data } = await supabase
        .from("members")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.id) {
        setMemberId(data.id);
        setMemberLabel(profile?.full_name || profile?.email || "You");
      }
    })();
  }, [user, isStaff, profile]);

  // Fetch latest reports whenever memberId changes
  useEffect(() => {
    if (!memberId) return;
    (async () => {
      setLoadingReports(true);
      const [{ data: b }, { data: p }] = await Promise.all([
        supabase
          .from("howbody_body_reports")
          .select("id, test_time, health_score, weight, bmi, pbf, smm")
          .eq("member_id", memberId)
          .order("test_time", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("howbody_posture_reports")
          .select("id, test_time, equipment_no")
          .eq("member_id", memberId)
          .order("test_time", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ]);
      setBody((b as BodyReport) || null);
      setPosture((p as PostureReport) || null);
      setLoadingReports(false);
    })();
  }, [memberId]);

  // ---------- early returns ----------
  if (authLoading) {
    return <Shell><Spinner /></Shell>;
  }
  if (!user) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent("/my-scan-report")}`} replace />;
  }

  // ---------- Staff lookup ----------
  if (isStaff && !memberId) {
    return (
      <Shell>
        <StaffPicker onPick={(m) => { setMemberId(m.id); setMemberLabel(m.full_name || m.member_code); }} />
      </Shell>
    );
  }

  // ---------- Member with no profile ----------
  if (!isStaff && !memberId && !authLoading) {
    return (
      <Shell>
        <Card className="rounded-2xl p-8 shadow-lg shadow-warning/20">
          <AlertTriangle className="h-10 w-10 text-warning" />
          <h2 className="mt-4 text-xl font-bold">Member profile missing</h2>
          <p className="mt-2 text-muted-foreground">
            Your account isn't linked to a member yet. Please ask the front desk to assist.
          </p>
        </Card>
      </Shell>
    );
  }

  // ---------- Reports view ----------
  return (
    <Shell>
      {/* Auto-delivery banner */}
      <div className="mb-4 flex items-start gap-3 rounded-2xl bg-gradient-to-br from-success/10 to-success/10 p-4 text-sm text-success ring-1 ring-success/25">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div>
          <p className="font-semibold">Your report has already been delivered</p>
          <p className="mt-0.5 text-xs text-success">
            We auto-sent it to your <span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3" />WhatsApp</span> and{" "}
            <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />email</span>. This page is for re-viewing.
          </p>
        </div>
      </div>

      {isStaff && memberLabel && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-muted p-3 text-sm">
          <span className="text-muted-foreground">Viewing reports for <span className="font-semibold text-foreground">{memberLabel}</span></span>
          <button
            onClick={() => { setMemberId(null); setBody(null); setPosture(null); }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Change member
          </button>
        </div>
      )}

      {loadingReports ? <Spinner /> : (
        <div className="space-y-4">
          {/* Body report card */}
          <ReportCard
            icon={<Activity className="h-5 w-5" />}
            tone="teal"
            title="Body Composition"
            report={body}
            empty="No body composition scan on file yet."
            metric={body?.health_score != null ? `${body.health_score}` : undefined}
            metricLabel="Health Score"
            extra={body && (
              <div className="grid grid-cols-3 gap-3 text-center">
                <Mini label="Weight" value={body.weight ? `${body.weight} kg` : "—"} />
                <Mini label="BMI" value={body.bmi ? body.bmi.toFixed(1) : "—"} />
                <Mini label="Body Fat" value={body.pbf ? `${body.pbf.toFixed(1)}%` : "—"} />
              </div>
            )}
            onView={() => navigate("/my-progress")}
          />

          {/* Posture report card */}
          <ReportCard
            icon={<PersonStanding className="h-5 w-5" />}
            tone="indigo"
            title="Posture Analysis"
            report={posture}
            empty="No posture scan on file yet."
            onView={() => navigate("/my-progress")}
          />

          {!body && !posture && (
            <Card className="rounded-2xl p-8 text-center shadow-lg shadow/50">
              <ScanLine className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 font-semibold text-foreground">No scans yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Step on the body scanner — your report will appear here automatically.
              </p>
            </Card>
          )}
        </div>
      )}
    </Shell>
  );
}

// ---------- helpers ----------
function ReportCard({
  icon, tone, title, report, empty, metric, metricLabel, extra, onView,
}: {
  icon: React.ReactNode;
  tone: "teal" | "indigo";
  title: string;
  report: { test_time: string | null } | null;
  empty: string;
  metric?: string;
  metricLabel?: string;
  extra?: React.ReactNode;
  onView: () => void;
}) {
  const toneCls = tone === "teal"
    ? { badge: "bg-success/10 text-success", btn: "bg-success hover:bg-success", shadow: "shadow-success/20" }
    : { badge: "bg-primary/10 text-primary", btn: "bg-primary hover:bg-primary", shadow: "shadow-primary/20" };

  if (!report) {
    return (
      <Card className={`rounded-2xl p-5 shadow-lg ${toneCls.shadow}`}>
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-2 ${toneCls.badge}`}>{icon}</div>
          <div>
            <h3 className="font-bold">{title}</h3>
            <p className="text-xs text-muted-foreground">{empty}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`rounded-2xl p-5 shadow-lg ${toneCls.shadow}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`rounded-full p-2 ${toneCls.badge}`}>{icon}</div>
          <div>
            <h3 className="font-bold">{title}</h3>
            <p className="text-xs text-muted-foreground">
              {report.test_time ? new Date(report.test_time).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}
            </p>
          </div>
        </div>
        {metric && (
          <div className="text-right">
            <p className="text-2xl font-bold text-foreground">{metric}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{metricLabel}</p>
          </div>
        )}
      </div>
      {extra && <div className="mt-4">{extra}</div>}
      <Button onClick={onView} className={`mt-4 w-full ${toneCls.btn}`}>
        View full report <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-2">
      <p className="text-base font-bold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-success" />
    </div>
  );
}

function StaffPicker({ onPick }: { onPick: (m: MemberHit) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MemberHit[]>([]);
  const [searching, setSearching] = useState(false);

  async function run() {
    if (!search.trim()) return;
    setSearching(true);
    const term = `%${search.trim()}%`;
    const { data } = await supabase
      .from("members")
      .select("id, member_code, profiles:user_id(full_name, phone)")
      .or(`member_code.ilike.${term}`)
      .limit(20);
    const profileMatch = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .or(`full_name.ilike.${term},phone.ilike.${term}`)
      .limit(20);
    const ids = (profileMatch.data || []).map((p) => p.id);
    let extra: any[] = [];
    if (ids.length) {
      const { data: extraMembers } = await supabase
        .from("members")
        .select("id, member_code, profiles:user_id(full_name, phone)")
        .in("user_id", ids);
      extra = extraMembers || [];
    }
    const all = [...(data || []), ...extra].reduce((acc: MemberHit[], m: any) => {
      if (acc.find((x) => x.id === m.id)) return acc;
      acc.push({
        id: m.id,
        member_code: m.member_code,
        full_name: m.profiles?.full_name ?? null,
        phone: m.profiles?.phone ?? null,
      });
      return acc;
    }, []);
    setResults(all);
    setSearching(false);
  }

  return (
    <Card className="rounded-2xl p-6 shadow-lg shadow-primary/20">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2 text-primary"><Search className="h-5 w-5" /></div>
        <div>
          <h2 className="text-xl font-bold">Find member's report</h2>
          <p className="text-sm text-muted-foreground">Look up a member to view their latest scan.</p>
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, phone, or member code"
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <Button onClick={run} disabled={searching} variant="outline">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>
      <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
        {results.map((m) => (
          <button
            key={m.id}
            onClick={() => onPick(m)}
            className="flex w-full items-center justify-between rounded-xl border border-border p-3 text-left transition hover:border-primary/40 hover:bg-primary/10"
          >
            <div>
              <p className="font-semibold">{m.full_name || "Unnamed"}</p>
              <p className="text-xs text-muted-foreground">{m.member_code} · {m.phone || "no phone"}</p>
            </div>
            <span className="text-sm font-medium text-primary">View →</span>
          </button>
        ))}
        {results.length === 0 && search && !searching && (
          <p className="text-center text-sm text-muted-foreground">No members found.</p>
        )}
      </div>
    </Card>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-muted via-white to-success/10 px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-success">Incline · Body Scan</p>
          <h1 className="mt-1 text-lg font-bold text-foreground">My Scan Report</h1>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">The Incline Life by Incline</p>
      </div>
    </div>
  );
}
