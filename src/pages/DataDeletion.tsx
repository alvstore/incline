import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, ShieldX } from "lucide-react";
import { toast } from "sonner";
import SEO from "@/components/seo/SEO";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export default function DataDeletion() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Data Deletion Request — The Incline Life by Incline";
    const meta = document.querySelector('meta[name="description"]') || (() => {
      const m = document.createElement("meta");
      m.setAttribute("name", "description");
      document.head.appendChild(m);
      return m;
    })();
    meta.setAttribute(
      "content",
      "Request deletion of your personal data from The Incline Life by Incline.",
    );
  }, []);

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

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
        <SEO
          title="Data Deletion Request | The Incline Life by Incline"
          description="Request deletion of your personal data from The Incline Life by Incline."
          path="/data-deletion"
        />
        <Card className="w-full max-w-xl rounded-2xl shadow-lg shadow-slate-200/60 border-0">
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-xl bg-rose-100 flex items-center justify-center">
                <ShieldX className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <CardTitle>Data Deletion Request</CardTitle>
                <CardDescription>
                  Permanently remove your data from The Incline Life by Incline
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {confirmation ? (
              <div className="text-center py-8 space-y-3">
                <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
                <h2 className="text-lg font-semibold text-slate-900">Request received</h2>
                <p className="text-sm text-slate-600">
                  Your deletion request is being processed. We will email confirmation to{" "}
                  <b>{email}</b> within 30 days.
                </p>
                <div className="text-xs text-slate-500 mt-4">
                  Confirmation code:{" "}
                  <code className="bg-slate-100 px-2 py-1 rounded font-mono">{confirmation}</code>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-slate-600">
                  Submit this form to request permanent deletion of your member profile, attendance
                  history, payment records (where legally permitted), and connected social
                  accounts (Instagram / Facebook / WhatsApp) from our system.
                </p>
                <p className="text-xs text-slate-500">
                  Some financial records (invoices, GST filings) are retained for the period
                  required by Indian tax law.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email associated with your account *</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reason">Reason (optional)</Label>
                  <Textarea
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Help us improve — why are you leaving?"
                    rows={3}
                    maxLength={500}
                  />
                </div>
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? "Submitting…" : "Submit deletion request"}
                </Button>
                <p className="text-xs text-slate-500 text-center">
                  Questions? Email{" "}
                  <a href="mailto:privacy@theinclinelife.com" className="text-indigo-600 font-medium">
                    privacy@theinclinelife.com
                  </a>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
  );
}
