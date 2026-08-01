import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, RefreshCw, Upload, Search, Image,
  ShieldCheck, ShieldX, RotateCw, ImagePlus,
  Dumbbell, Briefcase,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  syncPersonToMIPS, fetchAllMIPSPersons, verifyPersonOnMIPS, fetchMIPSDevices,
} from "@/services/mipsService";
import { uploadBiometricPhoto } from "@/lib/media/biometricPhotoUrls";
import { toast } from "sonner";

interface PersonnelSyncTabProps {
  branchId?: string;
  mainBranchId?: string;
}

interface SyncPerson {
  id: string;
  name: string;
  code: string;
  type: "member" | "employee" | "trainer";
  hasPhoto: boolean;
  avatarUrl: string | null;
  mipsSyncStatus: string | null;
  mipsPersonId: string | null;
  verifiedOnDevice?: boolean | null;
  branchId?: string;
}

const PersonnelSyncTab = ({ branchId, mainBranchId }: PersonnelSyncTabProps) => {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [verificationMap, setVerificationMap] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetPerson, setUploadTargetPerson] = useState<SyncPerson | null>(null);
  const [personnelTab, setPersonnelTab] = useState("members");
  const [statusFilter, setStatusFilter] = useState<"all" | "registered" | "unregistered">("all");
  const [healing, setHealing] = useState(false);

  const { data: queueBacklog = 0 } = useQuery({
    queryKey: ["biometric-queue-backlog", branchId],
    queryFn: async () => {
      const { count } = await supabase
        .from("biometric_sync_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  const handleHealQueue = async () => {
    setHealing(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-biometric-sync-queue", {});
      if (error) throw error;
      const r = data as any;
      toast.success(`Processed ${r?.processed ?? 0} — ${r?.ok ?? 0} ok · ${r?.failed ?? 0} failed`);
      queryClient.invalidateQueries({ queryKey: ["biometric-queue-backlog"] });
      queryClient.invalidateQueries({ queryKey: ["personnel-sync"] });
    } catch (e: any) {
      toast.error(e?.message || "Heal failed");
    } finally {
      setHealing(false);
    }
  };

  const { data: personnel = [], isLoading } = useQuery({
    queryKey: ["personnel-sync", branchId],
    queryFn: async () => {
      const people: SyncPerson[] = [];

      let memberQuery = supabase
        .from("members")
        .select("id, member_code, biometric_photo_url, biometric_photo_path, mips_person_id, mips_sync_status, branch_id, profiles:user_id(full_name, avatar_url), leads:lead_id(full_name, avatar_url)")
        .order("created_at", { ascending: false });
      if (branchId) memberQuery = memberQuery.eq("branch_id", branchId);
      const { data: members } = await memberQuery;
      if (members) {
        for (const m of members) {
          const profile = m.profiles as any;
          const lead = (m as any).leads as any;
          const name = profile?.full_name || lead?.full_name || `Member ${m.member_code || ""}`.trim() || "Unknown";
          const avatar = profile?.avatar_url || lead?.avatar_url || null;
          const bioPath = (m as any).biometric_photo_path as string | null;
          people.push({
            id: m.id,
            name,
            code: m.member_code || "",
            type: "member",
            hasPhoto: !!(bioPath || m.biometric_photo_url || avatar),
            avatarUrl: avatar,
            mipsSyncStatus: (m as any).mips_sync_status || "pending",
            mipsPersonId: (m as any).mips_person_id || null,
            branchId: m.branch_id,
          });
        }
      }

      let empQuery = supabase
        .from("employees")
        .select("id, employee_code, biometric_photo_url, biometric_photo_path, mips_person_id, mips_sync_status, branch_id, is_active, profiles:user_id(full_name, avatar_url)")
        .eq("is_active", true)
        .neq("mips_sync_status", "revoked")
        .order("created_at", { ascending: false });
      if (branchId) empQuery = empQuery.eq("branch_id", branchId);
      const { data: employees } = await empQuery;
      if (employees) {
        for (const e of employees) {
          const profile = e.profiles as any;
          const bioPath = (e as any).biometric_photo_path as string | null;
          people.push({
            id: e.id,
            name: profile?.full_name || `Staff ${e.employee_code || ""}`.trim() || "Unknown",
            code: e.employee_code || "",
            type: "employee",
            hasPhoto: !!(bioPath || e.biometric_photo_url || profile?.avatar_url),
            avatarUrl: profile?.avatar_url || null,
            mipsSyncStatus: (e as any).mips_sync_status || "pending",
            mipsPersonId: (e as any).mips_person_id || null,
            branchId: e.branch_id,
          });
        }
      }

      let trainerQuery = supabase
        .from("trainers")
        .select("id, biometric_photo_url, biometric_photo_path, mips_person_id, mips_sync_status, branch_id, is_active, profiles:user_id(full_name, avatar_url)")
        .eq("is_active", true)
        .neq("mips_sync_status", "revoked")
        .order("created_at", { ascending: false });
      if (branchId) trainerQuery = trainerQuery.eq("branch_id", branchId);
      const { data: trainers } = await trainerQuery;
      if (trainers) {
        for (const t of trainers) {
          const profile = (t as any).profiles as any;
          const bioPath = (t as any).biometric_photo_path as string | null;
          people.push({
            id: t.id,
            name: profile?.full_name || `Trainer ${t.id.substring(0, 4).toUpperCase()}`,
            code: `TRN-${t.id.substring(0, 4).toUpperCase()}`,
            type: "trainer",
            hasPhoto: !!(bioPath || t.biometric_photo_url || profile?.avatar_url),
            avatarUrl: profile?.avatar_url || null,
            mipsSyncStatus: t.mips_sync_status || "pending",
            mipsPersonId: t.mips_person_id || null,
            branchId: t.branch_id,
          });
        }
      }

      return people;
    },
  });

  // ---- Server truth: what the MIPS server actually holds -------------------
  // The local `mips_sync_status` column only records what *we* attempted.
  // The only reliable count is the person list on the MIPS server itself, and
  // whether each person actually carries a face image (photoUri / havePhoto).
  const { data: serverTruth, isFetching: truthLoading, refetch: refetchTruth } = useQuery({
    queryKey: ["mips-server-truth"],
    queryFn: async () => {
      const rows = await fetchAllMIPSPersons();
      const map: Record<string, { exists: boolean; hasFace: boolean }> = {};
      for (const r of rows as any[]) {
        if (!r?.personSn) continue;
        map[String(r.personSn)] = {
          exists: true,
          hasFace: !!(r.photoUri || r.havePhoto),
        };
      }
      return {
        map,
        total: rows.length,
        withFace: (rows as any[]).filter((r) => r.photoUri || r.havePhoto).length,
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  const truthFor = (code: string) => serverTruth?.map[code.replace(/-/g, "")];

  // ---- Gate truth: faces actually enrolled on each turnstile ---------------
  const { data: gateTruth } = useQuery({
    queryKey: ["mips-gate-truth", branchId || "all"],
    queryFn: () => fetchMIPSDevices(branchId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // ---- Enrollment sweep status: when the self-healing worker last ran ------
  const { data: sweepStatus } = useQuery({
    queryKey: ["mips-face-sweep-status"],
    queryFn: async () => {
      const { data } = await supabase
        .from("automation_rules")
        .select("last_run_at, last_status, last_error, is_active")
        .eq("key", "mips_face_enrollment_sweep")
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });





  const syncMutation = useMutation({
    mutationFn: async (person: SyncPerson) => {
      setSyncingIds((prev) => new Set(prev).add(person.id));
      return syncPersonToMIPS(person.type, person.id, branchId);
    },
    onSuccess: (result, person) => {
      setSyncingIds((prev) => { const n = new Set(prev); n.delete(person.id); return n; });
      if (result.success) {
        toast.success(`${person.name} synced to MIPS`);
        setVerificationMap((prev) => { const n = { ...prev }; delete n[person.id]; return n; });
      } else {
        toast.error(`Sync failed: ${result.error || "Unknown error"}`);
      }
      queryClient.invalidateQueries({ queryKey: ["personnel-sync"] });
    },
    onError: (error: Error, person) => {
      setSyncingIds((prev) => { const n = new Set(prev); n.delete(person.id); return n; });
      toast.error(`Sync failed: ${error.message}`);
    },
  });

  const handleVerify = async (person: SyncPerson) => {
    setVerifyingIds((prev) => new Set(prev).add(person.id));
    try {
      const result = await verifyPersonOnMIPS(person.code);
      setVerificationMap((prev) => ({ ...prev, [person.id]: result.exists }));
      if (result.exists) {
        toast.success(`${person.name} verified on MIPS (ID: ${result.mipsId})`);
      } else {
        toast.warning(`${person.name} NOT found on MIPS — re-sync recommended`);
      }
    } catch (e) {
      toast.error(`Verify failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setVerifyingIds((prev) => { const n = new Set(prev); n.delete(person.id); return n; });
    }
  };

  const handleBulkVerify = async () => {
    toast.info("Re-reading the MIPS person list…");
    try {
      const allMIPS = await fetchAllMIPSPersons();
      const faceMap = new Map(
        allMIPS.map((e: any) => [String(e.personSn), !!(e.photoUri || e.havePhoto)])
      );
      const newMap: Record<string, boolean> = {};
      let withFace = 0, noFace = 0, missing = 0;
      for (const p of personnel) {
        const stripped = p.code.replace(/-/g, "");
        const has = faceMap.get(stripped);
        newMap[p.id] = has === true;
        if (has === true) withFace++;
        else if (has === false) noFace++;
        else missing++;
      }
      setVerificationMap((prev) => ({ ...prev, ...newMap }));
      await refetchTruth();
      toast.success(
        `MIPS server: ${withFace} with face · ${noFace} on server without face · ${missing} not on server`
      );
    } catch (e) {
      toast.error(`Bulk verify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };


  // Direct-to-gates is the safe default. Server-only is an explicit deferred
  // mode for very large imports, never the default for day-to-day repairs.
  const [serverOnlyBulk, setServerOnlyBulk] = useState(false);

  const bulkSyncMutation = useMutation({
    mutationFn: async (targets: SyncPerson[]) => {
      if (targets.length === 0) return { total: 0, success: 0 };
      let successCount = 0;
      for (const person of targets) {
        try {
          // Server-only sync uploads to MIPS once and lets the
          // mips-reconcile-devices cron fan out to every device — much faster
          // for bulk operations and avoids per-device round-trips.
          const result = await syncPersonToMIPS(person.type, person.id, branchId, !serverOnlyBulk);
          if (result.success) successCount++;
        } catch (e) {
          console.warn(`Failed to sync ${person.name}:`, e);
        }
      }
      return { total: targets.length, success: successCount };
    },
    onSuccess: ({ total, success }) => {
      if (total === 0) toast.info("No personnel to sync");
      else if (serverOnlyBulk) toast.success(`Bulk sync: ${success}/${total} uploaded to MIPS server — devices will receive within 15 min (or click Reconcile Devices to push now)`);
      else toast.success(`Bulk sync: ${success}/${total} synced to devices`);
      queryClient.invalidateQueries({ queryKey: ["personnel-sync"] });
      setVerificationMap({});
    },
    onError: (error: Error) => {
      toast.error(`Bulk sync failed: ${error.message}`);
    },
  });


  const handlePhotoUpload = async (file: File, person: SyncPerson) => {
    setUploadingIds((prev) => new Set(prev).add(person.id));
    try {
      // Upload to the private `member-photos` bucket and persist the storage
      // path on biometric_photo_path. We deliberately do NOT write a public URL
      // here — the newer media model resolves a fresh signed URL on demand.
      const entityType =
        person.type === "member" ? "members" :
        person.type === "trainer" ? "trainers" : "employees";

      const { path } = await uploadBiometricPhoto(entityType, person.id, file);

      const table = entityType; // members | trainers | employees
      const { error: updateError } = await supabase
        .from(table)
        .update({ biometric_photo_path: path })
        .eq("id", person.id);
      if (updateError) throw updateError;

      toast.success(`Photo uploaded for ${person.name}, triggering sync...`);
      queryClient.invalidateQueries({ queryKey: ["personnel-sync"] });

      const result = await syncPersonToMIPS(person.type, person.id, branchId);
      if (result.success) toast.success(`${person.name} synced with new photo`);
      else toast.error(`Sync after upload failed: ${result.error}`);
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadingIds((prev) => { const n = new Set(prev); n.delete(person.id); return n; });
      setUploadTargetPerson(null);
    }
  };

  // Split personnel
  const members = personnel.filter((p) => p.type === "member");
  const staff = personnel.filter((p) => p.type === "employee" || p.type === "trainer");

  const filterList = (list: SyncPerson[]) =>
    list.filter((p) =>
      !searchTerm ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.code.toLowerCase().includes(searchTerm.toLowerCase())
    );


  const onServer = (p: SyncPerson) => !!truthFor(p.code)?.exists;
  const hasFaceOnServer = (p: SyncPerson) => !!truthFor(p.code)?.hasFace;

  const stats = {
    totalMembers: members.length,
    syncedMembers: members.filter(onServer).length,
    totalStaff: staff.length,
    syncedStaff: staff.filter(onServer).length,
    noPhoto: personnel.filter((p) => !p.hasPhoto).length,
    // Has a CRM photo but the server has no face image for them.
    missingFace: personnel.filter((p) => p.hasPhoto && (!onServer(p) || !hasFaceOnServer(p))).length,
    serverTotal: serverTruth?.total ?? 0,
    serverWithFace: serverTruth?.withFace ?? 0,
  };


  const activeList = personnelTab === "members" ? members : staff;
  const visible = filterList(
    statusFilter === "all"
      ? activeList
      : statusFilter === "registered"
        ? activeList.filter((p) => onServer(p) && hasFaceOnServer(p))
        : activeList.filter((p) => !onServer(p) || !hasFaceOnServer(p))
  );

  const renderRow = (person: SyncPerson) => {
    const strippedCode = person.code.replace(/-/g, "");
    const truth = truthFor(person.code);
    const isSynced = !!truth?.exists && !!truth?.hasFace;
    const isFailed = person.mipsSyncStatus === "failed" && !truth?.exists;
    const verifyStatus = verificationMap[person.id];


    return (
      <div
        key={`${person.type}-${person.id}`}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-muted/40"
      >
        <Avatar className="h-9 w-9 shrink-0">
          {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt={person.name} /> : null}
          <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
            {person.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{person.name}</span>
            {person.type === "trainer" && (
              <Badge variant="outline" className="gap-0.5 rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700">
                <Dumbbell className="h-2.5 w-2.5" /> Trainer
              </Badge>
            )}
            {person.type === "employee" && (
              <Badge variant="outline" className="gap-0.5 rounded-full border-primary/20 bg-primary/10 text-[10px] text-primary">
                <Briefcase className="h-2.5 w-2.5" /> Staff
              </Badge>
            )}
            {!branchId && mainBranchId && person.branchId === mainBranchId && (
              <Badge variant="outline" className="rounded-full text-[10px]">Main</Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span>{person.code}</span>
            <span className="text-primary">→ {strippedCode}</span>
            {person.mipsPersonId && <span className="text-primary/60">MIPS#{person.mipsPersonId}</span>}
          </div>
        </div>

        <div className="hidden shrink-0 flex-wrap items-center justify-end gap-1.5 sm:flex">
          {isSynced ? (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Face on server</span>
          ) : truth?.exists ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">On server · no face</span>
          ) : isFailed ? (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">Failed</span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">Not on server</span>
          )}

          {!person.hasPhoto && (
            <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-muted dark:text-muted-foreground">
              <Image className="h-3 w-3" /> No photo
            </span>
          )}
          {verifyStatus !== undefined &&
            (verifyStatus ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
               <ShieldCheck className="h-3 w-3" /> On MIPS server
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                <ShieldX className="h-3 w-3" /> Missing
              </span>
            ))}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] rounded-xl text-xs"
            disabled={syncingIds.has(person.id)}
            onClick={() => syncMutation.mutate(person)}
          >
            <Upload className={`mr-1 h-3 w-3 ${syncingIds.has(person.id) ? "animate-pulse" : ""}`} />
            Sync
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label={`Verify ${person.name} on MIPS`}
            disabled={verifyingIds.has(person.id)}
            onClick={() => handleVerify(person)}
          >
            <ShieldCheck className={`h-4 w-4 ${verifyingIds.has(person.id) ? "animate-pulse" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label={`Upload photo for ${person.name}`}
            disabled={uploadingIds.has(person.id)}
            onClick={() => {
              setUploadTargetPerson(person);
              fileInputRef.current?.click();
            }}
          >
            <ImagePlus className={`h-4 w-4 ${uploadingIds.has(person.id) ? "animate-pulse" : ""}`} />
          </Button>
        </div>
      </div>
    );
  };

  const StatTile = ({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: string }) => (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
      <CardContent className="p-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${tone ?? ""}`}>{value}</p>
        {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );

  // Anyone the MIPS server does not hold with a face image is actionable.
  const pendingTargets = personnel.filter((p) => p.hasPhoto && (!onServer(p) || !hasFaceOnServer(p)));


  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadTargetPerson) handlePhotoUpload(file, uploadTargetPerson);
          e.target.value = "";
        }}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Members on server"
          value={
            <>
              {stats.syncedMembers}
              <span className="text-sm font-normal text-muted-foreground">/{stats.totalMembers}</span>
            </>
          }
          hint={truthLoading ? "Checking MIPS server…" : "Verified against MIPS person list"}
        />
        <StatTile
          label="Staff & trainers"
          value={
            <>
              {stats.syncedStaff}
              <span className="text-sm font-normal text-muted-foreground">/{stats.totalStaff}</span>
            </>
          }
          hint="Verified against MIPS person list"
        />
        <StatTile
          label="Missing face"
          value={stats.missingFace}
          tone={stats.missingFace > 0 ? "text-amber-600" : "text-emerald-600"}
          hint={queueBacklog > 0 ? `Queue backlog: ${queueBacklog}` : "CRM photo on file, no face on MIPS"}
        />
        <StatTile
          label="MIPS server total"
          value={
            <>
              {stats.serverWithFace}
              <span className="text-sm font-normal text-muted-foreground">/{stats.serverTotal}</span>
            </>
          }
          hint={`${stats.noPhoto} people have no photo in CRM`}
        />
      </div>

      {(gateTruth?.length ?? 0) > 0 && (
        <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Faces on gates
            </span>
            {gateTruth!.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{d.deviceName || d.name}</span>
                <Badge
                  className={
                    d.faceCount >= stats.serverWithFace
                      ? "rounded-full bg-emerald-100 text-emerald-700"
                      : "rounded-full bg-amber-100 text-amber-700"
                  }
                >
                  {d.faceCount} faces · {d.personCount} people
                </Badge>
              </div>
            ))}
            <span className="text-xs text-muted-foreground">
              MIPS server holds {stats.serverWithFace} face photos — gates below this number are still catching up.
            </span>
          </CardContent>
        </Card>
      )}




      <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <label htmlFor="personnel-search" className="sr-only">
                Search personnel
              </label>
              <Input
                id="personnel-search"
                placeholder="Search by name or code…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="rounded-xl pl-9"
              />
            </div>
            <Button variant="outline" size="sm" className="min-h-[36px] rounded-xl" onClick={handleBulkVerify}>
              <ShieldCheck className="mr-1.5 h-4 w-4" /> Verify all
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[36px] rounded-xl"
              onClick={() => bulkSyncMutation.mutate(pendingTargets)}
              disabled={bulkSyncMutation.isPending || pendingTargets.length === 0}
            >
              <Upload className={`mr-1.5 h-4 w-4 ${bulkSyncMutation.isPending ? "animate-pulse" : ""}`} />
              Sync pending ({pendingTargets.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[36px] rounded-xl"
              onClick={() => bulkSyncMutation.mutate(personnel)}
              disabled={bulkSyncMutation.isPending}
            >
              <RefreshCw className={`mr-1.5 h-4 w-4 ${bulkSyncMutation.isPending ? "animate-pulse" : ""}`} /> Re-sync all
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[36px] rounded-xl"
              onClick={handleHealQueue}
              disabled={healing}
              title="Drain the biometric sync queue now — retries every stuck photo upload"
            >
              <RotateCw className={`mr-1.5 h-4 w-4 ${healing ? "animate-spin" : ""}`} />
              {healing ? "Healing…" : `Heal queue${queueBacklog > 0 ? ` (${queueBacklog})` : ""}`}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={personnelTab} onValueChange={setPersonnelTab}>
              <TabsList className="rounded-xl bg-muted/60">
                <TabsTrigger value="members" className="gap-1.5 rounded-lg">
                  <Users className="h-4 w-4" /> Members
                  <span className="ml-1 text-[10px] text-muted-foreground">{members.length}</span>
                </TabsTrigger>
                <TabsTrigger value="staff" className="gap-1.5 rounded-lg">
                  <Briefcase className="h-4 w-4" /> Staff &amp; trainers
                  <span className="ml-1 text-[10px] text-muted-foreground">{staff.length}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-1">
              {(["all", "registered", "unregistered"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={statusFilter === f ? "default" : "outline"}
                  className="min-h-[36px] rounded-full text-xs capitalize"
                  onClick={() => setStatusFilter(f)}
                >
                  {f}
                </Button>
              ))}
            </div>

            <label
              className="ml-auto flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-muted-foreground"
               title="When OFF (recommended): upload and dispatch directly to every mapped gate. Turn on only for deferred bulk imports."
            >
              <input
                type="checkbox"
                checked={serverOnlyBulk}
                onChange={(e) => setServerOnlyBulk(e.target.checked)}
                className="rounded border-input"
              />
               Defer gate delivery to background worker
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
        <CardContent className="p-2">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <div className="rounded-full bg-muted p-4">
                <Users className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold">Nobody matches this view</p>
              <p className="text-xs text-muted-foreground">
                Try a different filter or clear the search to see everyone in this branch.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[560px]">
              <div className="divide-y divide-border/40 pr-2">{visible.map(renderRow)}</div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PersonnelSyncTab;
