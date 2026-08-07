import { useCallback, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Dumbbell, UtensilsCrossed } from 'lucide-react';
import { CreateFlowLayout } from '@/components/fitness/create/CreateFlowLayout';
import ManualWorkoutEditor from '@/components/fitness/create/manual/ManualWorkoutEditor';
import ManualDietEditor from '@/components/fitness/create/manual/ManualDietEditor';

export default function CreateManualPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = (searchParams.get('type') === 'diet' ? 'diet' : 'workout') as 'workout' | 'diet';
  const [type, setType] = useState<'workout' | 'diet'>(initial);
  const templateId = searchParams.get('template');
  const editMode = searchParams.get('edit') === '1' && !!templateId;
  const draftId = searchParams.get('draft');

  type EditorMeta = {
    canSubmit: boolean;
    submit: () => void;
    primaryLabel: string;
    dirty: boolean;
    saving: boolean;
  };

  const [meta, setMeta] = useState<EditorMeta>({
    canSubmit: false,
    submit: () => {},
    primaryLabel: 'Continue to Preview',
    dirty: false,
    saving: false,
  });

  // Stable callback so child effect doesn't loop on every parent render.
  const handleMeta = useCallback((m: EditorMeta) => setMeta(m), []);

  const handleTabChange = (next: string) => {
    const t = next as 'workout' | 'diet';
    setType(t);
    const params = new URLSearchParams(searchParams);
    params.set('type', t);
    setSearchParams(params, { replace: true });
  };

  const subtitle = useMemo(() => {
    if (editMode) return type === 'workout' ? 'Update exercises in this template' : 'Update meals in this template';
    if (draftId) return type === 'workout' ? 'Rearrange or refine the generated plan' : 'Refine the generated plan before assigning';
    return type === 'workout' ? 'Build a day-by-day program' : 'Build daily meals with live macro tracking';
  }, [editMode, draftId, type]);

  return (
    <CreateFlowLayout
      title={editMode ? 'Edit Plan Template' : draftId ? 'Edit Plan' : 'Manual Plan Builder'}
      subtitle={subtitle}
      step="build"
      showSteps={!editMode}
      chips={[
        { label: type === 'workout' ? 'Workout' : 'Diet', tone: 'primary' },
        ...(editMode ? [{ label: 'Editing template', tone: 'muted' as const }] : []),
      ]}
      isDirty={meta.dirty}
      showSaveState
      backTo={editMode ? '/fitness/templates' : draftId ? `/fitness/preview/${draftId}` : '/fitness/create'}
      actions={
        editMode ? (
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (meta.dirty && !window.confirm('Discard unsaved changes?')) return;
                navigate('/fitness/templates');
              }}
            >
              Cancel
            </Button>
            <Button onClick={meta.submit} disabled={meta.saving}>{meta.saving ? 'Saving…' : meta.primaryLabel}</Button>
          </>
        ) : (
          <Button onClick={meta.submit} disabled={meta.saving}>{meta.saving ? 'Saving…' : meta.primaryLabel}</Button>
        )
      }


    >
      <div className="space-y-4">
        {/* Hide tab switcher in edit/draft modes — type is fixed. */}
        {!editMode && !draftId && (
          <Tabs value={type} onValueChange={handleTabChange}>
            <TabsList className="grid grid-cols-2 w-full sm:w-fit">
              <TabsTrigger value="workout" className="gap-1.5">
                <Dumbbell className="h-4 w-4" /> Workout
              </TabsTrigger>
              <TabsTrigger value="diet" className="gap-1.5">
                <UtensilsCrossed className="h-4 w-4" /> Diet
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {type === 'workout'
          ? <ManualWorkoutEditor key="w" onMetaChange={handleMeta} />
          : <ManualDietEditor key="d" onMetaChange={handleMeta} />}
      </div>
    </CreateFlowLayout>
  );
}
