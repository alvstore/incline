import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { IndianRupee, MessageSquare, Link2, Copy, CheckCircle, Loader2, ExternalLink, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';

interface SendPaymentLinkDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoice_number: string;
    total_amount: number;
    amount_paid: number;
    member_name?: string;
    member_phone?: string;
    member_email?: string;
    branch_id?: string;
  } | null;
}

export function SendPaymentLinkDrawer({ open, onOpenChange, invoice }: SendPaymentLinkDrawerProps) {
  const [paymentType, setPaymentType] = useState<'full' | 'partial' | 'due'>('due');
  const [customAmount, setCustomAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  if (!invoice) return null;

  const dueAmount = invoice.total_amount - (invoice.amount_paid || 0);

  const getPaymentAmount = () => {
    switch (paymentType) {
      case 'full': return invoice.total_amount;
      case 'due': return dueAmount;
      case 'partial': return parseFloat(customAmount) || 0;
    }
  };

  const paymentAmount = getPaymentAmount();

  const handleGenerateRazorpayLink = async () => {
    if (paymentAmount <= 0) return;
    if (!invoice.id || !invoice.branch_id) {
      toast.error('Invoice ID and branch are required to generate a payment link.');
      return;
    }
    setGenerating(true);
    setGeneratedLink(null);

    try {
      const { data, error } = await supabase.functions.invoke('create-razorpay-link', {
        body: {
          invoiceId: invoice.id,
          amount: paymentAmount,
          branchId: invoice.branch_id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.short_url) throw new Error('No payment link returned');

      setGeneratedLink(data.short_url);
      toast.success('Razorpay payment link generated. Razorpay also sent SMS + email automatically.');

      // Best-effort: also send via configured WhatsApp / Email integrations
      // (routed through the canonical dispatcher — dedupe + preferences applied).
      if (invoice.member_phone && invoice.branch_id) {
        try {
          await dispatchCommunication({
            branch_id: invoice.branch_id,
            channel: 'whatsapp',
            category: 'payment_alert',
            recipient: invoice.member_phone,
            payload: {
              body: `Hi ${invoice.member_name || 'Member'}, your invoice ${invoice.invoice_number} has a balance of ₹${paymentAmount.toLocaleString()}. Pay securely here: ${data.short_url}`,
            },
            dedupe_key: buildDedupeKey(['paylink', invoice.id, paymentAmount, 'wa']),
            force: true,
          });
        } catch (e) { console.warn('WhatsApp dispatch skipped:', e); }
      }
      if (invoice.member_email && invoice.branch_id) {
        try {
          await dispatchCommunication({
            branch_id: invoice.branch_id,
            channel: 'email',
            category: 'payment_alert',
            recipient: invoice.member_email,
            payload: {
              subject: `Payment link for invoice ${invoice.invoice_number}`,
              body: `<p>Hi ${invoice.member_name || 'Member'},</p><p>Your invoice <b>${invoice.invoice_number}</b> has a balance of <b>₹${paymentAmount.toLocaleString()}</b>.</p><p><a href="${data.short_url}">Click here to pay securely</a></p><p>Thank you.</p>`,
              use_branded_template: true,
            },
            dedupe_key: buildDedupeKey(['paylink', invoice.id, paymentAmount, 'email']),
            force: true,
          });
        } catch (e) { console.warn('Email dispatch skipped:', e); }
      }
    } catch (err: any) {
      console.error('Razorpay link error:', err);
      toast.error(err.message || 'Failed to generate payment link. Configure Razorpay in Integrations.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = () => {
    if (!generatedLink) return;
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    toast.success('Payment link copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWhatsApp = () => {
    if (!generatedLink) return;
    const message = `Hi ${invoice.member_name || 'Member'},\n\nYour invoice *${invoice.invoice_number}* has a payment of *₹${paymentAmount.toLocaleString()}*.\n\nPay securely here:\n${generatedLink}\n\nThank you!`;
    const phone = (invoice.member_phone || '').replace(/[^0-9]/g, '');
    const formattedPhone = phone.startsWith('91') ? phone : `91${phone}`;
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setGeneratedLink(null); setGenerating(false); } }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Send Payment Link
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Invoice Summary */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Invoice</span>
                <span className="font-mono font-medium">{invoice.invoice_number}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Member</span>
                <span>{invoice.member_name || 'Walk-in'}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span>₹{invoice.total_amount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm text-success">
                <span>Paid</span>
                <span>₹{(invoice.amount_paid || 0).toLocaleString()}</span>
              </div>
              {dueAmount > 0 && (
                <div className="flex justify-between text-sm font-medium text-destructive">
                  <span>Due</span>
                  <span>₹{dueAmount.toLocaleString()}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment Amount Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Payment Amount</Label>
            <RadioGroup value={paymentType} onValueChange={(v) => { setPaymentType(v as any); setGeneratedLink(null); }} className="space-y-2">
              {dueAmount > 0 && dueAmount < invoice.total_amount && (
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value="due" id="due" />
                  <Label htmlFor="due" className="flex-1 cursor-pointer flex justify-between">
                    <span>Due Amount</span>
                    <Badge variant="outline">₹{dueAmount.toLocaleString()}</Badge>
                  </Label>
                </div>
              )}
              <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="full" id="full" />
                <Label htmlFor="full" className="flex-1 cursor-pointer flex justify-between">
                  <span>Full Amount</span>
                  <Badge variant="outline">₹{invoice.total_amount.toLocaleString()}</Badge>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="partial" id="partial" />
                <Label htmlFor="partial" className="cursor-pointer">Custom Amount</Label>
              </div>
            </RadioGroup>
            {paymentType === 'partial' && (
              <div className="flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  placeholder="Enter amount"
                  value={customAmount}
                  onChange={(e) => { setCustomAmount(e.target.value); setGeneratedLink(null); }}
                  min="1"
                  max={dueAmount > 0 ? dueAmount : invoice.total_amount}
                />
              </div>
            )}
          </div>

          {/* Primary Action: Generate Razorpay Link */}
          {paymentAmount > 0 && !generatedLink && (
            <Button
              className="w-full gap-2 h-12 text-base rounded-xl shadow-lg shadow-primary/20"
              onClick={handleGenerateRazorpayLink}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Generating secure link...
                </>
              ) : (
                <>
                  <Send className="h-5 w-5" />
                  Generate & Send Official Payment Link
                </>
              )}
            </Button>
          )}

          {/* Generated Link Display */}
          {generatedLink && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">Payment Link Ready</span>
                  <Badge className="bg-primary/10 text-primary">₹{paymentAmount.toLocaleString()}</Badge>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <Input value={generatedLink} readOnly className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={handleCopyLink}>
                    {copied ? <CheckCircle className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="h-auto py-3 flex flex-col gap-1.5 rounded-xl"
                    onClick={handleShareWhatsApp}
                  >
                    <MessageSquare className="h-5 w-5 text-success" />
                    <span className="text-xs">Share via WhatsApp</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-3 flex flex-col gap-1.5 rounded-xl"
                    onClick={() => window.open(generatedLink, '_blank')}
                  >
                    <ExternalLink className="h-5 w-5 text-info" />
                    <span className="text-xs">Open Link</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
