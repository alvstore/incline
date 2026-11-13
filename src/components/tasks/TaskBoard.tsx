import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDroppable, closestCorners } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { LANES, STATUS_PILL } from './taskTokens';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';
import { CheckSquare } from 'lucide-react';
import type { TaskStatus } from '@/services/taskService';
import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { prefersReducedMotion } from '@/components/motion/pageMotion';

gsap.registerPlugin(Flip);

interface Props {
  tasks: any[];
  onOpen: (task: any) => void;
  onMove: (id: string, status: TaskStatus) => void;
}

function Lane({ lane, tasks, onOpen }: { lane: typeof LANES[number]; tasks: any[]; onOpen: (t: any) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-2xl bg-muted/50 p-3 min-h-[300px] transition-colors',
        isOver && 'bg-primary/10 ring-2 ring-primary/40',
      )}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full bg-gradient-to-r', lane.accent)} />
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">{lane.label}</h3>
          <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
            {tasks.length}
          </span>
        </div>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1">
          {tasks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border-2 border-dashed border-border py-6 text-xs text-muted-foreground">
              Drop tasks here
            </div>
          ) : (
            tasks.map((t) => <div key={t.id} data-anim="row" data-flip-id={t.id}><TaskCard task={t} onClick={() => onOpen(t)} /></div>)
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function TaskBoard({ tasks, onOpen, onMove }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const boardRef = useRef<HTMLDivElement>(null);
  const lastSig = useRef('');
  const flipState = useRef<Flip.FlipState | null>(null);
  const sig = tasks.map((t) => `${t.id}:${t.status}`).join('|');
  // Capture positions during render (DOM still shows the old layout) whenever a card changes lane.
  if (sig !== lastSig.current && boardRef.current && !prefersReducedMotion()) {
    flipState.current = Flip.getState(boardRef.current.querySelectorAll('[data-flip-id]'));
  }
  useLayoutEffect(() => {
    const prev = lastSig.current;
    lastSig.current = sig;
    const state = flipState.current;
    flipState.current = null;
    if (!state || !prev || !boardRef.current) return;
    const tl = Flip.from(state, {
      targets: boardRef.current.querySelectorAll('[data-flip-id]'),
      duration: 0.6, ease: 'expo.out', absolute: false,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.6)', clearProps: 'opacity,transform' }),
    });
    return () => { tl.kill(); };
  }, [sig]);

  const grouped = LANES.reduce<Record<string, any[]>>((acc, l) => {
    acc[l.id] = tasks.filter((t) => t.status === l.id);
    return acc;
  }, {});

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id as string | undefined;
    const activeId = e.active.id as string;
    if (!overId) return;
    // overId is either a lane id or a card id; resolve to lane
    const laneId = LANES.find((l) => l.id === overId)?.id
      ?? (tasks.find((t) => t.id === overId)?.status as TaskStatus | undefined);
    if (!laneId) return;
    const task = tasks.find((t) => t.id === activeId);
    if (!task || task.status === laneId) return;
    onMove(activeId, laneId);
  };

  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-12 shadow-sm text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
          <CheckSquare className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">All clear</h3>
        <p className="mt-1 text-xs text-muted-foreground">Try a different filter, or create a new task.</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div ref={boardRef} className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => (
          <Lane key={lane.id} lane={lane} tasks={grouped[lane.id] || []} onOpen={onOpen} />
        ))}
      </div>
    </DndContext>
  );
}
