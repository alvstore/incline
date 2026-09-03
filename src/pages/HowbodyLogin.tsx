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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [kind, setKind] = useState<ScanKind>(kindParam === "posture" ? "posture" : "body");


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

  // Realtime: navigate when session completes
  useEffect(() => {
    if (status !== "bound" || !scanId) return;
    const ch = supabase
      .channel(`howbody-session-${scanId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "howbody_scan_sessions", filter: `scan_id=eq.${scanId}` },
        (payload: any) => {
          if (payload?.new?.status === "completed") {
            toast({ title: "Scan complete!", description: "Your report is ready." });
            navigate("/my-progress");
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [status, scanId, navigate, toast]);

  async function handleSearch() {
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

  async function bindMember(targetMemberId: string) {
    if (!equipmentNo || !scanId) {
      setErrorMsg("Missing scanner info — please re-scan the QR code from the device.");
      setStatus("error");
      return;
    }
    setStatus("binding");
    setErrorMsg(null);
    const { data, error } = await supabase.functions.invoke("howbody-bind-user", {
      body: { equipmentNo, scanId, memberId: targetMemberId, kind },
    });
    if (error || !data?.ok) {
      setErrorMsg(data?.error || error?.message || "Could not bind to scanner.");
      setStatus("error");
      return;
    }
    setStatus("bound");
  }

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
        <Card className="rounded-2xl border-0 bg-gradient-to-br from-success to-success p-10 text-center text-primary-foreground shadow-2xl shadow-success/20">
          <CheckCircle2 className="mx-auto h-16 w-16" />
          <h2 className="mt-4 text-2xl font-bold">You're linked!</h2>
          <p className="mt-2 text-success">Step on the scanner now and follow the on-screen instructions.</p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-card/15 px-4 py-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Waiting for your report…
          </div>
        </Card>
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
            <h2 className="text-xl font-bold">Body Scanner Login</h2>
            <p className="text-sm text-muted-foreground">
              {deviceLabel ? <span className="font-medium text-foreground">{deviceLabel}</span> : "Device"}
              {" · "}<span className="font-mono text-xs">{equipmentNo}</span>
            </p>
          </div>
          <Badge variant="outline" className="border-success/25 bg-success/10 text-success">
            <ShieldCheck className="mr-1 h-3 w-3" /> Secure
          </Badge>
        </div>

        {!isStaff && memberId && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl bg-muted p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Logged in as</p>
              <p className="mt-1 text-base font-semibold">{profile?.full_name || profile?.email}</p>
            </div>
            <Button
              onClick={() => bindMember(memberId)}
              disabled={status === "binding"}
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
              <Button onClick={handleSearch} disabled={searching} variant="outline">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto pt-2">
              {results.map((m) => (
                <button
                  key={m.id}
                  onClick={() => bindMember(m.id)}
                  disabled={status === "binding"}
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
    <div className="min-h-[100dvh] bg-gradient-to-br from-muted via-white to-success/10 px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-success">Incline · Body Scan</p>
          <h1 className="mt-1 text-lg font-bold text-foreground">Body Composition Scanner</h1>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          The Incline Life by Incline
        </p>
      </div>
    </div>
  );
}
