import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertCircle, Check, ChevronsUpDown, Loader2, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReferralMemberOption { id: string; member_code: string; branch_id: string | null; profiles: { full_name: string | null } | null }
export interface NewReferralValues { referrerMemberId: string; referredName: string; referredPhone: string; referredEmail: string }

export function CreateReferralDrawer({ open, onOpenChange, members, branchName, isPending, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; members: ReferralMemberOption[]; branchName: string | null; isPending: boolean; onSubmit: (values: NewReferralValues) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [values, setValues] = useState<NewReferralValues>({ referrerMemberId: '', referredName: '', referredPhone: '', referredEmail: '' });
  const [submitted, setSubmitted] = useState(false);
  const selected = useMemo(() => members.find((member) => member.id === values.referrerMemberId), [members, values.referrerMemberId]);
  const errors = { referrer: !values.referrerMemberId, name: values.referredName.trim().length < 2, phone: !/^[6-9]\d{9}$/.test(values.referredPhone), email: values.referredEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.referredEmail) };
  const invalid = Object.values(errors).some(Boolean);

  const close = (next: boolean) => { onOpenChange(next); if (!next && !isPending) { setValues({ referrerMemberId: '', referredName: '', referredPhone: '', referredEmail: '' }); setSubmitted(false); } };
  const submit = (event: React.FormEvent) => { event.preventDefault(); setSubmitted(true); if (!invalid) onSubmit(values); };

  return <Sheet open={open} onOpenChange={close}><SheetContent className="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
    <SheetHeader className="sticky top-0 z-10 border-b border-border bg-background px-6 py-5 pr-14"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserPlus className="h-5 w-5" /></span><div><SheetTitle>Create referral</SheetTitle><SheetDescription>Log a verified member introduction for {branchName || 'the selected branch'}.</SheetDescription></div></div></SheetHeader>
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
        {submitted && invalid && <div role="alert" className="flex gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>Check the highlighted fields before creating this referral.</span></div>}
        <div className="space-y-2"><Label id="referrer-label">Referrer member <span aria-hidden>*</span></Label><Popover open={pickerOpen} onOpenChange={setPickerOpen}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-labelledby="referrer-label" aria-expanded={pickerOpen} className={cn('min-h-11 w-full justify-between font-normal', submitted && errors.referrer && 'border-destructive')}><span className="truncate">{selected ? `${selected.profiles?.full_name || selected.member_code} · ${selected.member_code}` : 'Search member name or code'}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" /></Button></PopoverTrigger><PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start"><Command><CommandInput placeholder="Search members…" /><CommandList><CommandEmpty>No member found in this branch.</CommandEmpty><CommandGroup>{members.map((member) => <CommandItem key={member.id} value={`${member.profiles?.full_name || ''} ${member.member_code}`} onSelect={() => { setValues((current) => ({ ...current, referrerMemberId: member.id })); setPickerOpen(false); }}><Check className={cn('mr-2 h-4 w-4', values.referrerMemberId === member.id ? 'opacity-100' : 'opacity-0')} /><span className="flex flex-col"><span>{member.profiles?.full_name || 'Member'}</span><span className="text-xs text-muted-foreground">{member.member_code}</span></span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>{submitted && errors.referrer && <p className="text-xs text-destructive">Select the member who made the referral.</p>}</div>
        <div className="space-y-2"><Label htmlFor="referred-name">Referred person’s name <span aria-hidden>*</span></Label><Input id="referred-name" className="min-h-11" value={values.referredName} onChange={(e) => setValues({ ...values, referredName: e.target.value })} aria-invalid={submitted && errors.name} placeholder="Full name" />{submitted && errors.name && <p className="text-xs text-destructive">Enter at least 2 characters.</p>}</div>
        <div className="space-y-2"><Label htmlFor="referred-phone">Mobile number <span aria-hidden>*</span></Label><PhoneInput id="referred-phone" className="min-h-11" value={values.referredPhone} onChange={(phone) => setValues({ ...values, referredPhone: phone })} aria-invalid={submitted && errors.phone} />{submitted && errors.phone && <p className="text-xs text-destructive">Enter a valid 10-digit Indian mobile number.</p>}</div>
        <div className="space-y-2"><Label htmlFor="referred-email">Email <span className="text-muted-foreground">(optional)</span></Label><Input id="referred-email" type="email" className="min-h-11" value={values.referredEmail} onChange={(e) => setValues({ ...values, referredEmail: e.target.value })} aria-invalid={submitted && errors.email} placeholder="name@example.com" />{submitted && errors.email && <p className="text-xs text-destructive">Enter a valid email address.</p>}</div>
        <div className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">What happens next</p><p className="mt-1">This records the introduction only. Rewards are created after membership verification, then claimed through branch-manager approval.</p></div>
      </div>
      <SheetFooter className="sticky bottom-0 border-t border-border bg-background px-6 py-4"><Button type="button" variant="outline" className="min-h-11" onClick={() => close(false)} disabled={isPending}>Cancel</Button><Button type="submit" className="min-h-11" disabled={isPending}>{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{isPending ? 'Creating…' : 'Create referral'}</Button></SheetFooter>
    </form>
  </SheetContent></Sheet>;
}