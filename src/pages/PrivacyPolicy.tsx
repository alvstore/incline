import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dumbbell } from 'lucide-react';
import { cmsService, ThemeSettings } from '@/services/cmsService';
import SEO from '@/components/seo/SEO';

const LAST_UPDATED = 'April 1, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-primary-foreground/10 bg-card/[0.03] p-6 sm:p-8">
      <h2 className="text-xl sm:text-2xl font-bold text-primary-foreground mb-4">{title}</h2>
      <div className="space-y-3 text-primary-foreground/70 text-sm sm:text-base leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  const [theme, setTheme] = useState<ThemeSettings>(cmsService.getDefaultTheme());

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setTheme(cmsService.getTheme());
    cmsService.getThemeAsync().then(dbTheme => setTheme(dbTheme)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-primary-foreground">
      <SEO
        title="Privacy Policy | The Incline Life by Incline"
        description="How The Incline Life by Incline collects, uses, and protects your personal information."
        path="/privacy-policy"
      />
      <header className="border-b border-primary-foreground/10 bg-[#050508]/90 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-primary-foreground/90 hover:text-primary-foreground transition-colors">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-warning to-destructive flex items-center justify-center">
              <Dumbbell className="h-5 w-5" />
            </div>
            <span className="font-bold">Back to Home</span>
          </Link>
          <Link to="/terms" className="text-sm text-warning hover:text-warning transition-colors">
            View Terms
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8">
        <div className="space-y-4">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Privacy Policy</h1>
          <p className="text-primary-foreground/60">Last updated: {LAST_UPDATED}</p>
          <p className="text-primary-foreground/70 text-sm sm:text-base leading-relaxed">
            This Privacy Policy explains how we collect, use, store, and share personal information when you use our public website,
            premium fitness CRM platform, member portals, recovery facilities, and communication tools, including
            Meta WhatsApp Cloud API and Instagram Direct Messaging.
          </p>
          <p className="text-primary-foreground/70 text-sm sm:text-base leading-relaxed">
            This Policy applies to {theme.gymName} and its authorized branch operations.
          </p>
        </div>

        <Section title="1. Information We Collect">
          <p>We collect information you provide directly, such as:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Lead form data: full name, phone number, email (optional), source.</li>
            <li>Membership data: contact details, date of birth, gender, address, emergency contact, plan details.</li>
            <li>Fitness and health declarations: fitness goals, medical conditions, workout preferences.</li>
            <li>
              Biometric and body composition data: 3D body scans, body measurements, posture analysis,
              progress photographs, and InBody / HOWBODY style health metrics captured at our facility.
            </li>
            <li>Identity and compliance records: government ID details, digitally signed forms, uploaded documents.</li>
            <li>
              Communication content: messages, attachments, and conversation history exchanged via email, SMS,
              WhatsApp (Meta WhatsApp Cloud API), and Instagram Direct Messaging (Meta Graph API).
            </li>
            <li>Payment and billing data: invoice details, transaction references, payment status, method, and amount paid.</li>
          </ul>
          <p>
            We also process system data such as login records, role-based access details, branch context, audit logs, and feature usage events.
          </p>
        </Section>

        <Section title="2. How We Use Your Information">
          <p>
            Your data is used strictly for internal facility management and member servicing.
            We do <strong>not</strong> sell, rent, or share personal data with data brokers, advertising networks, or any third party
            for their independent marketing purposes.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>To manage memberships, attendance, classes, personal training, recovery sessions, invoices, and branch operations.</li>
            <li>To generate AI-assisted personalised diet, workout, and recovery plans tailored to your goals and biometric data.</li>
            <li>To communicate with leads and members about onboarding, reminders, services, and customer support.</li>
            <li>To process and verify payments securely via Razorpay (PCI-DSS compliant gateway).</li>
            <li>To generate documents, maintain records, and improve platform performance and safety.</li>
            <li>To detect misuse, secure accounts, and comply with legal or regulatory requirements.</li>
          </ul>
        </Section>

        <Section title="3. WhatsApp and Instagram (Meta Platforms)">
          <p>
            We use Meta WhatsApp Cloud API and Meta Instagram Graph API to send and receive branch-level
            communications with leads and members who have initiated contact with us.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              We process phone numbers, Instagram-scoped user IDs, profile names, message content, attachments,
              status metadata, and timestamps received via Meta webhooks.
            </li>
            <li>Incoming webhook events are used to store conversation threads and delivery/read status updates inside our CRM.</li>
            <li>Messages may include service updates, reminders, booking confirmations, payment notices, and support replies.</li>
            <li>
              Message content received from Meta is used solely for conversation continuity and customer support.
              It is never used to train external AI models, never sold, and never shared with third-party advertisers.
            </li>
            <li>
              You may opt out of promotional WhatsApp / Instagram communication at any time by replying STOP or by contacting
              the branch directly and requesting removal from campaigns.
            </li>
          </ul>
        </Section>

        <Section title="3a. Biometric Data &amp; 3D Body Scans">
          <p>
            With your explicit consent, our facility may capture 3D body scans, body composition reports,
            posture analysis, and progress photographs using on-premise scanning equipment.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Biometric data is used exclusively for personal progress tracking, trainer guidance, and AI-assisted plan generation for you.</li>
            <li>This data is stored on our managed infrastructure with role-based access restricted to you and authorised staff.</li>
            <li>Biometric data is never sold, never used for identification of unrelated individuals, and never shared with advertisers.</li>
            <li>You may request deletion of your biometric records at any time, subject to applicable legal retention requirements.</li>
          </ul>
        </Section>

        <Section title="4. Legal Bases and Consent">
          <p>Depending on your location and use case, we process data under one or more of these bases:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Performance of a contract (membership, service delivery, and billing).</li>
            <li>Legitimate interests (operations, service quality, fraud prevention, and security).</li>
            <li>Consent (marketing, optional communication channels, and certain health declarations).</li>
            <li>Legal obligations (tax, accounting, law-enforcement requests, and compliance reporting).</li>
          </ul>
        </Section>

        <Section title="5. Data Sharing &amp; Third-Party Processors">
          <p>We share information only with the following trusted processors strictly to operate the service:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Cloud database, storage, and authentication infrastructure providers.</li>
            <li>
              <strong>Razorpay</strong> — for secure processing and verification of online payments
              (PCI-DSS Level 1 compliant payment gateway based in India).
            </li>
            <li>
              <strong>Meta Platforms, Inc.</strong> — WhatsApp Cloud API and Instagram Graph API
              for transporting messages and delivering webhook events.
            </li>
            <li>SMS, email, and document storage infrastructure providers used for transactional notifications.</li>
          </ul>
          <p>
            We do <strong>not</strong> sell, rent, or trade personal data to third parties.
            We do not share data with data brokers, ad networks, or any party for independent marketing.
          </p>
        </Section>

        <Section title="6. Data Retention and Security">
          <ul className="list-disc pl-5 space-y-2">
            <li>We retain records for operational, internal audit, legal, tax, and dispute-resolution requirements.</li>
            <li>Member records, invoices, communication logs, audit logs, signed forms, and related evidence may be retained according to local guidelines and mandatory retention timelines.</li>
            <li>Retention periods vary by data type and regulatory requirement, and deletion is applied only where legally permitted.</li>
            <li>Access controls, role-based permissions, and monitoring are used to protect data.</li>
            <li>No internet transmission or storage is 100% secure, but we apply reasonable safeguards.</li>
          </ul>
        </Section>

        <Section title="7. Image and File Storage">
          <ul className="list-disc pl-5 space-y-2">
            <li>Member images and uploaded files are stored on our own managed servers and storage infrastructure.</li>
            <li>These files are used strictly for operations, member servicing, verification, and internal audit purposes.</li>
            <li>Access is restricted to authorized personnel and controlled by role-based permissions.</li>
          </ul>
        </Section>

        <Section title="8. Your Rights">
          <p>Subject to applicable law, you may request access, correction, deletion, restriction, portability, or objection.</p>
          <p>
            To make a request, contact your branch or support team with enough information to verify your identity.
            We may retain certain records when required by law, local guidelines, internal audit controls, or legitimate business needs.
          </p>
        </Section>

        <Section title="9. Children">
          <p>
            Our services are not intended for children below the minimum legal age applicable in your jurisdiction
            without parent or guardian authorization.
          </p>
        </Section>

        <Section title="10. Policy Updates">
          <p>
            We may update this Privacy Policy to reflect product, legal, or operational changes. Updates will be posted on this page
            with a revised "Last updated" date.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>For privacy requests, WhatsApp consent updates, internal-audit data requests, or complaints, contact:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Entity: {theme.gymName}</li>
            <li>Email: {theme.contactEmail}</li>
            <li>Phone: {theme.contactPhone}</li>
            <li>Address: {theme.address}</li>
          </ul>
          <p>
            We handle requests in line with applicable local guidelines, regulatory obligations, and internal audit controls.
          </p>
        </Section>
      </main>
    </div>
  );
}
