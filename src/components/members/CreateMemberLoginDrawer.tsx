import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { provisionMemberLogin } from '@/services/memberLoginService';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { toast } from 'sonner';
import { KeyRound, Mail, Phone, Loader2, ShieldCheck } from 'lucide-react';

export interface MemberWithoutLogin {
  id: string;
  member_code: string | null;
  branch_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
}

interface CreateMemberLoginDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberWithoutLogin | null;
  onCreated?: (userId: string) => void;
}

export function CreateMemberLoginDrawer({
  open,
  onOpenChange,
  member,
  onCreated,
}: CreateMemberLoginDrawerProps) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sendWelcome, setSendWelcome] = useState(true);

  useEffect(() => {
    if (open && member) {
      setFullName(member.full_name || '');
      setEmail(member.email || '');
      setPhone(member.phone || '');
      setSendWelcome(true);
    }
  }, [open, member]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!member) throw new Error('No member selected');
      const result = await provisionMemberLogin({
        memberId: member.id,
        fullName: fullName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      });

      if (sendWelcome && email.trim() && member.branch_id) {
        const portalUrl = `${window.location.origin}/auth`;
        try {
          await dispatchCommunication({
            branch_id: member.branch_id,
            channel: 'email',
            category: 'transactional',
            recipient: email.trim(),
            member_id: member.id,
            user_id: result.user_id,
            payload: {
              subject: 'Your member login is ready',
              body:
                `Hi ${fullName.trim() || 'there'},\n\n` +
                `Your member portal account is ready.\n\n` +
                `Member code: ${member.member_code || '—'}\n` +
                `Login email: ${email.trim()}\n` +
                `Portal: ${portalUrl}\n\n` +
                `To set your password, open the portal and choose "Forgot password" — ` +
                `we'll email you a secure link.\n\nSee you at the club!`,
              use_branded_template: true,
            },
            dedupe_key: buildDedupeKey(['member-login', member.id, 'email']),
            force: true,
          });
        } catch (e: any) {
          console.warn('welcome email dispatch failed:', e?.message || e);
          toast.warning('Login created, but the welcome email could not be sent');
        }
      }

      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['members-without-login'] });
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      invalidateMembersData(queryClient);
      toast.success(
        result.action === 'linked_existing'
          ? 'Linked to an existing account'
          : result.action === 'already_linked'
            ? 'This member already has a login'
            : 'Member login created',
      );
      onCreated?.(result.user_id);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to create member login'),
  });

  const canSubmit = !!member && (!!email.trim() || !!phone.trim()) && !createMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Member Login</SheetTitle>
          <SheetDescription>
            Mint a portal account so this member can sign in, upload a photo, and receive
            transactional messages.
          </SheetDescription>
        </SheetHeader>

        {member && (
          <div className="space-y-5 py-5">
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">{member.full_name || 'Unnamed member'}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{member.member_code || '—'}</span>
                      {member.source && (
                        <Badge variant="outline" className="rounded-full text-[10px] capitalize">
                          {member.source.replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label htmlFor="login-name">Full name</Label>
              <Input
                id="login-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Member name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-email"
                  type="email"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="member@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-phone">Phone</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-phone"
                  className="pl-9"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+919000000000"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                At least one of email or phone is required. Email is used as the sign-in identifier.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-muted/40 p-3">
              <Checkbox
                checked={sendWelcome}
                onCheckedChange={(v) => setSendWelcome(v === true)}
                disabled={!email.trim()}
                aria-label="Send welcome email with portal link"
              />
              <span className="text-sm">
                <span className="font-medium">Send welcome email</span>
                <span className="block text-xs text-muted-foreground">
                  Includes the member code, portal link, and password-setup instructions.
                </span>
              </span>
            </label>

            <div className="flex items-start gap-2 rounded-xl border border-border/60 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                Idempotent — if an account already exists with this email, it is linked to the
                member instead of creating a duplicate. The <span className="font-medium">member</span>{' '}
                role is assigned automatically.
              </span>
            </div>
          </div>
        )}

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Login
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
