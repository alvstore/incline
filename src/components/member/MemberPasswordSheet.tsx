import { useState } from 'react';
import { z } from 'zod';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const passwordSchema = z.string().min(8, 'Use at least 8 characters').regex(/[A-Z]/, 'Add an uppercase letter').regex(/[a-z]/, 'Add a lowercase letter').regex(/[0-9]/, 'Add a number');

export function MemberPasswordSheet() {
  const { updatePassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setOpen(false);
    setNext('');
    setConfirm('');
    setError('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const valid = passwordSchema.safeParse(next);
    if (!valid.success) return setError(valid.error.issues[0]?.message ?? 'Choose a stronger password');
    if (next !== confirm) return setError('New passwords do not match');
    setError('');
    setSaving(true);
    try {
      const { error: updateError } = await updatePassword(next);
      if (updateError) throw updateError;
      close();
      toast.success('Password changed');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change password. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(value) => value ? setOpen(true) : close()}>
      <SheetTrigger asChild><Button variant="outline" className="min-h-11 gap-2"><KeyRound className="h-4 w-4" />Change password</Button></SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 border-b border-border px-6 py-5 text-left">
          <SheetTitle>Change password</SheetTitle>
          <SheetDescription>Update the password for your signed-in account. You can also request a reset link by email from your profile.</SheetDescription>
        </SheetHeader>
        <form id="member-password-form" onSubmit={submit} className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          <div className="space-y-2"><Label htmlFor="next-password">New password</Label><Input id="next-password" type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} required maxLength={128} /><p className="text-xs text-muted-foreground">At least 8 characters, with uppercase, lowercase and a number.</p></div>
          <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required maxLength={128} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
        <SheetFooter className="shrink-0 flex-row gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="submit" form="member-password-form" disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save password</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}