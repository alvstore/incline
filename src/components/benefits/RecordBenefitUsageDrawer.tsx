import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRecordBenefitUsage, useValidateBenefitUsage } from '@/hooks/useBenefits';
import { benefitTypeLabels, type MemberBenefitBalance } from '@/services/benefitService';
import type { Database } from '@/integrations/supabase/types';

type BenefitType = Database['public']['Enums']['benefit_type'];

const formSchema = z.object({
  benefit_type: z.string().min(1, 'Please select a benefit'),
  usage_count: z.coerce.number().min(1, 'Minimum 1').max(10, 'Maximum 10'),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface RecordBenefitUsageDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membershipId: string;
  memberId: string;
  memberName: string;
  availableBenefits: MemberBenefitBalance[];
  preselectedBenefit?: BenefitType;
}

export function RecordBenefitUsageDrawer({
  open,
  onOpenChange,
  membershipId,
  memberId,
  memberName,
  availableBenefits,
  preselectedBenefit,
}: RecordBenefitUsageDrawerProps) {
  const recordMutation = useRecordBenefitUsage();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      benefit_type: preselectedBenefit || '',
      usage_count: 1,
      notes: '',
    },
  });

  const selectedBenefitValue = form.watch('benefit_type');
  // Match by benefit_type_id if it looks like a UUID, otherwise by enum
  const selectedBalance = availableBenefits.find(b => 
    b.benefit_type_id === selectedBenefitValue || b.benefit_type === selectedBenefitValue
  ) as any;

  const totalAvailable = (b: any) =>
    (b?.remaining ?? 0) + (b?.compRemaining ?? 0) + (b?.creditRemaining ?? 0);

  async function onSubmit(values: FormValues) {
    try {
      const matchedBalance = availableBenefits.find(b =>
        b.benefit_type_id === values.benefit_type || b.benefit_type === values.benefit_type
      ) as any;

      const result = await recordMutation.mutateAsync({
        membershipId,
        memberId,
        benefitType: (matchedBalance?.benefit_type || values.benefit_type) as BenefitType,
        usageCount: values.usage_count,
        notes: values.notes,
        benefitTypeId: matchedBalance?.benefit_type_id || undefined,
      });

      if (!result?.success) {
        toast.error(result?.error || 'Cannot record usage');
        return;
      }

      const parts: string[] = [];
      if (result.from_gift) parts.push(`${result.from_gift} gift`);
      if (result.from_credit) parts.push(`${result.from_credit} purchased`);
      toast.success(
        `${matchedBalance?.label || values.benefit_type} usage recorded${parts.length ? ` (${parts.join(', ')})` : ''}`
      );
      form.reset();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to record usage');
    }
  }

  // Show plan allowance, complimentary gifts and purchased credits
  const recordableBenefits = availableBenefits.filter(
    (b: any) => b.isUnlimited || totalAvailable(b) > 0
  );


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5 text-left">
          <SheetTitle>Record Benefit Usage</SheetTitle>
          <SheetDescription>Record a benefit usage for {memberName}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <FormField
                control={form.control}
                name="benefit_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Benefit Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-11 rounded-xl">
                          <SelectValue placeholder="Select benefit..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {recordableBenefits.map((benefit: any) => (
                          <SelectItem
                            key={benefit.benefit_type_id || benefit.benefit_type}
                            value={benefit.benefit_type_id || benefit.benefit_type}
                          >
                            <div className="flex w-full items-center justify-between gap-4">
                              <span>{benefit.label}</span>
                              {!benefit.isUnlimited && (
                                <span className="text-xs text-muted-foreground">
                                  {totalAvailable(benefit)} left
                                  {benefit.compRemaining > 0 ? ' (gift)' : ''}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}

                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedBalance && !selectedBalance.isUnlimited && (
                <div className="rounded-xl bg-muted p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Used this period:</span>
                    <span className="font-medium">{selectedBalance.used}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Remaining:</span>
                    <span className="font-medium text-primary">{selectedBalance.remaining}</span>
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="usage_count"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Usage Count</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={selectedBalance?.remaining ?? 10}
                        className="h-11 rounded-xl"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Number of times this benefit is being used</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add any notes about this usage..."
                        className="rounded-xl"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex gap-3 border-t bg-background px-6 py-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1 cursor-pointer rounded-xl"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 cursor-pointer rounded-xl"
                disabled={isValidating || recordMutation.isPending}
              >
                {isValidating ? 'Validating...' : recordMutation.isPending ? 'Recording...' : 'Record Usage'}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
