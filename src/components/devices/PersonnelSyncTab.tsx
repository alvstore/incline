import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, RefreshCw, Upload, Check, X, AlertCircle, Search, Image,
  ShieldCheck, ShieldX, RotateCw, ImagePlus, UserCheck, UserX,
  Dumbbell, Briefcase,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  syncPersonToMIPS, fetchAllMIPSPersons, verifyPersonOnMIPS,
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

  const { data: personnel = [], isLoading } = useQuery({
    queryKey: ["personnel-sync", branchId],
    queryFn: async () => {
      const people: SyncPerson[] = [];

      let memberQuery = supabase
        .from("members")
        .select("id, member_code, biometric_photo_url, mips_person_id, mips_sync_status, branch_id, profiles:user_id(full_name, avatar_url)")
        .order("created_at", { ascending: false });
      if (branchId) memberQuery = memberQuery.eq("branch_id", branchId);
      const { data: members } = await memberQuery;
      if (members) {
        for (const m of members) {
          const profile = m.profiles as any;
          people.push({
            id: m.id,
            name: profile?.full_name || "Unknown",
            code: m.member_code || "",
            type: "member",
            hasPhoto: !!(m.biometric_photo_url || profile?.avatar_url),
            avatarUrl: profile?.avatar_url || null,
            mipsSyncStatus: (m as any).mips_sync_status || "pending",
            mipsPersonId: (m as any).mips_person_id || null,
            branchId: m.branch_id,
          });
        }
      }

      let empQuery = supabase
        .from("employees")
        .select("id, employee_code, biometric_photo_url, mips_person_id, mips_sync_status, branch_id, profiles:user_id(full_name, avatar_url)")
        .order("created_at", { ascending: false });
      if (branchId) empQuery = empQuery.eq("branch_id", branchId);
      const { data: employees } = await empQuery;
      if (employees) {
        for (const e of employees) {
          const profile = e.profiles as any;
          people.push({
            id: e.id,
            name: profile?.full_name || "Unknown",
            code: e.employee_code || "",
            type: "employee",
            hasPhoto: !!(e.biometric_photo_url || profile?.avatar_url),
            avatarUrl: profile?.avatar_url || null,
            mipsSyncStatus: (e as any).mips_sync_status || "pending",
            mipsPersonId: (e as any).mips_person_id || null,
            branchId: e.branch_id,
          });
        }
      }

      let trainerQuery = supabase
        .from("trainers")
        .select("id, biometric_photo_url, mips_person_id, mips_sync_status, branch_id, is_active, profiles:user_id(full_name, avatar_url)")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (branchId) trainerQuery = trainerQuery.eq("branch_id", branchId);
      const { data: trainers } = await trainerQuery;
      if (trainers) {
        for (const t of trainers) {
          const profile = (t as any).profiles as any;
          people.push({
            id: t.id,
            name: profile?.full_name || "Unknown",
            code: `TRN-${t.id.substring(0, 4).toUpperCase()}`,
            type: "trainer",
            hasPhoto: !!(t.biometric_photo_url || profile?.avatar_url),
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
    const synced = personnel.filter((p) => p.mipsSyncStatus === "synced");
    if (synced.length === 0) { toast.info("No synced personnel to verify"); return; }
    toast.info(`Verifying ${synced.length} synced personnel against MIPS...`);
    try {
      const allMIPS = await fetchAllMIPSPersons();
      const mipsNos = new Set(allMIPS.map((e) => e.personSn));
      const newMap: Record<string, boolean> = {};
      let verified = 0, missing = 0;
      for (const p of synced) {
        const stripped = p.code.replace(/-/g, "");
        const found = mipsNos.has(stripped);
        newMap[p.id] = found;
        if (found) verified++; else missing++;
      }
      setVerificationMap((prev) => ({ ...prev, ...newMap }));
      toast.success(`Verified: ${verified} present, ${missing} missing on MIPS`);
    } catch (e) {
      toast.error(`Bulk verify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const bulkSyncMutation = useMutation({
    mutationFn: async (targets: SyncPerson[]) => {
      if (targets.length === 0) return { total: 0, success: 0 };
      let successCount = 0;
      for (const person of targets) {
        try {
          const result = await syncPersonToMIPS(person.type, person.id, branchId);
          if (result.success) successCount++;
        } catch (e) {
          console.warn(`Failed to sync ${person.name}:`, e);
        }
      }
      return { total: targets.length, success: successCount };
    },
    onSuccess: ({ total, success }) => {
      if (total === 0) toast.info("No personnel to sync");
      else toast.success(`Bulk sync: ${success}/${total} synced`);
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

  const registeredMembers = filterList(members.filter((p) => p.mipsSyncStatus === "synced"));
  const unregisteredMembers = filterList(members.filter((p) => p.mipsSyncStatus !== "synced"));
  const registeredStaff = filterList(staff.filter((p) => p.mipsSyncStatus === "synced"));
  const unregisteredStaff = filterList(staff.filter((p) => p.mipsSyncStatus !== "synced"));

  const stats = {
    totalMembers: members.length,
    syncedMembers: members.filter((p) => p.mipsSyncStatus === "synced").length,
    totalStaff: staff.length,
    syncedStaff: staff.filter((p) => p.mipsSyncStatus === "synced").length,
    noPhoto: personnel.filter((p) => !p.hasPhoto).length,
  };

  const renderPersonCard = (person: SyncPerson) => {
    const strippedCode = person.code.replace(/-/g, "");
    const isSynced = person.mipsSyncStatus === "synced";
    const isFailed = person.mipsSyncStatus === "failed";
    const verifyStatus = verificationMap[person.id];

    return (
      <Card
        key={`${person.type}-${person.id}`}
        className={`rounded-xl transition-all hover:shadow-md ${
          isSynced
            ? "border-success/20 shadow-success/20"
            : isFailed
              ? "border-destructive/20 shadow-destructive/5"
              : "border-warning/20 shadow-warning/20"
        }`}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-11 w-11 border-2 border-muted">
              {person.avatarUrl ? <AvatarImage src={person.avatarUrl} /> : null}
              <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">
                {person.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold truncate">{person.name}</span>
                {person.type === "trainer" && (
                  <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/20 gap-0.5">
                    <Dumbbell className="h-2.5 w-2.5" /> Trainer
                  </Badge>
                )}
                {person.type === "employee" && (
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 gap-0.5">
                    <Briefcase className="h-2.5 w-2.5" /> Staff
                  </Badge>
                )}
                {!branchId && mainBranchId && person.branchId === mainBranchId && (
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">Main</Badge>
                )}
              </div>

              <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground font-mono">
                <span>{person.code}</span>
                <span className="text-primary">→ {strippedCode}</span>
                {person.mipsPersonId && (
                  <span className="text-primary/60">MIPS#{person.mipsPersonId}</span>
                )}
              </div>

              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {isSynced ? (
                  <Badge variant="default" className="bg-success/10 text-success border border-success/20 text-[10px] gap-0.5">
                    <Check className="h-3 w-3" /> Registered
                  </Badge>
                ) : isFailed ? (
                  <Badge variant="destructive" className="text-[10px] gap-0.5">
                    <X className="h-3 w-3" /> Failed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/20 gap-0.5">
                    <AlertCircle className="h-3 w-3" /> Not Registered
                  </Badge>
                )}

                {!person.hasPhoto && (
                  <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/20 gap-0.5">
                    <Image className="h-3 w-3" /> No Photo
                  </Badge>
                )}

                {verifyStatus !== undefined && (
                  verifyStatus ? (
                    <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20 gap-0.5">
                      <ShieldCheck className="h-3 w-3" /> On Device
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20 gap-0.5">
                      <ShieldX className="h-3 w-3" /> Missing
                    </Badge>
                  )
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={syncingIds.has(person.id)}
                onClick={() => syncMutation.mutate(person)}
              >
                <Upload className={`h-3 w-3 mr-1 ${syncingIds.has(person.id) ? "animate-pulse" : ""}`} />
                Sync
              </Button>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={verifyingIds.has(person.id)}
                  onClick={() => handleVerify(person)}
                  title="Verify on MIPS"
                >
                  <ShieldCheck className={`h-3.5 w-3.5 ${verifyingIds.has(person.id) ? "animate-pulse" : ""}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={uploadingIds.has(person.id)}
                  onClick={() => { setUploadTargetPerson(person); fileInputRef.current?.click(); }}
                  title="Upload photo"
                >
                  <ImagePlus className={`h-3.5 w-3.5 ${uploadingIds.has(person.id) ? "animate-pulse" : ""}`} />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSection = (
    title: string,
    icon: React.ReactNode,
    list: SyncPerson[],
    accentColor: string
  ) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h4 className="text-sm font-semibold">{title}</h4>
          <Badge variant="outline" className={`text-[10px] ${accentColor}`}>
            {list.length}
          </Badge>
        </div>
        {list.length > 0 && list[0].mipsSyncStatus !== "synced" && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => bulkSyncMutation.mutate(list)}
            disabled={bulkSyncMutation.isPending}
          >
            <Upload className={`h-3 w-3 mr-1 ${bulkSyncMutation.isPending ? "animate-pulse" : ""}`} />
            Sync All ({list.length})
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">
          No personnel in this category
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map(renderPersonCard)}
        </div>
      )}
    </div>
  );

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

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="rounded-xl">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Members</p>
            <p className="text-xl font-bold">{stats.syncedMembers}<span className="text-sm font-normal text-muted-foreground">/{stats.totalMembers}</span></p>
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Staff & Trainers</p>
            <p className="text-xl font-bold">{stats.syncedStaff}<span className="text-sm font-normal text-muted-foreground">/{stats.totalStaff}</span></p>
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Total Synced</p>
            <p className="text-xl font-bold text-success">{stats.syncedMembers + stats.syncedStaff}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Pending</p>
            <p className="text-xl font-bold text-warning">{personnel.length - stats.syncedMembers - stats.syncedStaff}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">No Photo</p>
            <p className="text-xl font-bold text-warning">{stats.noPhoto}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Actions */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleBulkVerify}>
          <ShieldCheck className="h-4 w-4 mr-1.5" /> Verify All
        </Button>
        <Button variant="outline" size="sm" onClick={() => bulkSyncMutation.mutate(personnel.filter(p => p.mipsSyncStatus !== "synced"))} disabled={bulkSyncMutation.isPending}>
          <Upload className={`h-4 w-4 mr-1.5 ${bulkSyncMutation.isPending ? "animate-pulse" : ""}`} /> Sync All Pending
        </Button>
        <Button variant="outline" size="sm" onClick={() => bulkSyncMutation.mutate(personnel)} disabled={bulkSyncMutation.isPending}>
          <RefreshCw className="h-4 w-4 mr-1.5" /> Re-sync All
        </Button>
      </div>

      {/* Tabs: Members | Staff & Trainers */}
      <Tabs value={personnelTab} onValueChange={setPersonnelTab}>
        <TabsList className="bg-muted/60">
          <TabsTrigger value="members" className="gap-1.5">
            <Users className="h-4 w-4" /> Members
            <Badge variant="outline" className="text-[10px] ml-1">{members.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="staff" className="gap-1.5">
            <Briefcase className="h-4 w-4" /> Staff & Trainers
            <Badge variant="outline" className="text-[10px] ml-1">{staff.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-[550px]">
              <div className="space-y-6 pr-2">
                {renderSection(
                  "Registered on MIPS",
                  <UserCheck className="h-4 w-4 text-success" />,
                  registeredMembers,
                  "bg-success/10 text-success border-success/20"
                )}
                {renderSection(
                  "Not Registered",
                  <UserX className="h-4 w-4 text-warning" />,
                  unregisteredMembers,
                  "bg-warning/10 text-warning border-warning/20"
                )}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="staff">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-[550px]">
              <div className="space-y-6 pr-2">
                {renderSection(
                  "Registered on MIPS",
                  <UserCheck className="h-4 w-4 text-success" />,
                  registeredStaff,
                  "bg-success/10 text-success border-success/20"
                )}
                {renderSection(
                  "Not Registered",
                  <UserX className="h-4 w-4 text-warning" />,
                  unregisteredStaff,
                  "bg-warning/10 text-warning border-warning/20"
                )}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PersonnelSyncTab;
