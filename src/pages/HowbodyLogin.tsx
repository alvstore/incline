// HOWBODY QR-login landing page — opened from the scanner's QR code.
// Members log in (or staff search) and bind themselves to the scan session.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getHowbodyDeviceLabel } from "@/services/howbodyDeviceService";
import { HeightWheelPicker } from "@/components/scans/HeightWheelPicker";
import { isValidHeightCm } from "@/lib/scans/height";
import { Loader2, ScanLine, CheckCircle2, AlertTriangle, Search, ShieldCheck } from "lucide-react";

type Status = "idle" | "binding" | "bound" | "error";
type ScanKind = "body" | "posture";

interface MemberHit {
  id: string;
  member_code: string;
  full_name: string | null;
  phone: string | null;
}

export default function HowbodyLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile, hasAnyRole, isLoading } = useAuth();

  const equipmentNo = params.get("equipmentNo") || "";
  const scanId = params.get("scanId") || "";
  const kindParam = (params.get("kind") || params.get("scanType") || "").toLowerCase();

  const [status, setStatus] = useState<Status>("idle");
  const [boundMember, setBoundMember] = useState<string | null>(null);
  const [boundAt, setBoundAt] = useState<string | null>(null);
  const [bodyDone, setBodyDone] = useState(false);
  const [postureDone, setPostureDone] = useState(false);
  const [postureLate, setPostureLate] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const kind: ScanKind = kindParam === "posture" ? "posture" : "body";
  // Height is mandatory — the scanner cannot calculate BMI or body fat without it.
  const [height, setHeight] = useState("");
  const [heightPrefilled, setHeightPrefilled] = useState(false);


  // Resolve friendly device label from inventory (falls back to raw equipmentNo)
  useEffect(() => {
    if (!equipmentNo) return;
    getHowbodyDeviceLabel(equipmentNo).then(setDeviceLabel).catch(() => {});
  }, [equipmentNo]);

  // Staff search state
  const isStaff = useMemo(
    () => hasAnyRole(["owner", "admin", "manager", "staff", "trainer"]),
    [hasAnyRole],
  );
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MemberHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Auto-resolve memberId for the logged-in member
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user || isStaff) return;
      const { data } = await supabase
        .from("members")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && data?.id) setMemberId(data.id);
    })();
    return () => { cancelled = true; };
  }, [user, isStaff]);

  // Prefill height from the member's last recorded measurement
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!memberId) return;
      const { data } = await supabase
        .from("member_measurements")
        .select("height_cm")
        .eq("member_id", memberId)
        .not("height_cm", "is", null)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data?.height_cm) return;
      setHeight(String(data.height_cm));
      setHeightPrefilled(true);
    })();
    return () => { cancelled = true; };
  }, [memberId]);

  // Realtime: navigate when session completes
  useEffect(() => {
    if (status !== "bound" || !scanId) return;
    const ch = supabase
      .channel(`howbody-session-${scanId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "howbody_scan_sessions", filter: `scan_id=eq.${scanId}` },
        (payload: any) => {
          if (payload?.new?.status === "completed") setBodyDone(true);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [status, scanId, navigate, toast]);

  async function handleSearch() {
    if (!search.trim()) return;
    setSearching(true);
    const term = `%${search.trim().replace(/[^\p{L}\p{N} +@.\-]/gu, "").slice(0, 60)}%`;
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

  async function bindMember(targetMemberId: string) {
    if (!equipmentNo || !scanId) {
      setErrorMsg("Missing scanner info — please re-scan the QR code from the device.");
      setStatus("error");
      return;
    }
    const heightValue = Number.parseFloat(height);
    if (!isValidHeightCm(heightValue)) {
      toast({
        title: "Height needed",
        description: "Enter a height between 100 and 250 cm (about 3 ft 3 in to 8 ft 2 in) so the scan results are accurate.",
        variant: "destructive",
      });
      return;
    }
    setStatus("binding");
    setErrorMsg(null);
    const { data, error } = await supabase.functions.invoke("howbody-bind-user", {
      body: { equipmentNo, scanId, memberId: targetMemberId, kind, heightCm: heightValue },
    });
    if (error || !data?.ok) {
      setErrorMsg(data?.error || error?.message || "Could not bind to scanner.");
      setStatus("error");
      return;
    }
    setBoundMember(targetMemberId);
    setBoundAt(new Date(Date.now() - 60_000).toISOString());
    setStatus("bound");
  }

  // Live progress: poll for the BMI then posture report from the same single link.
  useEffect(() => {
    if (status !== "bound" || !boundMember || !boundAt) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      const [b, p] = await Promise.all([
        supabase.from("howbody_body_reports").select("id").eq("member_id", boundMember).gte("created_at", boundAt).limit(1),
        supabase.from("howbody_posture_reports").select("id").eq("member_id", boundMember).gte("created_at", boundAt).limit(1),
      ]);
      if (stop) return;
      if (b.data?.length) setBodyDone(true);
      if (p.data?.length) setPostureDone(true);
      if (Date.now() - started > 15 * 60_000) setPostureLate(true);
    };
    void tick();
    const id = window.setInterval(tick, 5000);
    return () => { stop = true; window.clearInterval(id); };
  }, [status, boundMember, boundAt]);

  useEffect(() => {
    if (!(bodyDone && postureDone)) return;
    toast({ title: "Scan complete!", description: "BMI and posture reports are ready." });
    const t = window.setTimeout(() => navigate(isStaff ? "/my-scan-report" : "/my-progress"), 1800);
    return () => window.clearTimeout(t);
  }, [bodyDone, postureDone, navigate, toast, isStaff]);

  // ---------- UI ----------

  if (!equipmentNo || !scanId) {
    return (
      <Shell>
        <Card className="rounded-2xl p-8 text-center shadow-lg shadow-success/20">
          <AlertTriangle className="mx-auto h-10 w-10 text-warning" />
          <h2 className="mt-4 text-xl font-bold">Invalid QR link</h2>
          <p className="mt-2 text-muted-foreground">
            Please scan the QR code shown on the body scanner directly.
          </p>
        </Card>
      </Shell>
    );
  }

  if (isLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-success" />
        </div>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <Card className="rounded-2xl p-8 shadow-lg shadow-success/20">
          <ScanLine className="h-10 w-10 text-success" />
          <h2 className="mt-4 text-xl font-bold">Sign in to start your scan</h2>
          <p className="mt-2 text-muted-foreground">
            Please sign in with your member account, then come back to this page.
          </p>
          <Button asChild className="mt-6 w-full bg-success hover:bg-success">
            <Link to={`/auth?redirect=/howbody-login?equipmentNo=${encodeURIComponent(equipmentNo)}&scanId=${encodeURIComponent(scanId)}`}>
              Sign in to continue
            </Link>
          </Button>
          <div className="mt-4 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            Device: <span className="font-mono">{equipmentNo}</span>
          </div>
        </Card>
      </Shell>
    );
  }

  if (status === "bound") {
    return (
      <Shell>
        <ScanProgress bodyDone={bodyDone} postureDone={postureDone} postureLate={postureLate} />
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell>
        <Card className="rounded-2xl p-8 shadow-lg shadow-destructive/20">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <h2 className="mt-4 text-xl font-bold">Couldn't link to scanner</h2>
          <p className="mt-2 text-destructive">{errorMsg}</p>
          <Button onClick={() => setStatus("idle")} className="mt-6 w-full" variant="outline">
            Try again
          </Button>
        </Card>
      </Shell>
    );
  }

  // idle / binding
  return (
    <Shell>
      <Card className="rounded-2xl p-6 shadow-lg shadow-success/20">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-success/10 p-2 text-success"><ScanLine className="h-6 w-6" /></div>
          <div className="flex-1">
            <h2 className="text-lg font-bold">Link your body scan</h2>
            <p className="text-sm text-muted-foreground">
              {deviceLabel ? <span className="font-medium text-foreground">{deviceLabel}</span> : "Device"}
              {" · "}<span className="font-mono text-xs">{equipmentNo}</span>
            </p>
          </div>
          <Badge variant="outline" className="border-success/25 bg-success/10 text-success">
            <ShieldCheck className="mr-1 h-3 w-3" /> Secure
          </Badge>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-xl bg-success/10 p-3 text-sm text-success">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold">BMI + Posture</span> in one link. The scanner continues to posture automatically, so you won't need to link again.</span>
        </div>

        <div className="mt-5">
          <HeightWheelPicker
            valueCm={height}
            onChangeCm={(cm) => { setHeight(cm); setHeightPrefilled(false); }}
            disabled={status === "binding"}
            hint={heightPrefilled
              ? "Taken from the last record — correct it if it has changed."
              : "Required. Body fat and BMI are calculated from this, so measure it accurately."}
          />
        </div>

        {!isStaff && memberId && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl bg-muted p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Logged in as</p>
              <p className="mt-1 text-base font-semibold">{profile?.full_name || profile?.email}</p>
            </div>
            <Button
              onClick={() => bindMember(memberId)}
              disabled={status === "binding" || !isValidHeightCm(Number.parseFloat(height))}
              className="w-full bg-success hover:bg-success"
            >
              {status === "binding" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Link me to this scanner
            </Button>
          </div>
        )}

        {!isStaff && !memberId && (
          <div className="mt-6 rounded-xl bg-warning/10 p-4 text-sm text-warning">
            Your member profile isn't ready. Please ask staff to assist.
          </div>
        )}

        {isStaff && (
          <div className="mt-6 space-y-3">
            <Label htmlFor="search">Find member to link</Label>
            <div className="flex gap-2">
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, phone, or member code"
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={searching} variant="outline" aria-label="Search members">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto pt-2">
              {results.map((m) => (
                <button type="button"
                  key={m.id}
                  onClick={() => bindMember(m.id)}
                  disabled={status === "binding" || !isValidHeightCm(Number.parseFloat(height))}
                  className="flex w-full items-center justify-between rounded-xl border border-border p-3 text-left transition hover:border-success/40 hover:bg-success/10 disabled:opacity-50"
                >
                  <div>
                    <p className="font-semibold">{m.full_name || "Unnamed"}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.member_code} · {m.phone || "no phone"}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-success">Link →</span>
                </button>
              ))}
              {results.length === 0 && search && !searching && (
                <p className="text-center text-sm text-muted-foreground">No members found.</p>
              )}
            </div>
          </div>
        )}
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background px-4 py-5 pb-safe">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-success">Incline · Body Scan</p>
          <h1 className="mt-1 text-lg font-bold text-foreground">BMI + Posture Scan</h1>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          The Incline Life by Incline
        </p>
      </div>
    </div>
  );
}

function ScanProgress({ bodyDone, postureDone, postureLate }: { bodyDone: boolean; postureDone: boolean; postureLate: boolean }) {
  const steps = [
    { label: "Linked to scanner", done: true },
    { label: "BMI & body composition", done: bodyDone },
    { label: "Posture & 3D photos", done: postureDone },
    { label: "Report ready", done: bodyDone && postureDone },
  ];
  const active = steps.findIndex((s) => !s.done);
  const hint = !bodyDone
    ? "Step on the scanner, hold the handles and follow the screen."
    : !postureDone
      ? "BMI saved. Stay on the scanner. It moves to posture by itself, so you don't need to link again."
      : "All done. Opening your report…";
  return (
    <Card className="overflow-hidden rounded-2xl p-6 shadow-lg shadow-success/20" aria-live="polite">
      <div className="flex flex-col items-center text-center">
        <div className="relative flex h-24 w-24 items-center justify-center">
          {active !== -1 && <span className="absolute inset-0 rounded-full bg-success/20 motion-safe:animate-ping" aria-hidden="true" />}
          <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-success/10 text-success">
            {active === -1 ? <CheckCircle2 className="h-10 w-10 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500" /> : <ScanLine className="h-10 w-10" />}
          </span>
        </div>
        <h2 className="mt-4 text-xl font-bold">{active === -1 ? "Scan complete" : "Scanning in progress"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <ol className="mt-6 space-y-3">
        {steps.map((s, i) => (
          <li
            key={s.label}
            style={{ animationDelay: `${i * 80}ms` }}
            className={`flex items-center gap-3 rounded-xl p-3 text-sm transition-colors duration-500 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both ${
              s.done ? "bg-success/10 text-success" : i === active ? "bg-muted text-foreground" : "text-muted-foreground"
            }`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card">
              {s.done ? <CheckCircle2 className="h-4 w-4 motion-safe:animate-in motion-safe:zoom-in-50" /> : i === active ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <span className="text-xs font-semibold">{i + 1}</span>}
            </span>
            <span className="font-medium">{s.label}</span>
          </li>
        ))}
      </ol>
      {postureLate && bodyDone && !postureDone && (
        <p className="mt-4 rounded-xl bg-warning/10 p-3 text-xs text-warning">
          Posture is still processing. Your BMI is saved. Posture will appear in your progress as soon as the scanner sends it.
        </p>
      )}
    </Card>
  );
}
