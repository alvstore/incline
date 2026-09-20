import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelClassSession,
  createClassTemplate,
  createClassType,
  deleteClassTemplate,
  deleteClassType,
  fetchClassSessions,
  fetchClassTypes,
  fetchMemberClassBookings,
  generateClassSessions,
  overrideClassSession,
  reinstateClassSession,
  updateClassTemplate,
  updateClassType,
  type FetchSessionsOptions,
} from '@/services/classTypeService';
import type {
  ClassTemplateInsert,
  ClassTemplateUpdate,
  ClassTypeInsert,
  ClassTypeUpdate,
  OverrideSessionInput,
} from '@/types/classEngine';

/** Every query that renders sessions or rules — invalidated together so all tabs stay in sync. */
const SESSION_KEYS: string[][] = [['class-types'], ['class-sessions'], ['classes'], ['agenda-classes'], ['my-class-bookings'], ['class-bookings'], ['class-waitlist']];

function useInvalidateClassEngine() {
  const qc = useQueryClient();
  return () => Promise.all(SESSION_KEYS.map((key) => qc.invalidateQueries({ queryKey: key })));
}

export function useClassTypes(branchId: string, includeInactive = true) {
  return useQuery({
    queryKey: ['class-types', branchId, includeInactive],
    queryFn: () => fetchClassTypes(branchId, includeInactive),
    enabled: !!branchId,
  });
}

export function useClassSessions(branchId: string, opts: FetchSessionsOptions) {
  return useQuery({
    queryKey: ['class-sessions', branchId, opts.fromISO, opts.toISO, !!opts.includeCancelled, opts.classTypeId ?? null],
    queryFn: () => fetchClassSessions(branchId, opts),
    enabled: !!branchId && !!opts.fromISO && !!opts.toISO,
  });
}

export function useMemberClassBookings(memberId: string | undefined) {
  return useQuery({
    queryKey: ['my-class-bookings', memberId],
    queryFn: () => fetchMemberClassBookings(memberId!),
    enabled: !!memberId,
  });
}

export function useCreateClassType() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({ mutationFn: (input: ClassTypeInsert) => createClassType(input), onSuccess: invalidate });
}

export function useUpdateClassType() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: ClassTypeUpdate }) => updateClassType(id, updates),
    onSuccess: invalidate,
  });
}

export function useDeleteClassType() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({ mutationFn: (id: string) => deleteClassType(id), onSuccess: invalidate });
}

export function useCreateClassTemplate() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({ mutationFn: (input: ClassTemplateInsert) => createClassTemplate(input), onSuccess: invalidate });
}

export function useUpdateClassTemplate() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: ClassTemplateUpdate }) => updateClassTemplate(id, updates),
    onSuccess: invalidate,
  });
}

export function useDeleteClassTemplate() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => deleteClassTemplate(id, reason),
    onSuccess: invalidate,
  });
}

export function useGenerateClassSessions() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({
    mutationFn: ({ templateId, daysAhead }: { templateId?: string; daysAhead?: number } = {}) => generateClassSessions(templateId, daysAhead),
    onSuccess: invalidate,
  });
}

export function useCancelClassSession() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({
    mutationFn: ({ classId, reason }: { classId: string; reason?: string }) => cancelClassSession(classId, reason),
    onSuccess: invalidate,
  });
}

export function useReinstateClassSession() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({ mutationFn: (classId: string) => reinstateClassSession(classId), onSuccess: invalidate });
}

export function useOverrideClassSession() {
  const invalidate = useInvalidateClassEngine();
  return useMutation({
    mutationFn: ({ input, venueChanged }: { input: OverrideSessionInput; venueChanged?: boolean }) =>
      overrideClassSession(input, { venueChanged }),
    onSuccess: invalidate,
  });
}
