import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Ruler, Scale, TrendingUp, X } from 'lucide-react';
import {
  measurementFieldDefinitions,
  normalizeMeasurementDraft,
  type MeasurementDraft,
  hasMeaningfulMeasurementData,
} from '@/lib/measurements/measurementValidation';

interface RecordMeasurementDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  /** Member profile gender — auto-fills body presentation. */
  memberGender?: string | null;
}

function deriveBodyPresentation(gender?: string | null): 'male' | 'female' | 'other' {
  const g = (gender || '').toString().trim().toLowerCase();
  if (g === 'male' || g === 'm') return 'male';
  if (g === 'female' || g === 'f') return 'female';
  return 'other';
}

interface DraftPhoto {
  path: string;
  previewUrl: string;
}

const initialFormState: MeasurementDraft = {
  gender_presentation: '',
  weight_kg: '',
  height_cm: '',
  body_fat_percentage: '',
  shoulder_cm: '',
  chest_cm: '',
  abdomen_cm: '',
  waist_cm: '',
  hips_cm: '',
  neck_cm: '',
  torso_length_cm: '',
  biceps_left_cm: '',
  biceps_right_cm: '',
  forearm_left_cm: '',
  forearm_right_cm: '',
  wrist_left_cm: '',
  wrist_right_cm: '',
  thighs_left_cm: '',
  thighs_right_cm: '',
  calves_cm: '',
  ankle_left_cm: '',
  ankle_right_cm: '',
  inseam_cm: '',
  posture_type: '',
  body_shape_profile: '',
  notes: '',
};

export function RecordMeasurementDrawer({
  open,
  onOpenChange,
  memberId,
  memberName,
  memberGender,
}: RecordMeasurementDrawerProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const derivedPresentation = deriveBodyPresentation(memberGender);
  const [formData, setFormData] = useState<MeasurementDraft>({
    ...initialFormState,
    gender_presentation: derivedPresentation,
  });
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open && photos.length) {
      void cleanupDraftPhotos(photos.map((photo) => photo.path));
      setPhotos([]);
    }
    if (!open) {
      sessionIdRef.current = crypto.randomUUID();
      setFormData({ ...initialFormState, gender_presentation: derivedPresentation });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, derivedPresentation]);

  // Keep auto-derived presentation in sync if the prop changes while open
  useEffect(() => {
    setFormData((prev) => ({ ...prev, gender_presentation: derivedPresentation }));
  }, [derivedPresentation]);

  const calculateBMI = () => {
    const weight = Number.parseFloat(formData.weight_kg || '');
    const height = Number.parseFloat(formData.height_cm || '');
    if (!weight || !height) return null;
    return (weight / Math.pow(height / 100, 2)).toFixed(1);
  };

  const cleanupDraftPhotos = async (paths: string[]) => {
    if (!paths.length) return;
    await supabase.storage.from('member-photos').remove(paths);
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;

    setUploading(true);
    const nextPhotos: DraftPhoto[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 10MB)`);
        continue;
      }

      try {
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `${memberId}/drafts/${sessionIdRef.current}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('member-photos').upload(path, file, { upsert: false });
        if (error) throw error;
        nextPhotos.push({ path, previewUrl: URL.createObjectURL(file) });
      } catch (error) {
        console.error(error);
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    setPhotos((prev) => [...prev, ...nextPhotos]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = async (index: number) => {
    const target = photos[index];
    if (!target) return;
    await cleanupDraftPhotos([target.path]);
    URL.revokeObjectURL(target.previewUrl);
    setPhotos((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const groupedFields = useMemo(() => ({
    core: measurementFieldDefinitions.filter((field) => field.category === 'core'),
    torso: measurementFieldDefinitions.filter((field) => field.category === 'torso'),
    arms: measurementFieldDefinitions.filter((field) => field.category === 'arms'),
    legs: measurementFieldDefinitions.filter((field) => field.category === 'legs'),
  }), []);

  const saveMeasurement = useMutation({
    mutationFn: async () => {
      const { normalized, errors } = normalizeMeasurementDraft(formData);
      if (errors.length) throw new Error(errors[0]);

      const payload = {
        ...normalized,
        photos: photos.map((photo) => photo.path),
      };

      if (!hasMeaningfulMeasurementData(payload)) {
        throw new Error('Add at least one measurement or progress photo.');
      }

      const { error } = await supabase.rpc('record_member_measurement', {
        p_member_id: memberId,
        p_payload: payload,
      });

      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success('Measurement recorded securely');
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setPhotos([]);
      queryClient.invalidateQueries({ queryKey: ['member-measurements', memberId] });
      queryClient.invalidateQueries({ queryKey: ['my-measurements', memberId] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save measurement');
    },
  });

  const handleClose = async () => {
    await cleanupDraftPhotos(photos.map((photo) => photo.path));
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPhotos([]);
    onOpenChange(false);
  };

  const bmi = calculateBMI();

  const renderFieldGrid = (title: string, keys: Array<keyof typeof groupedFields>) => {
    const items = keys.flatMap((key) => groupedFields[key]);
    return (
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Ruler className="h-4 w-4 text-accent" />
          {title}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{field.label}</Label>
              <Input
                type="number"
                step={field.step ?? 0.1}
                min={field.min}
                max={field.max}
                value={formData[field.key] ?? ''}
                onChange={(event) => setFormData((prev) => ({ ...prev, [field.key]: event.target.value }))}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => void (nextOpen ? onOpenChange(true) : handleClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5 text-accent" />
            Record Body Progress
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6 pb-6">
          <Card className="rounded-2xl border-border/60 bg-card shadow-lg shadow-primary/5">
            <CardContent className="pt-5">
              <p className="text-lg font-semibold text-foreground">{memberName}</p>
              <p className="text-sm text-muted-foreground">Secure, branch-scoped measurement capture with private progress photos.</p>
            </CardContent>
          </Card>

          <div className="grid gap-4 rounded-2xl bg-gradient-to-r from-primary to-primary/85 p-5 text-primary-foreground shadow-lg shadow-primary/20 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-primary-foreground/80">Body presentation</Label>
                <div className="flex items-center justify-between rounded-md border border-primary-foreground/15 bg-primary-foreground/10 px-3 py-2 text-primary-foreground">
                  <span className="capitalize">
                    {formData.gender_presentation || 'Not set'}
                  </span>
                  <Badge variant="secondary" className="rounded-full bg-primary-foreground/15 text-primary-foreground">
                    Auto from profile
                  </Badge>
                </div>
                <p className="text-xs text-primary-foreground/70">
                  Pulled from member profile gender. Update gender on the profile to change this.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {groupedFields.core.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs text-primary-foreground/80">{field.label}</Label>
                    <Input
                      type="number"
                      step={field.step ?? 0.1}
                      min={field.min}
                      max={field.max}
                      className="border-primary-foreground/15 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/50"
                      value={formData[field.key] ?? ''}
                      onChange={(event) => setFormData((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-primary-foreground/10 p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-primary-foreground/75">
                <Scale className="h-4 w-4" />
                Live BMI
              </div>
              <div className="mt-2 text-3xl font-semibold">{bmi || '--'}</div>
            </div>
          </div>

          {renderFieldGrid('Torso calibration', ['torso'])}
          {renderFieldGrid('Arms calibration', ['arms'])}
          {renderFieldGrid('Legs calibration', ['legs'])}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Posture type</Label>
              <Input
                value={formData.posture_type ?? ''}
                onChange={(event) => setFormData((prev) => ({ ...prev, posture_type: event.target.value }))}
                placeholder="e.g. neutral, athletic"
              />
            </div>
            <div className="space-y-2">
              <Label>Body shape profile</Label>
              <Input
                value={formData.body_shape_profile ?? ''}
                onChange={(event) => setFormData((prev) => ({ ...prev, body_shape_profile: event.target.value }))}
                placeholder="e.g. V-shape, balanced"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Camera className="h-4 w-4 text-accent" />
                Private progress photos
              </h3>
              <Badge variant="secondary" className="rounded-full px-3 py-1">Signed URLs only</Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {photos.map((photo, index) => (
                <div key={photo.path} className="relative overflow-hidden rounded-2xl bg-secondary">
                  <img src={photo.previewUrl} alt={`Draft progress ${index + 1}`} className="aspect-square w-full object-cover" />
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="absolute right-2 top-2 h-7 w-7 rounded-full"
                    onClick={() => void removePhoto(index)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="aspect-square rounded-2xl border-dashed"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                  <span className="text-xs">Add photo</span>
                </div>
              </Button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              placeholder="Observations, posture cues, or coaching notes..."
              value={formData.notes ?? ''}
              onChange={(event) => setFormData((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => void handleClose()}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => saveMeasurement.mutate()} disabled={saveMeasurement.isPending || uploading}>
              {saveMeasurement.isPending ? 'Saving…' : 'Save measurement'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
