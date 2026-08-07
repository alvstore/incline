import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

import {
  Sparkles,
  Dumbbell,
  Utensils,
  
  Library,
  Trash2,
  UserPlus,
  Download,
  FilePlus,
  Eye,
  Pencil,
  Users,
  Lock,
  Share2,
  Target,
  FileUp,
  FileText,
  Search,
  Copy as CopyIcon,
} from "lucide-react";
import { downloadPlanPdf } from "@/utils/pdfBlob";
import { useBrandContext } from "@/lib/brand/useBrandContext";
import { toast as sonnerToast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPlanTemplates,
  FitnessPlanTemplate,
  softDeletePlanTemplate,
  getTemplateUsageCounts,
  createPlanTemplate,
} from "@/services/fitnessService";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AssignPlanDrawer } from "@/components/fitness/AssignPlanDrawer";
import { EditTemplateTargetingDrawer } from "@/components/fitness/EditTemplateTargetingDrawer";
import { FitnessHubTabs } from "@/components/fitness/FitnessHubTabs";
import { PlanViewerSheet } from "@/components/fitness/PlanViewerSheet";
import { UploadPdfTemplateDrawer } from "@/components/fitness/UploadPdfTemplateDrawer";
import { TemplateAssignmentsSheet } from "@/components/fitness/TemplateAssignmentsSheet";
import { useAuth } from "@/contexts/AuthContext";
import { useBranchContext } from "@/contexts/BranchContext";
import { useNavigate } from "react-router-dom";

type CommonFilter = "all" | "common" | "pt_only";

function getDifficultyColor(difficulty: string | null) {
  switch (difficulty) {
    case "beginner":
      return "bg-success/20 text-success border-success/20";
    case "intermediate":
      return "bg-warning/20 text-warning border-warning/20";
    case "advanced":
      return "bg-destructive/20 text-destructive border-destructive/20";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function FitnessTemplatesPage() {
  const { hasAnyRole } = useAuth();
  const { effectiveBranchId } = useBranchContext();
  const canCreate = hasAnyRole(["owner", "admin", "manager"]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: brand } = useBrandContext();

  const handleDownloadTemplate = async (template: FitnessPlanTemplate) => {
    if (template.source_kind === 'pdf' && template.pdf_url) {
      window.open(template.pdf_url, '_blank', 'noopener');
      return;
    }
    try {
      await downloadPlanPdf(
        {
          name: template.name,
          type: template.type,
          description: template.description ?? undefined,
          difficulty: template.difficulty ?? undefined,
          goal: template.goal ?? undefined,
          data: template.content,
        } as any,
        brand,
      );
    } catch (err: any) {
      sonnerToast.error(err?.message || 'Failed to generate PDF');
    }
  };

  const [planType, setPlanType] = useState<"workout" | "diet">("workout");
  const [commonFilter, setCommonFilter] = useState<CommonFilter>("all");
  const [assignDrawerOpen, setAssignDrawerOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<FitnessPlanTemplate | null>(null);
  const [viewing, setViewing] = useState<FitnessPlanTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FitnessPlanTemplate | null>(null);
  const [targetingTemplate, setTargetingTemplate] = useState<FitnessPlanTemplate | null>(null);
  const [uploadPdfOpen, setUploadPdfOpen] = useState(false);
  const [assignmentsTemplate, setAssignmentsTemplate] = useState<FitnessPlanTemplate | null>(null);
  const [search, setSearch] = useState("");

  const { data: allTemplates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ["fitness-templates", planType],
    queryFn: () => fetchPlanTemplates(undefined, planType),
  });

  const templates = useMemo(() => {
    const byCommon =
      commonFilter === "all"
        ? allTemplates
        : commonFilter === "common"
          ? allTemplates.filter((t) => t.is_common)
          : allTemplates.filter((t) => !t.is_common);
    const q = search.trim().toLowerCase();
    if (!q) return byCommon;
    return byCommon.filter((t) =>
      [t.name, t.description, t.goal, t.difficulty]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [allTemplates, commonFilter, search]);


  const templateIds = useMemo(() => templates.map((t) => t.id), [templates]);
  const { data: usageCounts = {} } = useQuery({
    queryKey: ["fitness-template-usage", templateIds],
    queryFn: () => getTemplateUsageCounts(templateIds),
    enabled: templateIds.length > 0,
  });

  /** Clone a template (content + targeting) as "<name> (Copy)" so it can be renamed freely. */
  const duplicateTemplateMutation = useMutation({
    mutationFn: (template: FitnessPlanTemplate) =>
      createPlanTemplate({
        branch_id: template.branch_id ?? null,
        name: `${template.name} (Copy)`,
        type: template.type,
        description: template.description ?? undefined,
        difficulty: template.difficulty ?? undefined,
        goal: template.goal ?? undefined,
        content: template.content,
        is_common: !!template.is_common,
        source_kind: template.source_kind === 'pdf' ? 'pdf' : 'structured',
        pdf_url: template.pdf_url ?? null,
        pdf_filename: template.pdf_filename ?? null,
        pdf_size_bytes: template.pdf_size_bytes ?? null,
        target_age_min: template.target_age_min ?? null,
        target_age_max: template.target_age_max ?? null,
        target_gender: (template.target_gender as any) ?? 'any',
        target_weight_min_kg: template.target_weight_min_kg ?? null,
        target_weight_max_kg: template.target_weight_max_kg ?? null,
        target_bmi_min: template.target_bmi_min ?? null,
        target_bmi_max: template.target_bmi_max ?? null,
        target_goal: template.target_goal ?? null,
        target_experience: template.target_experience ?? [],
        duration_weeks: template.duration_weeks ?? null,
        days_per_week: template.days_per_week ?? null,
      }),
    onSuccess: (created) => {
      sonnerToast.success(`Duplicated as "${created.name}"`);
      queryClient.invalidateQueries({ queryKey: ["fitness-templates"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to duplicate template"),
  });

  const deleteTemplateMutation = useMutation({

    mutationFn: (templateId: string) => softDeletePlanTemplate(templateId),
    onSuccess: () => {
      toast.success("Template deleted");
      queryClient.invalidateQueries({ queryKey: ["fitness-templates"] });
      queryClient.invalidateQueries({ queryKey: ["fitness-template-usage"] });
      setDeleteTarget(null);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to delete template"),
  });

  const handleAssignTemplate = (template: FitnessPlanTemplate) => {
    setSelectedTemplate(template);
    setAssignDrawerOpen(true);
  };

  // Split into system + user-created sections so trainers see starters first.
  const systemTemplates = templates.filter((t) => t.system_template);
  const userTemplates = templates.filter((t) => !t.system_template);
  const hasAnyTemplate = templates.length > 0;

  const renderTemplateCard = (template: FitnessPlanTemplate) => {
    const usage = usageCounts[template.id] || 0;
    const isSystem = !!template.system_template;
    const isPdf = template.source_kind === 'pdf';
    return (
      <Card
        key={template.id}
        className="rounded-2xl border-0 hover:shadow-xl hover:shadow/50 transition-shadow shadow-lg shadow/30"
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{template.name}</CardTitle>
              <CardDescription className="text-xs mt-1 line-clamp-2">
                {template.description}
              </CardDescription>
            </div>
            <Badge
              className={`border text-xs shrink-0 ${getDifficultyColor(template.difficulty)}`}
            >
              {template.difficulty || "intermediate"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="outline" className="text-xs">
              {template.type === "workout" ? (
                <Dumbbell className="h-3 w-3 mr-1" />
              ) : (
                <Utensils className="h-3 w-3 mr-1" />
              )}
              {template.type}
            </Badge>
            {template.goal && (
              <Badge variant="secondary" className="text-xs">
                {template.goal}
              </Badge>
            )}
            {template.is_common && (
              <Badge className="bg-success/10 text-success border-success/25 text-xs gap-1">
                <Share2 className="h-3 w-3" /> Common
              </Badge>
            )}
            {template.is_common && (template.target_age_min || template.target_age_max) && (
              <Badge variant="outline" className="text-[10px]">
                {template.target_age_min ?? "any"}–{template.target_age_max ?? "any"} yrs
              </Badge>
            )}
            {template.is_common && template.target_gender && template.target_gender !== "any" && (
              <Badge variant="outline" className="text-[10px] capitalize">{template.target_gender}</Badge>
            )}
            {template.is_common && template.target_goal && (
              <Badge variant="outline" className="text-[10px]">{template.target_goal.replace(/_/g, " ")}</Badge>
            )}
            {template.is_common && template.duration_weeks && (
              <Badge variant="outline" className="text-[10px]">
                {template.duration_weeks}w{template.days_per_week ? ` · ${template.days_per_week}d/wk` : ""}
              </Badge>
            )}
            {isSystem && (
              <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20 gap-1">
                <Lock className="h-3 w-3" /> Built-in
              </Badge>
            )}
            {isPdf && (
              <Badge className="bg-destructive/10 text-destructive border-destructive/25 text-xs gap-1">
                <FileText className="h-3 w-3" /> PDF
              </Badge>
            )}
            <button
              type="button"
              onClick={() => setAssignmentsTemplate(template)}
              aria-label={`View ${usage} member${usage === 1 ? "" : "s"} assigned to ${template.name}`}
              title={`View the ${usage} member${usage === 1 ? "" : "s"} assigned this plan`}
              className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary rounded-full"
            >
              <Badge
                variant="outline"
                className="text-xs gap-1 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
              >
                <Users className="h-3 w-3" />
                {usage} {usage === 1 ? "use" : "uses"}
              </Badge>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-9 flex-1 min-w-[120px] cursor-pointer" onClick={() => handleAssignTemplate(template)}>
              <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-9 cursor-pointer p-0"
              onClick={() => setViewing(template)}
              title="Preview plan"
              aria-label={`Preview ${template.name}`}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-9 cursor-pointer p-0"
              onClick={() => handleDownloadTemplate(template)}
              title={isPdf ? 'Open PDF' : 'Download PDF'}
              aria-label={`${isPdf ? 'Open' : 'Download'} PDF for ${template.name}`}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            {!isPdf && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-9 cursor-pointer p-0"
                onClick={() => {
                  const t = template.type === "workout" ? "workout" : "diet";
                  navigate(`/fitness/create/manual?type=${t}&template=${template.id}`);
                }}
                title="Use as starting point"
                aria-label={`Use ${template.name} as a starting point`}
              >
                <FilePlus className="h-3.5 w-3.5" />
              </Button>
            )}
            {canCreate && !isPdf && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-9 cursor-pointer p-0"
                onClick={() => {
                  const t = template.type === "workout" ? "workout" : "diet";
                  navigate(`/fitness/create/manual?type=${t}&template=${template.id}&edit=1`);
                }}
                title={isSystem ? "Customize a copy" : "Edit template content"}
                aria-label={`Edit ${template.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {canCreate && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-9 cursor-pointer p-0"
                disabled={duplicateTemplateMutation.isPending}
                onClick={() => duplicateTemplateMutation.mutate(template)}
                title="Duplicate template"
                aria-label={`Duplicate ${template.name}`}
              >
                <CopyIcon className="h-3.5 w-3.5" />
              </Button>
            )}

            {canCreate && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-9 cursor-pointer p-0"
                onClick={() => setTargetingTemplate(template)}
                title="Audience targeting (age/weight/goal)"
                aria-label={`Audience targeting for ${template.name}`}
              >
                <Target className="h-3.5 w-3.5" />
              </Button>
            )}
            {canCreate && !isSystem && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 w-9 cursor-pointer p-0"
                onClick={() => setDeleteTarget(template)}
                title="Delete template"
                aria-label={`Delete ${template.name}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </div>

        </CardContent>
      </Card>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <FitnessHubTabs />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Library className="h-5 w-5 text-primary" />
              Plan Templates
            </h2>
            <p className="text-sm text-muted-foreground">
              Browse, preview, and assign workout & diet templates. Common plans are reusable across
              walk-in members without dedicated trainers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl bg-muted/50 p-1 gap-1">
              <Button
                size="sm"
                variant={planType === "workout" ? "default" : "ghost"}
                onClick={() => setPlanType("workout")}
                className="gap-1.5"
              >
                <Dumbbell className="h-4 w-4" /> Workout
              </Button>
              <Button
                size="sm"
                variant={planType === "diet" ? "default" : "ghost"}
                onClick={() => setPlanType("diet")}
                className="gap-1.5"
              >
                <Utensils className="h-4 w-4" /> Diet
              </Button>
            </div>
            {canCreate && (
              <Button size="sm" variant="outline" onClick={() => setUploadPdfOpen(true)} className="gap-1.5">
                <FileUp className="h-4 w-4" /> Upload PDF Template
              </Button>
            )}
          </div>
        </div>

        {/* Search + common-plan filter chips */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: "all", label: "All plans" },
                { key: "common", label: "Common (no PT)" },
                { key: "pt_only", label: "PT-specific" },
              ] as { key: CommonFilter; label: string }[]
            ).map((f) => (
              <button
                key={f.key}
                onClick={() => setCommonFilter(f.key)}
                className={`cursor-pointer text-xs px-3 py-1.5 rounded-full border transition focus:outline-none focus:ring-2 focus:ring-primary ${
                  commonFilter === f.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted border-border"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="template-search" className="sr-only">Search templates</label>
            <Input
              id="template-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="h-9 rounded-xl pl-9"
            />
          </div>
        </div>

        {/* Templates */}
        {templatesLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-card p-5 shadow-lg shadow-muted/30 space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <Skeleton className="h-9 w-full rounded-xl" />
              </div>
            ))}
          </div>
        ) : !hasAnyTemplate ? (

          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center">
              <Library className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Templates Yet</h3>
              <p className="text-muted-foreground mb-4">
                {canCreate
                  ? "Create plans and save them as templates."
                  : "Templates will appear here once your manager creates them."}
              </p>
              {canCreate && (
                <Button onClick={() => navigate("/fitness/create")}>
                  <Sparkles className="mr-2 h-4 w-4" /> Create First Plan
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {systemTemplates.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5" /> Starter Plans
                </h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {systemTemplates.map(renderTemplateCard)}
                </div>
              </div>
            )}

            {userTemplates.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Your Saved Templates
                </h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {userTemplates.map(renderTemplateCard)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <AssignPlanDrawer
        open={assignDrawerOpen}
        onOpenChange={setAssignDrawerOpen}
        branchId={effectiveBranchId || undefined}
        plan={
          selectedTemplate
            ? {
                name: selectedTemplate.name,
                type: selectedTemplate.type,
                description: selectedTemplate.description || undefined,
                content: selectedTemplate.content,
                template_id: selectedTemplate.id,
                is_common: !!selectedTemplate.is_common,
                source_kind: (selectedTemplate.source_kind as 'structured' | 'pdf') || 'structured',
                pdf_url: selectedTemplate.pdf_url ?? null,
                pdf_filename: selectedTemplate.pdf_filename ?? null,
                pdf_size_bytes: selectedTemplate.pdf_size_bytes ?? null,
              }
            : null
        }
      />

      <UploadPdfTemplateDrawer
        open={uploadPdfOpen}
        onOpenChange={setUploadPdfOpen}
        defaultType={planType}
      />

      <TemplateAssignmentsSheet
        open={!!assignmentsTemplate}
        onOpenChange={(o) => !o && setAssignmentsTemplate(null)}
        template={assignmentsTemplate ? { id: assignmentsTemplate.id, name: assignmentsTemplate.name } : null}
        branchId={effectiveBranchId || undefined}
      />



      <EditTemplateTargetingDrawer
        open={!!targetingTemplate}
        onOpenChange={(o) => !o && setTargetingTemplate(null)}
        template={targetingTemplate}
      />

      <PlanViewerSheet
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        plan={
          viewing
            ? {
                id: viewing.id,
                name: viewing.name,
                type: viewing.type,
                description: viewing.description,
                data: viewing.content,
                source_kind: (viewing.source_kind as 'structured' | 'pdf') || 'structured',
                pdf_url: viewing.pdf_url ?? null,
                pdf_filename: viewing.pdf_filename ?? null,
              }
            : null
        }
        onDownload={() => viewing && handleDownloadTemplate(viewing)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (usageCounts[deleteTarget.id] || 0) > 0 ? (
                <>
                  This template is currently used by{" "}
                  <strong>{usageCounts[deleteTarget.id]}</strong> member plan
                  {usageCounts[deleteTarget.id] === 1 ? "" : "s"}. Existing assignments will keep
                  working — they hold their own snapshot — but the template will no longer appear
                  in this list.
                </>
              ) : (
                "The template will be hidden from this list. Existing assignments are unaffected."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteTemplateMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
