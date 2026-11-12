import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  updateTemplateTargeting,
  type FitnessPlanTemplate,
} from "@/services/fitnessService";
import { ALL_GOALS } from "@/lib/registration/healthQuestions";

const TARGET_GOALS = [
  { value: "weight_loss", label: "Weight Loss" },
  { value: "muscle_gain", label: "Muscle Gain" },
  { value: "endurance", label: "Endurance" },
  { value: "general_fitness", label: "General Fitness" },
  { value: "flexibility", label: "Flexibility" },
  { value: "recomposition", label: "Body Recomposition" },
] as const;

const EXPERIENCE = ["beginner", "intermediate", "advanced"] as const;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: FitnessPlanTemplate | null;
}

export function EditTemplateTargetingDrawer({ open, onOpenChange, template }: Props) {
  const qc = useQueryClient();
  const [isCommon, setIsCommon] = useState(false);
  const [ageMin, setAgeMin] = useState<string>("");
  const [ageMax, setAgeMax] = useState<string>("");
  const [gender, setGender] = useState<"any" | "male" | "female">("any");
  const [weightMin, setWeightMin] = useState<string>("");
  const [weightMax, setWeightMax] = useState<string>("");
  const [goal, setGoal] = useState<string>("");
  const [experience, setExperience] = useState<string[]>([]);
  const [durationWeeks, setDurationWeeks] = useState<string>("");
  const [daysPerWeek, setDaysPerWeek] = useState<string>("");

  useEffect(() => {
    if (!open || !template) return;
    setIsCommon(!!template.is_common);
    setAgeMin(template.target_age_min?.toString() ?? "");
    setAgeMax(template.target_age_max?.toString() ?? "");
    setGender((template.target_gender as any) || "any");
    setWeightMin(template.target_weight_min_kg?.toString() ?? "");
    setWeightMax(template.target_weight_max_kg?.toString() ?? "");
    setGoal(template.target_goal ?? "");
    setExperience(template.target_experience ?? []);
    setDurationWeeks(template.duration_weeks?.toString() ?? "");
    setDaysPerWeek(template.days_per_week?.toString() ?? "");
  }, [open, template]);

  const save = useMutation({
    mutationFn: async () => {
      if (!template) throw new Error("No template");
      await updateTemplateTargeting(template.id, {
        is_common: isCommon,
        target_age_min: ageMin ? parseInt(ageMin) : null,
        target_age_max: ageMax ? parseInt(ageMax) : null,
        target_gender: gender,
        target_weight_min_kg: weightMin ? parseFloat(weightMin) : null,
        target_weight_max_kg: weightMax ? parseFloat(weightMax) : null,
        target_goal: goal || null,
        target_experience: experience,
        duration_weeks: durationWeeks ? parseInt(durationWeeks) : null,
        days_per_week: daysPerWeek ? parseInt(daysPerWeek) : null,
      });
    },
    onSuccess: () => {
      toast.success("Targeting saved");
      qc.invalidateQueries({ queryKey: ["fitness-templates"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

  const toggleExperience = (v: string) => {
    setExperience((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Common Plan Targeting</SheetTitle>
          <SheetDescription>
            Tell the matcher who this plan is best for. We'll surface it to members
            whose age, weight, gender, goal and experience overlap with these bands.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Mark as Common Plan</Label>
              <p className="text-xs text-muted-foreground">
                Available to walk-in / non-PT members.
              </p>
            </div>
            <Switch checked={isCommon} onCheckedChange={setIsCommon} />
          </div>

          {isCommon && (
            <>
              <div>
                <Label className="text-sm">Goal</Label>
                <Select value={goal} onValueChange={setGoal}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick the primary goal" />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_GOALS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Members' free-text goals (e.g. "{ALL_GOALS[0]}") are matched against this.
                </p>
              </div>

              <div>
                <Label className="text-sm">Gender</Label>
                <Select value={gender} onValueChange={(v: any) => setGender(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Min Age</Label>
                  <Input type="number" min={5} max={100} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="e.g. 18" />
                </div>
                <div>
                  <Label className="text-sm">Max Age</Label>
                  <Input type="number" min={5} max={100} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="e.g. 35" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Min Weight (kg)</Label>
                  <Input type="number" min={20} max={250} step="0.1" value={weightMin} onChange={(e) => setWeightMin(e.target.value)} />
                </div>
                <div>
                  <Label className="text-sm">Max Weight (kg)</Label>
                  <Input type="number" min={20} max={250} step="0.1" value={weightMax} onChange={(e) => setWeightMax(e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-sm">Experience</Label>
                <div className="flex gap-2 mt-1">
                  {EXPERIENCE.map((e) => {
                    const active = experience.includes(e);
                    return (
                      <button aria-pressed={active}
                        type="button"
                        key={e}
                        onClick={() => toggleExperience(e)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize ${
                          active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                        }`}
                      >
                        {e}
                      </button>
                    );
                  })}
                </div>
                {experience.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Empty = available to all experience levels.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Duration (weeks)</Label>
                  <Input type="number" min={1} max={52} value={durationWeeks} onChange={(e) => setDurationWeeks(e.target.value)} />
                </div>
                <div>
                  <Label className="text-sm">Days / week</Label>
                  <Input type="number" min={1} max={7} value={daysPerWeek} onChange={(e) => setDaysPerWeek(e.target.value)} />
                </div>
              </div>

              {goal && (
                <div className="rounded-lg bg-muted/50 p-3 text-xs">
                  <span className="font-medium">Preview:</span>{" "}
                  <Badge variant="secondary" className="ml-1">
                    {ageMin || "any"}–{ageMax || "any"} yrs · {gender} ·{" "}
                    {TARGET_GOALS.find((g) => g.value === goal)?.label}
                    {durationWeeks ? ` · ${durationWeeks}w` : ""}
                    {daysPerWeek ? ` · ${daysPerWeek}d/wk` : ""}
                  </Badge>
                </div>
              )}
            </>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Targeting"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
