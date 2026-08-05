import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Database } from "@/integrations/supabase/types";
import * as bookingService from "@/services/benefitBookingService";
import { invalidateBenefitData } from "@/lib/benefits/invalidateBenefitData";

type BenefitType = Database["public"]["Enums"]["benefit_type"];
type BenefitBookingStatus = Database["public"]["Enums"]["benefit_booking_status"];

// ========== SETTINGS ==========

export function useBenefitSettings(branchId: string) {
  return useQuery({
    queryKey: ["benefit-settings", branchId],
    queryFn: () => bookingService.getBenefitSettings(branchId),
    enabled: !!branchId,
  });
}

export function useUpsertBenefitSetting() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: bookingService.upsertBenefitSetting,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["benefit-settings", variables.branch_id] });
    },
  });
}

// ========== SLOTS ==========

export function useAvailableSlots(branchId: string, benefitType: BenefitType, date: string) {
  return useQuery({
    queryKey: ["benefit-slots", branchId, benefitType, date],
    queryFn: () => bookingService.getAvailableSlots(branchId, benefitType, date),
    enabled: !!branchId && !!benefitType && !!date,
  });
}

export function useGenerateDailySlots() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      branchId,
      benefitType,
      benefitTypeId,
      date,
      settings,
    }: {
      branchId: string;
      benefitType: BenefitType;
      benefitTypeId?: string;
      date: string;
      settings: bookingService.BenefitSettings;
    }) => bookingService.generateDailySlots(branchId, benefitType, date, settings, benefitTypeId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["benefit-slots", variables.branchId, variables.benefitType, variables.date],
      });
    },
  });
}

export function useCreateSlot() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: bookingService.createSlot,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["benefit-slots", data.branch_id, data.benefit_type, data.slot_date],
      });
    },
  });
}

export function useUpdateSlot() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<bookingService.BenefitSlot> }) =>
      bookingService.updateSlot(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benefit-slots"] });
    },
  });
}

// ========== BOOKINGS ==========

export function useSlotBookings(slotId: string) {
  return useQuery({
    queryKey: ["slot-bookings", slotId],
    queryFn: () => bookingService.getSlotBookings(slotId),
    enabled: !!slotId,
  });
}

export function useMemberBookings(memberId: string, status?: BenefitBookingStatus[]) {
  return useQuery({
    queryKey: ["member-bookings", memberId, status],
    queryFn: () => bookingService.getMemberBookings(memberId, status),
    enabled: !!memberId,
  });
}

export function useBookSlot() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      slotId,
      memberId,
      membershipId,
      notes,
    }: {
      slotId: string;
      memberId: string;
      membershipId: string;
      notes?: string;
    }) => bookingService.bookSlot(slotId, memberId, membershipId, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benefit-slots"] });
      queryClient.invalidateQueries({ queryKey: ["slot-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["member-bookings"] });
    },
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason?: string }) =>
      bookingService.cancelBooking(bookingId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benefit-slots"] });
      queryClient.invalidateQueries({ queryKey: ["slot-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["member-bookings"] });
    },
  });
}

export function useMarkAttendance() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ bookingId, attended }: { bookingId: string; attended: boolean }) =>
      bookingService.markAttendance(bookingId, attended),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slot-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["member-bookings"] });
    },
  });
}

// ========== PACKAGES ==========

export function useBenefitPackages(branchId: string, benefitType?: BenefitType) {
  return useQuery({
    queryKey: ["benefit-packages", branchId, benefitType],
    queryFn: () => bookingService.getBenefitPackages(branchId, benefitType),
    enabled: !!branchId,
  });
}

export function useCreateBenefitPackage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: bookingService.createBenefitPackage,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["benefit-packages", data.branch_id] });
    },
  });
}

export function useUpdateBenefitPackage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<bookingService.BenefitPackage> }) =>
      bookingService.updateBenefitPackage(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benefit-packages"] });
    },
  });
}

// ========== CREDITS ==========

export function useMemberCredits(memberId: string, benefitType?: BenefitType) {
  return useQuery({
    queryKey: ["member-credits", memberId, benefitType],
    queryFn: () => bookingService.getMemberCredits(memberId, benefitType),
    enabled: !!memberId,
  });
}

export function usePurchaseBenefitCredits() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      memberId,
      membershipId,
      packageId,
      invoiceId,
      branchId,
    }: {
      memberId: string;
      membershipId: string | null;
      packageId: string;
      invoiceId?: string;
      branchId?: string;
    }) => bookingService.purchaseBenefitCredits(memberId, membershipId, packageId, invoiceId, branchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-credits"] });
      queryClient.invalidateQueries({ queryKey: ["benefit-balances"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-overdue-invoices"] });
    },
  });
}

export function useDeductMemberCredits() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ creditsId, amount }: { creditsId: string; amount?: number }) =>
      bookingService.deductMemberCredits(creditsId, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-credits"] });
      queryClient.invalidateQueries({ queryKey: ["benefit-balances"] });
    },
  });
}
