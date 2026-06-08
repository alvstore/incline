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

export default function TermsPage() {
  const [theme, setTheme] = useState<ThemeSettings>(cmsService.getDefaultTheme());

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setTheme(cmsService.getTheme());
    cmsService.getThemeAsync().then(dbTheme => setTheme(dbTheme)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-primary-foreground">
      <SEO
        title="Terms of Service | The Incline Life by Incline"
        description="The terms governing membership, payments, and use of The Incline Life facilities and services."
        path="/terms"
      />
      <header className="border-b border-primary-foreground/10 bg-[#050508]/90 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-primary-foreground/90 hover:text-primary-foreground transition-colors">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-warning to-destructive flex items-center justify-center">
              <Dumbbell className="h-5 w-5" />
            </div>
            <span className="font-bold">Back to Home</span>
          </Link>
          <Link to="/privacy-policy" className="text-sm text-warning hover:text-warning transition-colors">
            View Privacy Policy
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8">
        <div className="space-y-4">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Terms and Conditions</h1>
          <p className="text-primary-foreground/60">Last updated: {LAST_UPDATED}</p>
          <p className="text-primary-foreground/70 text-sm sm:text-base leading-relaxed">
            These Terms govern use of our website, platform, member services, and communication channels.
            By using the services, you agree to these Terms.
          </p>
          <p className="text-primary-foreground/70 text-sm sm:text-base leading-relaxed">
            These Terms are issued by {theme.gymName} and apply across its authorized branch operations.
          </p>
        </div>

        <Section title="1. Use of Service">
          <ul className="list-disc pl-5 space-y-2">
            <li>You must provide accurate information during registration and ongoing account use.</li>
            <li>You are responsible for activity performed through your account credentials.</li>
            <li>You agree not to misuse the platform, interfere with operations, or attempt unauthorized access.</li>
          </ul>
        </Section>

        <Section title="2. Membership, Facility Rules &amp; Code of Conduct">
          <ul className="list-disc pl-5 space-y-2">
            <li>Membership plans, durations, and benefits are defined by the selected branch and plan terms.</li>
            <li>Fees may be non-refundable and non-transferable unless explicitly stated otherwise.</li>
            <li>Members must follow safety instructions, facility rules, hygiene protocols, and staff guidance at all times.</li>
            <li>Appropriate gym attire and footwear are required; equipment must be returned to its designated place after use.</li>
            <li>Aggressive, abusive, or disruptive behaviour toward staff or other members will result in immediate termination of membership without refund.</li>
            <li>Photography or recording inside the facility (including locker rooms, sauna, and recovery areas) is strictly prohibited without prior written consent.</li>
            <li>
              You confirm you are medically fit to participate in physical activity and must disclose relevant
              health risks, injuries, or conditions to staff before training.
            </li>
          </ul>
        </Section>

        <Section title="3. Payments, Invoices, GST &amp; Billing">
          <ul className="list-disc pl-5 space-y-2">
            <li>Payments may be processed through Razorpay or other approved manual methods (cash / UPI / card swipe).</li>
            <li>You authorise processing of payment details for invoice settlement and verification.</li>
            <li>
              All membership services, personal training packages, and ancillary services are subject to applicable
              <strong> Goods and Services Tax (GST) at 5%</strong> as per Indian tax regulations, unless a different rate
              is mandated by law for a specific service category.
            </li>
            <li>GST-compliant tax invoices are issued for every paid transaction and retained for the period required by Indian tax law.</li>
            <li>Payment failures, reversals, gateway downtime, or bank delays may impact confirmation timing.</li>
          </ul>
        </Section>

        <Section title="3a. Assumption of Risk &amp; Liability Waiver">
          <p>
            You acknowledge that participation in physical exercise and use of facility amenities carries inherent risk
            of injury, illness, or in rare cases serious harm.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>You voluntarily assume all risk associated with use of free weights, machines, cardio equipment, and heavy strength-training apparatus.</li>
            <li>
              You acknowledge the specific risks of recovery facilities including <strong>infrared saunas</strong>
              (heat stress, dehydration, cardiovascular strain) and <strong>ice baths / cold plunge</strong>
              (cold shock response, blood pressure changes, hypothermia risk).
            </li>
            <li>
              Group classes, personal training, HIIT sessions, and functional training carry risk of strain, sprain,
              or musculoskeletal injury.
            </li>
            <li>
              You confirm you have no medical condition (cardiac, pulmonary, neurological, pregnancy-related, or other)
              that contraindicates use of these facilities, or that you have obtained medical clearance.
            </li>
            <li>
              To the maximum extent permitted by law, you release {theme.gymName} and its staff from liability for injury,
              loss, or damage arising from your voluntary use of the facility, except where caused by gross negligence.
            </li>
          </ul>
        </Section>

        <Section title="4. WhatsApp, Instagram, Email &amp; SMS Communications">
          <p>
            By sharing contact details and opting in where required, you agree to receive service communication
            through channels such as WhatsApp, Instagram Direct, email, and SMS.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>WhatsApp messaging is powered by Meta WhatsApp Cloud API.</li>
            <li>Instagram Direct messaging is powered by the Meta Instagram Graph API and is used only to reply to conversations you initiate with our business profile.</li>
            <li>Service communications may include reminders, booking updates, payment notices, and support messages.</li>
            <li>Promotional messages are sent only where consent or lawful basis exists.</li>
            <li>
              You can request opt-out from promotional communication by replying STOP or by contacting your branch;
              transactional notices may still be sent when necessary.
            </li>
          </ul>
        </Section>

        <Section title="5. Data, Privacy, and Records">
          <p>
            Your use of the service is also subject to our Privacy Policy, which describes data handling and your rights.
            Uploaded forms, signatures, communication logs, member evidence records, and audit events may be retained for compliance,
            internal audit controls, and operations, in line with local legal guidelines.
          </p>
          <p>
            We do not sell, rent, or trade personal data to third parties. Member image files and related media are stored on our own managed servers.
          </p>
        </Section>

        <Section title="6. AI and Informational Features">
          <p>
            AI-enabled insights, suggestions, and automated replies are informational tools and do not constitute
            medical advice or guaranteed outcomes.
          </p>
          <p>
            Consult qualified professionals before making health, nutrition, or treatment decisions.
          </p>
        </Section>

        <Section title="7. Suspension or Termination">
          <ul className="list-disc pl-5 space-y-2">
            <li>We may suspend or terminate access for policy violations, abuse, non-payment, fraud, or legal reasons.</li>
            <li>Termination does not waive obligations already accrued (including outstanding dues where applicable).</li>
          </ul>
        </Section>

        <Section title="8. Limitation of Liability">
          <p>
            To the maximum extent permitted by law, we are not liable for indirect, incidental, special, or consequential damages,
            including interruption, data loss, or third-party service outages.
          </p>
        </Section>

        <Section title="9. Governing Law and Disputes">
          <p>
            These Terms are governed by and construed in accordance with the laws of <strong>India</strong>.
            All disputes, claims, or proceedings arising out of or in connection with these Terms or the use of our services
            shall be subject to the exclusive jurisdiction of the competent courts located in
            <strong> Udaipur, Rajasthan, India</strong>.
          </p>
        </Section>

        <Section title="10. Updates to Terms">
          <p>
            We may update these Terms from time to time. Continued use after updates means you accept the revised Terms.
          </p>
        </Section>

        <Section title="11. Contact">
          <ul className="list-disc pl-5 space-y-2">
            <li>Entity: {theme.gymName}</li>
            <li>Email: {theme.contactEmail}</li>
            <li>Phone: {theme.contactPhone}</li>
            <li>Address: {theme.address}</li>
          </ul>
        </Section>
      </main>
    </div>
  );
}
