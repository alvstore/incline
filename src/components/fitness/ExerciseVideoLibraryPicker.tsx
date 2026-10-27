import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, LibraryBig, Search, Video } from 'lucide-react';
import { track } from '@/lib/analytics';

export interface ExerciseLibraryItem {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  form_cues: string[];
  source: string;
}

interface Props {
  /** Pre-seed the search box, usually the exercise name already typed. */
  initialQuery?: string;
  onSelect: (item: ExerciseLibraryItem) => void;
}

async function searchLibrary(query: string): Promise<ExerciseLibraryItem[]> {
  const { data, error } = await supabase.functions.invoke('exercise-videos', {
    body: { query, limit: 8 },
  });
  if (error) throw error;
  return (data?.results ?? []) as ExerciseLibraryItem[];
}

/**
 * Debounced search over the curated exercise video library. Selecting a
 * result hands the catalog row back to the parent (VideoAttachmentControl),
 * which persists the video URL and form cues onto the plan exercise.
 */
export function ExerciseVideoLibraryPicker({ initialQuery, onSelect }: Props) {
  const [input, setInput] = useState(initialQuery ?? '');
  const [debounced, setDebounced] = useState(initialQuery ?? '');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['exercise-video-library', debounced],
    queryFn: () => searchLibrary(debounced),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search exercise library, e.g. bench press"
          className="h-8 pl-8 text-xs"
          aria-label="Search exercise video library"
        />
      </div>

      {debounced.length < 2 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <LibraryBig className="h-3 w-3" /> Type at least 2 characters to search the curated library.
        </p>
      ) : isLoading ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Searching…
        </p>
      ) : isError ? (
        <p className="text-[11px] text-destructive">Library search failed — you can still paste a URL or upload.</p>
      ) : !data?.length ? (
        <p className="text-[11px] text-muted-foreground">No match in the library. Use the URL or Upload tab instead.</p>
      ) : (
        <ul className="max-h-52 space-y-1 overflow-y-auto pr-1" role="listbox" aria-label="Exercise library results">
          {data.map((item) => (
            <li key={item.id}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full cursor-pointer justify-start gap-2 px-2.5 py-2 text-left"
                onClick={() => {
                  track('exercise_video_attached', { source: item.source, has_video: !!item.video_url });
                  onSelect(item);
                }}
              >
                <Video className={`h-3.5 w-3.5 shrink-0 ${item.video_url ? 'text-accent' : 'text-muted-foreground/50'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{item.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {[item.muscle_group, item.equipment].filter(Boolean).join(' · ') || 'General'}
                  </span>
                </span>
                {item.video_url ? (
                  <Badge variant="secondary" className="shrink-0 text-[9px]">Video</Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 text-[9px] text-muted-foreground">Cues only</Badge>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
