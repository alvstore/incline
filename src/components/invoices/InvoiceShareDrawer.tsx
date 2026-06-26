import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, MessageCircle, Copy, Printer, Download, Send, Phone, Paperclip } from 'lucide-react';
import { format } from 'date-fns';
import { communicationService } from '@/services/communicationService';
import { e } from '@/utils/htmlEscape';
import { supabase } from '@/integrations/supabase/client';
import { generateInvoicePdfBlob } from '@/utils/invoicePdf';
import { uploadAttachment } from '@/utils/uploadAttachment';
import { sendWhatsAppDocument } from '@/utils/whatsappDocumentSender';
import { findTemplate, resolveTemplate } from '@/lib/templates/dynamicAttachment';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';

interface InvoiceShareDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: any;
}

export function InvoiceShareDrawer({ open, onOpenChange, invoice: invoiceProp }: InvoiceShareDrawerProps) {
  const [email, setEmail] = useState(
    invoiceProp?.members?.profiles?.email || invoiceProp?.customer_email || ''
  );
  const [phone, setPhone] = useState(
    invoiceProp?.members?.profiles?.phone || invoiceProp?.customer_phone || ''
  );
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Always fetch the full invoice (with branch + items) when the drawer opens so
  // the generated PDF has every field, regardless of how the caller queried.
  const { data: fullInvoice } = useQuery({
    queryKey: ['invoice-share-detail', invoiceProp?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          members(member_code, profiles:user_id(full_name, email, phone)),
          branch:branch_id(name, address, phone, email, gstin),
          invoice_items(*)
        `)
        .eq('id', invoiceProp.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceProp?.id && open,
  });

  if (!invoiceProp) return null;
  const invoice: any = fullInvoice || invoiceProp;

  const memberProfile = (invoice.members as any)?.profiles;
  const memberName = memberProfile?.full_name || invoice.customer_name || 'Customer';
  const guestEmail = memberProfile?.email || invoice.customer_email || null;
  const guestPhone = memberProfile?.phone || invoice.customer_phone || null;
  const branch = (invoice as any).branch || (invoice as any).branches || {};

  // WhatsApp message template
  const whatsappMessage = `*Invoice from Incline Fitness*

Dear ${memberName},

Your invoice #${invoice.invoice_number} is ready. PDF attached.

📋 *Invoice Details*
Amount: ₹${invoice.total_amount.toLocaleString()}
${invoice.amount_paid ? `Paid: ₹${invoice.amount_paid.toLocaleString()}` : ''}
${invoice.total_amount - (invoice.amount_paid || 0) > 0 ? `Balance Due: ₹${(invoice.total_amount - (invoice.amount_paid || 0)).toLocaleString()}` : '✅ Paid in Full'}
Date: ${format(new Date(invoice.created_at), 'dd MMM yyyy')}

Thank you for your business!
Team Incline Fitness`;

  // SMS message template
  const smsMessage = `Incline Fitness: Invoice #${invoice.invoice_number} for ₹${invoice.total_amount.toLocaleString()}. ${invoice.total_amount - (invoice.amount_paid || 0) > 0 ? `Due: ₹${(invoice.total_amount - (invoice.amount_paid || 0)).toLocaleString()}` : 'Paid'}. Thank you!`;

  // Email template — branded HTML wrapped by send-email's `use_branded_template`.
  const emailSubject = `Invoice #${invoice.invoice_number} from Incline Fitness`;
  const balance = invoice.total_amount - (invoice.amount_paid || 0);
  const statusBadge = balance > 0
    ? `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#3a2a08;color:#FFD466;font-weight:600;font-size:12px;">Balance Due ₹${balance.toLocaleString()}</span>`
    : `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#0e3a23;color:#7CE0A8;font-weight:600;font-size:12px;">Paid in Full</span>`;
  const emailBody = `
    <h2 style="margin:0 0 8px;">Hi ${memberName},</h2>
    <p>Thank you for your payment. Your invoice details are below — the full PDF is attached for your records.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border-collapse:separate;border-spacing:0;background:#0a0a0a;border:1px solid #ffffff15;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:14px 18px;border-bottom:1px solid #ffffff10;">
        <div style="font-size:11px;letter-spacing:2px;color:#EAB30880;text-transform:uppercase;">Invoice</div>
        <div style="font-size:18px;font-weight:700;color:#fff;margin-top:2px;">#${invoice.invoice_number}</div>
      </td></tr>
      <tr><td style="padding:14px 18px;color:#fff;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="color:#ffffff80;">Date</span><strong>${format(new Date(invoice.created_at), 'dd MMMM yyyy')}</strong></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="color:#ffffff80;">Amount</span><strong>₹${invoice.total_amount.toLocaleString()}</strong></div>
        ${invoice.amount_paid ? `<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="color:#ffffff80;">Amount Paid</span><strong>₹${invoice.amount_paid.toLocaleString()}</strong></div>` : ''}
        <div style="margin-top:10px;">${statusBadge}</div>
      </td></tr>
    </table>
    <p style="color:#ffffffaa;">If you have any questions about this invoice, just reply to this email — we're here to help.</p>
    <p style="margin-top:18px;">Warm regards,<br><strong>Team Incline Fitness</strong></p>`;

  // PDF generation is centralised in `generateInvoicePdfBlob` so the WhatsApp /
  // Email attachments are byte-identical to the Drawer download and the
  // Invoices list download — single source of truth for branding + benefits.

  /** Build a `{{var}}` context for invoice templates. */
  const buildTemplateVars = () => ({
    member_name: memberName,
    member_code: (invoice.members as any)?.member_code || '',
    invoice_number: invoice.invoice_number,
    amount: Number(invoice.total_amount || 0).toLocaleString(),
    date: format(new Date(invoice.created_at), 'dd MMM yyyy'),
    branch_name: branch.name || 'Incline Fitness',
  });

  const handleWhatsAppShare = async () => {
    if (!invoice.branch_id) {
      toast.error('Branch context missing — cannot send via WhatsApp');
      return;
    }
    setSendingWhatsApp(true);
    try {
      // Prefer saved WhatsApp Invoice template; fall back to hardcoded copy.
      const tpl = await findTemplate({
        branchId: invoice.branch_id,
        type: 'whatsapp',
        triggerEvent: 'payment_received',
        nameContains: 'Invoice',
      });
      const vars = buildTemplateVars();
      const resolved = resolveTemplate(tpl, vars, {
        body: whatsappMessage,
        filename: `Invoice-${invoice.invoice_number}.pdf`,
      });

      const pdf = await generateInvoicePdfBlob(invoice);
      const result = await sendWhatsAppDocument({
        branchId: invoice.branch_id,
        phone,
        memberId: invoice.member_id,
        caption: resolved.body,
        filename: resolved.filename || `Invoice-${invoice.invoice_number}.pdf`,
        pdf,
        folder: 'invoices',
        dedupeKey: `invoice:${invoice.id}:wa`,
        category: 'payment_receipt',
      });
      if (result.status === 'failed' || result.status === 'suppressed') {
        throw new Error(result.status === 'suppressed' ? 'WhatsApp send was suppressed by preferences' : 'WhatsApp failed to send the PDF');
      }
      if (result.status === 'deduped') {
        toast.info('This invoice was already sent on WhatsApp.');
      } else {
        toast.success('Invoice PDF sent via WhatsApp');
      }
      onOpenChange(false);
    } catch (err: any) {
      console.error('Invoice WhatsApp share failed:', err);
      toast.error(err?.message || 'Failed to send invoice');
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const handleEmailShare = async () => {
    setSendingEmail(true);
    try {
      const tpl = invoice.branch_id ? await findTemplate({
        branchId: invoice.branch_id,
        type: 'email',
        triggerEvent: 'payment_received',
        nameContains: 'Invoice',
      }) : null;
      const vars = buildTemplateVars();
      const resolved = resolveTemplate(tpl, vars, {
        body: emailBody,
        subject: emailSubject,
        filename: `Invoice-${invoice.invoice_number}.pdf`,
      });

      const pdf = await generateInvoicePdfBlob(invoice);
      if (pdf.size < 1024) {
        throw new Error('Generated PDF is empty or corrupted — refresh and try again');
      }
      const filename = resolved.filename || `Invoice-${invoice.invoice_number}.pdf`;
      const { url } = await uploadAttachment(pdf, {
        folder: 'invoices',
        filename,
        contentType: 'application/pdf',
      });

      const result = await dispatchCommunication({
        branch_id: invoice.branch_id,
        channel: 'email',
        category: 'payment_receipt',
        recipient: email,
        member_id: invoice.member_id ?? null,
        payload: {
          subject: resolved.subject || emailSubject,
          body: resolved.body,
          use_branded_template: true,
        },
        dedupe_key: buildDedupeKey(['invoice', invoice.id, 'email']),
        force: true, // payment receipts always go out
        attachment: {
          url,
          filename,
          content_type: 'application/pdf',
          kind: 'document',
        },
      });
      if (result.status === 'failed') throw new Error(result.reason || 'send_failed');
      toast.success('Invoice email sent with PDF attached');
      onOpenChange(false);
    } catch (err: any) {
      console.error('Invoice email share failed:', err);
      toast.error(err?.message || 'Failed to send email');
    } finally {
      setSendingEmail(false);
    }
  };


  const handleSMSShare = async () => {
    await communicationService.sendSMS(phone, smsMessage, {
      branchId: invoice.branch_id,
      memberId: invoice.member_id,
    });
    toast.success('Opening SMS...');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(whatsappMessage);
    toast.success('Invoice details copied to clipboard!');
  };

  const handlePrint = () => {
    // Open print dialog
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow pop-ups to print');
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice ${invoice.invoice_number}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
          .header h1 { margin: 0; color: #333; }
          .header p { margin: 5px 0; color: #666; }
          .invoice-info { display: flex; justify-content: space-between; margin-bottom: 30px; }
          .invoice-info div { flex: 1; }
          .invoice-info h3 { margin: 0 0 10px 0; color: #333; font-size: 14px; }
          .invoice-info p { margin: 3px 0; color: #666; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f5f5f5; font-weight: 600; }
          .totals { text-align: right; }
          .totals p { margin: 5px 0; }
          .totals .total { font-size: 18px; font-weight: bold; color: #333; }
          .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
          .status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; }
          .status.paid { background: #d4edda; color: #155724; }
          .status.pending { background: #fff3cd; color: #856404; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>INCLINE FITNESS</h1>
          <p>Tax Invoice</p>
        </div>
        
        <div class="invoice-info">
          <div>
            <h3>Bill To:</h3>
            <p><strong>${e(memberName)}</strong></p>
            <p>${e(guestEmail || '')}</p>
            <p>${e(guestPhone || '')}</p>
          </div>
          <div style="text-align: right;">
            <h3>Invoice Details:</h3>
            <p><strong>${e(invoice.invoice_number)}</strong></p>
            <p>Date: ${format(new Date(invoice.created_at), 'dd MMM yyyy')}</p>
            <p>
              <span class="status ${invoice.status === 'paid' ? 'paid' : 'pending'}">
                ${e(String(invoice.status).toUpperCase())}
              </span>
            </p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${invoice.invoice_items?.map((item: any) => `
              <tr>
                <td>${e(item.description)}</td>
                <td>${item.quantity || 1}</td>
                <td>₹${item.unit_price.toLocaleString()}</td>
                <td>₹${item.total_amount.toLocaleString()}</td>
              </tr>
            `).join('') || '<tr><td colspan="4">No items</td></tr>'}
          </tbody>
        </table>

        <div class="totals">
          <p>Subtotal: ₹${invoice.subtotal.toLocaleString()}</p>
          ${invoice.discount_amount ? `<p>Discount: -₹${invoice.discount_amount.toLocaleString()}</p>` : ''}
          ${invoice.tax_amount ? `<p>Tax: ₹${invoice.tax_amount.toLocaleString()}</p>` : ''}
          <p class="total">Total: ₹${invoice.total_amount.toLocaleString()}</p>
          ${invoice.amount_paid ? `<p style="color: green;">Paid: ₹${invoice.amount_paid.toLocaleString()}</p>` : ''}
          ${invoice.total_amount - (invoice.amount_paid || 0) > 0 ? `<p style="color: red;">Balance Due: ₹${(invoice.total_amount - (invoice.amount_paid || 0)).toLocaleString()}</p>` : ''}
        </div>

        <div class="footer">
          <p>Thank you for your business!</p>
          <p>Incline Fitness | Contact us for any queries</p>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Share Invoice</SheetTitle>
          <SheetDescription>
            Send invoice #{invoice.invoice_number} to customer
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Invoice Summary */}
          <Card className="bg-muted/30">
            <CardContent className="pt-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-mono text-sm">{invoice.invoice_number}</p>
                  <p className="text-lg font-bold">₹{invoice.total_amount.toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">{memberName}</p>
                  <p className={`text-sm font-medium ${invoice.status === 'paid' ? 'text-success' : 'text-warning'}`}>
                    {invoice.status.toUpperCase()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contact Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <PhoneInput
                value={phone}
                onChange={(value) => setPhone(value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
              />
            </div>
          </div>

          {/* Share Options */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Share via</p>
            
            <Button 
              className="w-full justify-start gap-3 bg-success hover:bg-success"
              onClick={handleWhatsAppShare}
              disabled={!phone || sendingWhatsApp}
            >
              <MessageCircle className="h-5 w-5" />
              {sendingWhatsApp ? 'Generating PDF & sending…' : 'Send PDF via WhatsApp'}
            </Button>

            <Button 
              variant="outline"
              className="w-full justify-start gap-3"
              onClick={handleEmailShare}
              disabled={!email || sendingEmail}
            >
              <Mail className="h-5 w-5" />
              {sendingEmail ? 'Generating PDF & sending…' : 'Send PDF via Email'}
            </Button>

            <Button 
              variant="outline"
              className="w-full justify-start gap-3"
              onClick={handleSMSShare}
              disabled={!phone}
            >
              <Phone className="h-5 w-5" />
              Send via SMS
            </Button>

            <div className="border-t pt-3 mt-3 space-y-3">
              <Button 
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={handleCopyLink}
              >
                <Copy className="h-5 w-5" />
                Copy Invoice Details
              </Button>

              <Button 
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={handlePrint}
              >
                <Printer className="h-5 w-5" />
                Print Invoice
              </Button>
            </div>
          </div>

          {/* WhatsApp Preview */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Message Preview</p>
            <Textarea
              value={whatsappMessage}
              readOnly
              rows={8}
              className="text-xs font-mono bg-muted/30"
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
