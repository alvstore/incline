import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDroppable, closestCorners } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { LANES, STATUS_PILL } from './taskTokens';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';
import { CheckSquare } from 'lucide-react';
import type { TaskStatus } from '@/services/taskService';

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
        'flex flex-col rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/60 p-3 min-h-[300px] transition-colors',
        isOver && 'bg-indigo-50/60 ring-indigo-300',
      )}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full bg-gradient-to-r', lane.accent)} />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">{lane.label}</h3>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200 tabular-nums">
            {tasks.length}
          </span>
        </div>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1">
          {tasks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-6 text-xs text-slate-400">
              Drop tasks here
            </div>
          ) : (
            tasks.map((t) => <TaskCard key={t.id} task={t} onClick={() => onOpen(t)} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function TaskBoard({ tasks, onOpen, onMove }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
      <div className="rounded-2xl bg-white p-12 shadow-lg shadow-slate-200/50 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
          <CheckSquare className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">No tasks match this view</h3>
        <p className="mt-1 text-xs text-slate-500">Try a different filter, or create a new task.</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => (
          <Lane key={lane.id} lane={lane} tasks={grouped[lane.id] || []} onOpen={onOpen} />
        ))}
      </div>
    </DndContext>
  );
}
