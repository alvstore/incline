import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Shield, FileText, ShieldX, CheckCircle2, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

const LAST_UPDATED = "April 1, 2026";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ENTITY = "The Incline Life by Incline";
const CONTACT_EMAIL = "privacy@theinclinelife.com";

export type LegalTab = "privacy" | "terms" | "deletion";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-primary/10 bg-card/60 backdrop-blur-sm p-5 sm:p-6 transition-colors hover:border-primary/30">
    <h3 className="text-base sm:text-lg font-bold text-foreground mb-3 flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
      {title}
    </h3>
    <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">{children}</div>
  </section>
);

const PrivacyContent = () => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground leading-relaxed">
      How we collect, use, store, and share personal information across our website, CRM platform, member portals,
      recovery facilities, and communication tools (Meta WhatsApp Cloud API and Instagram Direct Messaging).
    </p>
    <Section title="Information We Collect">
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Lead and membership data: name, phone, email, plan details.</li>
        <li>Fitness & health declarations, medical conditions, goals.</li>
        <li>Biometric data: 3D body scans, body composition, posture, progress photos.</li>
        <li>Identity records, signed forms, uploaded documents.</li>
        <li>Communications via email, SMS, WhatsApp, Instagram DM.</li>
        <li>Payment & billing data via Razorpay (PCI-DSS compliant).</li>
      </ul>
    </Section>
    <Section title="How We Use It">
      <p>
        Strictly for facility management and member servicing. We <strong className="text-foreground">do not</strong> sell, rent,
        or share data with brokers or ad networks.
      </p>
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Manage memberships, attendance, classes, PT, recovery, billing.</li>
        <li>Generate AI-assisted personalised plans tailored to your goals.</li>
        <li>Communicate onboarding, reminders, services, and support.</li>
        <li>Process payments securely and maintain audit records.</li>
      </ul>
    </Section>
    <Section title="WhatsApp & Instagram (Meta)">
      <p>
        We use Meta's APIs to communicate with leads/members who initiate contact. Message content is used solely for
        conversation continuity — never to train external models, never sold, never shared with advertisers.
      </p>
      <p>You may opt out of promotional messages anytime by replying STOP.</p>
    </Section>
    <Section title="Biometric Data & 3D Body Scans">
      <p>
        With your explicit consent, we capture biometric data exclusively for your progress tracking, trainer guidance,
        and AI plan generation. Stored on managed infrastructure with role-based access. Never sold or shared.
      </p>
    </Section>
    <Section title="Data Retention & Security">
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Records retained for operational, audit, legal, and tax requirements.</li>
        <li>Member files stored on our own managed servers and storage.</li>
        <li>Role-based access controls and monitoring applied throughout.</li>
      </ul>
    </Section>
    <Section title="Your Rights">
      <p>
        Subject to applicable law, you may request access, correction, deletion, restriction, portability, or objection.
        Contact your branch with verification details.
      </p>
    </Section>
    <Section title="Contact">
      <ul className="space-y-1.5">
        <li><span className="text-foreground font-medium">Entity:</span> {ENTITY}</li>
        <li><span className="text-foreground font-medium">Email:</span> {CONTACT_EMAIL}</li>
      </ul>
    </Section>
  </div>
);

const TermsContent = () => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground leading-relaxed">
      These Terms govern use of our website, platform, member services, and communication channels.
      Issued by {ENTITY} and applicable across all authorized branches.
    </p>
    <Section title="Use of Service">
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Provide accurate information during registration and ongoing use.</li>
        <li>You are responsible for activity through your account credentials.</li>
        <li>No misuse, interference, or unauthorized access attempts.</li>
      </ul>
    </Section>
    <Section title="Membership, Facility Rules & Code of Conduct">
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Membership terms defined by selected branch and plan.</li>
        <li>Fees may be non-refundable and non-transferable.</li>
        <li>Follow safety, hygiene, and staff guidance at all times.</li>
        <li>Aggressive or disruptive behaviour results in termination without refund.</li>
        <li>No photography in locker rooms, sauna, or recovery areas.</li>
        <li>You confirm fitness for physical activity and disclose health risks.</li>
      </ul>
    </Section>
    <Section title="Payments, GST & Billing">
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Payments via Razorpay or approved manual methods.</li>
        <li>All services subject to <strong className="text-foreground">GST at 5%</strong> per Indian tax law (unless otherwise mandated).</li>
        <li>GST-compliant invoices issued for every paid transaction.</li>
      </ul>
    </Section>
    <Section title="Assumption of Risk & Liability">
      <p>
        Participation in physical exercise carries inherent risk. You voluntarily assume all risk associated with weights,
        machines, group classes, infrared saunas (heat stress), and ice baths (cold shock).
      </p>
      <p>
        To the maximum extent permitted by law, you release {ENTITY} from liability except where caused by gross negligence.
      </p>
    </Section>
    <Section title="Communications">
      <p>
        By sharing contact details and opting in, you agree to receive service messages via WhatsApp, Instagram DM, email,
        and SMS. Promotional messages only with consent. Reply STOP to opt out.
      </p>
    </Section>
    <Section title="AI Features">
      <p>
        AI-enabled insights and automated replies are informational and do not constitute medical advice. Consult qualified
        professionals before making health decisions.
      </p>
    </Section>
    <Section title="Governing Law">
      <p>
        Governed by the laws of <strong className="text-foreground">India</strong>. Disputes subject to the exclusive
        jurisdiction of competent courts in <strong className="text-foreground">Udaipur, Rajasthan, India</strong>.
      </p>
    </Section>
  </div>
);

const DeletionContent = () => {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Please enter the email associated with your account");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/meta-data-deletion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), reason: reason.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Submission failed");
      setConfirmation(data.confirmation_code);
      toast.success("Deletion request received");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmation) {
    return (
      <div className="text-center py-8 space-y-3">
        <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Request received</h3>
        <p className="text-sm text-muted-foreground">
          Your deletion request is being processed. We will email confirmation to{" "}
          <b className="text-foreground">{email}</b> within 30 days.
        </p>
        <div className="text-xs text-muted-foreground mt-4">
          Confirmation code:{" "}
          <code className="bg-muted px-2 py-1 rounded font-mono text-foreground">{confirmation}</code>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 flex gap-3">
        <ShieldX className="h-5 w-5 text-rose-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground leading-relaxed">
          Submit this form to request permanent deletion of your member profile, attendance history, payment records
          (where legally permitted), and connected social accounts (Instagram / Facebook / WhatsApp).
          <p className="text-xs mt-2 text-muted-foreground/80">
            Some financial records (invoices, GST filings) are retained per Indian tax law.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="legal-email" className="text-foreground">Email associated with your account *</Label>
          <Input
            id="legal-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="bg-muted/40 border-border focus:border-primary"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="legal-reason" className="text-foreground">Reason (optional)</Label>
          <Textarea
            id="legal-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Help us improve — why are you leaving?"
            rows={3}
            maxLength={500}
            className="bg-muted/40 border-border focus:border-primary"
          />
        </div>
        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold tracking-wider uppercase shadow-lg shadow-primary/20"
        >
          {submitting ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>) : "Submit deletion request"}
        </Button>
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
          <Mail className="h-3.5 w-3.5" />
          Questions?{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary font-medium hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </form>
    </div>
  );
};

const TAB_META: Record<LegalTab, { label: string; icon: React.ElementType; title: string; desc: string }> = {
  privacy:  { label: "Privacy",  icon: Shield,  title: "Privacy Policy",        desc: `Last updated: ${LAST_UPDATED}` },
  terms:    { label: "Terms",    icon: FileText, title: "Terms of Service",     desc: `Last updated: ${LAST_UPDATED}` },
  deletion: { label: "Deletion", icon: ShieldX,  title: "Data Deletion Request", desc: `Permanently remove your data from ${ENTITY}` },
};

const LegalModal = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<LegalTab>("privacy");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LegalTab>).detail;
      if (detail) setTab(detail);
      setOpen(true);
    };
    window.addEventListener("open-legal-modal", handler);
    return () => window.removeEventListener("open-legal-modal", handler);
  }, []);

  const meta = TAB_META[tab];
  const Icon = meta.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-2xl w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden border border-primary/20 bg-background/95 backdrop-blur-2xl shadow-2xl shadow-primary/10 rounded-3xl"
      >
        {/* Glow accent */}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/15 to-transparent pointer-events-none" />

        <DialogHeader className="relative px-6 pt-6 pb-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center shadow-[inset_0_0_12px_hsl(var(--primary)/0.2)]">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg sm:text-xl font-black tracking-tight text-foreground">
                {meta.title}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {meta.desc}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as LegalTab)} className="flex flex-col">
          <div className="px-6 pt-4">
            <TabsList className="grid w-full grid-cols-3 bg-muted/40 border border-border/50 rounded-xl p-1 h-auto">
              {(Object.keys(TAB_META) as LegalTab[]).map((key) => {
                const T = TAB_META[key].icon;
                return (
                  <TabsTrigger
                    key={key}
                    value={key}
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/30 rounded-lg text-xs sm:text-sm font-semibold tracking-wide flex items-center gap-1.5 py-2"
                  >
                    <T className="h-3.5 w-3.5" />
                    {TAB_META[key].label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <div className="px-6 py-5 max-h-[65vh] overflow-y-auto">
            <TabsContent value="privacy" className="mt-0 focus-visible:outline-none"><PrivacyContent /></TabsContent>
            <TabsContent value="terms" className="mt-0 focus-visible:outline-none"><TermsContent /></TabsContent>
            <TabsContent value="deletion" className="mt-0 focus-visible:outline-none"><DeletionContent /></TabsContent>
          </div>
        </Tabs>

        <div className="px-6 py-3 border-t border-border/50 bg-muted/20">
          <p className="text-[11px] text-muted-foreground/70 text-center tracking-wider">
            © 2026 {ENTITY}. All rights reserved.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LegalModal;
