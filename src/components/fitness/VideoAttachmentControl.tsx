import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Link as LinkIcon, LibraryBig, Upload, Video, X, AlertCircle } from 'lucide-react';
import {
  uploadVideo,
  validateVideoFile,
  isAcceptedVideoUrl,
  ACCEPTED_VIDEO_EXT,
  getVideoPublicUrl,
  deleteVideo,
} from '@/services/videoUploadService';
import { ExerciseVideoLibraryPicker, type ExerciseLibraryItem } from './ExerciseVideoLibraryPicker';

/** Global feature flag (settings row, branch_id NULL) gating the Library tab. */
function useExerciseLibraryEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['feature-flag', 'exercise_video_library_enabled'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .is('branch_id', null)
        .eq('key', 'exercise_video_library_enabled')
        .maybeSingle();
      if (error) return true; // fail open — flag row may predate policies
      return data?.value !== false;
    },
    staleTime: 10 * 60 * 1000,
  });
  return data ?? true;
}

export interface VideoAttachmentValue {
  video_url?: string;
  video_file_path?: string;
  /** Light WebP preview shown before the MP4 loads (library picks only). */
  poster_url?: string;
}

interface Props {
  value: VideoAttachmentValue;
  onChange: (next: VideoAttachmentValue) => void;
  folder: 'exercises' | 'meals';
  label?: string;
  /** Exercise name used to pre-seed the library search (exercise cards only). */
  exerciseName?: string;
  /** Called when a library pick carries form cues the parent may apply. */
  onFormTips?: (tips: string[]) => void;
}

/**
 * Tabbed Library / URL / Upload control used by the workout exercise card and
 * the meal card. Persists `{ video_url, video_file_path }` into the parent
 * draft. The Library tab (exercises only, behind the
 * `exercise_video_library_enabled` flag) searches the curated catalog.
 */
export function VideoAttachmentControl({ value, onChange, folder, label, exerciseName, onFormTips }: Props) {
  const libraryEnabled = folder === 'exercises' && useExerciseLibraryEnabled();
  const [tab, setTab] = useState<'library' | 'url' | 'upload'>(
    value.video_file_path ? 'upload' : libraryEnabled ? 'library' : 'url',
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(value.video_url || '');
  const fileRef = useRef<HTMLInputElement>(null);

  const hasAttachment = !!(value.video_url || value.video_file_path);
  const previewUrl = value.video_file_path ? getVideoPublicUrl(value.video_file_path) : value.video_url;

  const handleUrlBlur = async () => {
    setError(null);
    const trimmed = urlInput.trim();
    if (!trimmed) {
      onChange({ ...value, video_url: undefined });
      return;
    }
    if (!isAcceptedVideoUrl(trimmed)) {
      setError('Use a YouTube, Vimeo, or direct .mp4/.mov/.webm URL.');
      return;
    }
    // If there was a previously uploaded storage object, clean it up so we
    // don't leave orphans in the bucket when switching to an external URL.
    if (value.video_file_path) {
      try {
        await deleteVideo(value.video_file_path);
      } catch {
        /* swallow — UI swap must always succeed */
      }
    }
    onChange({ video_file_path: undefined, video_url: trimmed });
  };

  const handleFile = async (file: File) => {
    setError(null);
    const v = validateVideoFile(file);
    if (v) {
      setError(v);
      return;
    }
    setUploading(true);
    try {
      const result = await uploadVideo(file, folder);
      // Persist the public URL into `video_url` so the member-side player
      // (which reads `video_url` directly) can stream the uploaded file.
      // `video_file_path` is also kept so the file can be deleted later.
      onChange({ video_url: result.publicUrl, video_file_path: result.path });
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleLibrarySelect = async (item: ExerciseLibraryItem) => {
    setError(null);
    if (item.video_url) {
      // A library video replaces any previously uploaded file.
      if (value.video_file_path) {
        try {
          await deleteVideo(value.video_file_path);
        } catch {
          /* swallow — UI swap must always succeed */
        }
      }
      onChange({
        video_file_path: undefined,
        video_url: item.video_url,
        poster_url: item.thumbnail_url ?? undefined,
      });
    }
    if (item.form_cues?.length && onFormTips) onFormTips(item.form_cues);
  };

  const clear = async () => {
    if (value.video_file_path) {
      try {
        await deleteVideo(value.video_file_path);
      } catch {
        /* swallow — UI clear must always succeed */
      }
    }
    setUrlInput('');
    setError(null);
    onChange({ video_url: undefined, video_file_path: undefined });
  };

  return (
    <div className="space-y-2">
      {label && <Label className="text-xs">{label}</Label>}

      {hasAttachment ? (
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 border">
          <Video className="h-4 w-4 text-accent flex-shrink-0" />
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs truncate text-primary hover:underline flex-1"
          >
            {value.video_file_path ? value.video_file_path.split('/').pop() : value.video_url}
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={clear}
            aria-label="Remove video"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'library' | 'url' | 'upload')} className="w-full">
          <TabsList className={`h-7 grid w-full ${libraryEnabled ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {libraryEnabled && (
              <TabsTrigger value="library" className="text-xs h-6">
                <LibraryBig className="h-3 w-3 mr-1" /> Library
              </TabsTrigger>
            )}
            <TabsTrigger value="url" className="text-xs h-6">
              <LinkIcon className="h-3 w-3 mr-1" /> URL
            </TabsTrigger>
            <TabsTrigger value="upload" className="text-xs h-6">
              <Upload className="h-3 w-3 mr-1" /> Upload
            </TabsTrigger>
          </TabsList>
          {libraryEnabled && (
            <TabsContent value="library" className="mt-2">
              <ExerciseVideoLibraryPicker initialQuery={exerciseName} onSelect={handleLibrarySelect} />
            </TabsContent>
          )}
          <TabsContent value="url" className="mt-2">
            <Input
              placeholder="https://youtube.com/... or .mp4 link"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={handleUrlBlur}
              className="h-8 text-xs"
            />
          </TabsContent>
          <TabsContent value="upload" className="mt-2">
            <div className="flex items-center gap-2">
              <Input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_VIDEO_EXT}
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
                className="h-8 text-xs"
              />
              {uploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">MP4, MOV, WebM · max 50MB</p>
          </TabsContent>
        </Tabs>
      )}

      {error && (
        <p className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}
