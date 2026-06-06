import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { LiquidButton } from "@/components/ui/liquid-button";
import { GlassCard } from "@/components/registration/GlassCard";
import { StepDots } from "@/components/registration/StepDots";
import { SignaturePad, type SignaturePadHandle } from "@/components/registration/SignaturePad";
import { toast } from "sonner";
import {
  Loader2, ShieldCheck, ArrowRight, ArrowLeft,
  Sparkles, RefreshCw, ChevronDown, MapPin, Check,
} from "lucide-react";
import heroImage from "@/assets/registration-hero-v2.jpg";
import inclineLogo from "@/assets/incline-logo.png";
import { cn } from "@/lib/utils";

import SEO from "@/components/seo/SEO";
import {
  PARQ_QUESTIONS,
  PRIMARY_GOALS,
  MORE_GOALS,
  HEALTH_CONDITION_OPTIONS,
} from "@/lib/registration/healthQuestions";

const detailsSchema = z.object({
  full_name: z.string().trim().min(2, "Full name required").max(120),
  phone: z.string().regex(/^\+91\d{10}$/, "Enter a valid +91 number"),
  email: z.string().email("Valid email required"),
  date_of_birth: z.string().min(1, "DOB required"),
  gender: z.enum(["male", "female", "other"]),
  branch_id: z.string().uuid("Select a branch"),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  address: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  fitness_goals: z.string().optional(),
  health_conditions: z.string().optional(),
  health_conditions_other: z.string().optional(),
});
type DetailsForm = z.infer<typeof detailsSchema>;

const STEPS = ["Profile", "Health", "Sign", "Verify"] as const;

// Dark glass form input styles
const fieldInputCls =
  "h-11 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:border-primary/60";
const fieldSelectCls =
  "h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none [&>option]:text-slate-900";

export default function PublicRegistration() {
  const nav = useNavigate();
  const [step, setStep] = useState<"details" | "parq" | "sign" | "otp" | "done">("details");
  const [details, setDetails] = useState<DetailsForm | null>(null);
  const [parq, setParq] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState({ dpdp: false, whatsapp: false, photo: false, waiver: false });
  const [signatureUrl, setSignatureUrl] = useState<string>("");
  const [otp, setOtp] = useState("");
  const [healthConditions, setHealthConditions] = useState<string[]>([]);
  const [healthOther, setHealthOther] = useState("");
  const [showMoreGoals, setShowMoreGoals] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  const { data: branches } = useQuery({
    queryKey: ["public-branches"],
    queryFn: async () => {
      // Calls SECURITY DEFINER RPC that returns only non-sensitive columns to anon users.
      const { data, error } = await supabase.rpc("get_public_branches");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; city: string | null }>;
    },
  });

  const form = useForm<DetailsForm>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { gender: "male" as const, phone: "+91" } as Partial<DetailsForm> as DetailsForm,
  });

  const selectedGoal = form.watch("fitness_goals");

  const sendOtp = useMutation({
    mutationFn: async (phone: string) => {
      const { data, error } = await supabase.functions.invoke("register-member", {
        body: { mode: "send_otp", phone, email: details?.email ?? null },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.status === "already_member") throw new Error("This number is already registered. Please log in.");
      return data as { channels?: string[] };
    },
    onSuccess: (data) => {
      const ch = data?.channels?.includes("email") ? "WhatsApp & email" : "WhatsApp";
      toast.success(`OTP sent on ${ch}`);
      setStep("otp");
    },
    onError: (e: Error) => toast.error(`OTP send failed — ${e.message}. Tap Resend.`),
  });

  const verifyAndRegister = useMutation({
    mutationFn: async () => {
      if (!details) throw new Error("Missing details");
      const { data, error } = await supabase.functions.invoke("register-member", {
        body: {
          mode: "verify_and_register",
          phone: details.phone,
          code: otp,
          registration: details,
          par_q: parq,
          consents,
          signature_data_url: signatureUrl,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { access_token: string; refresh_token: string; member_code: string };
    },
    onSuccess: async (data) => {
      if (data.access_token && data.refresh_token) {
        await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      }
      toast.success(`Welcome to Incline! Your member code: ${data.member_code}`);
      setStep("done");
      setTimeout(() => nav("/member"), 1500);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitDetails = form.handleSubmit((values) => {
    const conditions = [...healthConditions];
    if (conditions.includes("Other") && healthOther.trim()) {
      const idx = conditions.indexOf("Other");
      conditions[idx] = `Other: ${healthOther.trim()}`;
    } else if (conditions.includes("Other") && !healthOther.trim()) {
      conditions.splice(conditions.indexOf("Other"), 1);
    }
    const merged: DetailsForm = { ...values, health_conditions: conditions.join(", ") || undefined };
    setDetails(merged);
    setStep("parq");
  });

  const submitParq = () => {
    const map: Record<string, string> = {};
    PARQ_QUESTIONS.forEach((q, i) => { map[q] = parq[`q${i}`] || "no"; });
    setParq(map);
    setStep("sign");
  };

  const submitSign = () => {
    if (sigRef.current?.isEmpty()) return toast.error("Please sign before continuing");
    if (!consents.dpdp || !consents.whatsapp || !consents.waiver) return toast.error("All required consents must be accepted");
    setSignatureUrl(sigRef.current!.toDataURL());
    sendOtp.mutate(details!.phone);
  };

  const stepIdx = useMemo(
    () => Math.min({ details: 0, parq: 1, sign: 2, otp: 3, done: 3 }[step], 3),
    [step]
  );

  return (
    <div
      className="relative min-h-[100dvh] w-full overflow-hidden bg-[#08060f] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <SEO
        title="Become a Member | The Incline Life Udaipur"
        description="Join Udaipur's premium 24/7 fitness & recovery club. Quick OTP signup, digital health waiver and instant access to memberships, classes and recovery facilities."
        path="/register"
      />
      {/* Hero background */}
      <div className="pointer-events-none absolute inset-0">
        <img
          src={heroImage}
          alt=""
          className="h-full w-full object-cover opacity-60"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#08060f]/40 via-[#08060f]/70 to-[#08060f]" />
        <div className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-violet-600/30 blur-[140px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col px-4 pb-10 pt-6 sm:px-6 sm:pt-10">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-white/10 p-1.5 backdrop-blur-md ring-1 ring-white/15">
              <img src={inclineLogo} alt="The Incline Life" className="h-9 w-9 object-contain" />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight">The Incline Life</h1>
              <p className="text-[10px] text-white/60">Member registration</p>
            </div>
          </div>

          <div className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur-md">
            Step {Math.min(stepIdx + 1, 4)} of 4
          </div>
        </header>

        {/* Headline */}
        <div className="mt-8 sm:mt-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-primary/90">Welcome</p>
          <h2 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
            Your transformation
            <br />
            <span className="bg-gradient-to-r from-primary to-violet-300 bg-clip-text text-transparent">
              starts here.
            </span>
          </h2>
        </div>

        {/* Glass card */}
        <GlassCard className="mt-8 flex-1 p-5 sm:mt-10 sm:p-7">
          <div className="mb-6 flex items-center justify-between">
            <StepDots total={4} current={stepIdx} labels={[...STEPS]} />
            <span className="text-xs font-medium text-white/60">{STEPS[stepIdx]}</span>
          </div>

          {step === "details" && (
            <form onSubmit={submitDetails} className="space-y-5">
              <Field label="Full name" error={form.formState.errors.full_name?.message}>
                <Input className={fieldInputCls} placeholder="Your name" {...form.register("full_name")} />
              </Field>

              <Field label="Phone (WhatsApp)" error={form.formState.errors.phone?.message}>
                <PhoneInput
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/40"
                  value={form.watch("phone")}
                  onChange={(v) => form.setValue("phone", v ? `+91${v}` : "", { shouldValidate: true })}
                />
              </Field>

              <Field label="Email" error={form.formState.errors.email?.message}>
                <Input type="email" className={fieldInputCls} placeholder="you@example.com" {...form.register("email")} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Date of birth" error={form.formState.errors.date_of_birth?.message}>
                  <Input type="date" className={fieldInputCls} {...form.register("date_of_birth")} />
                </Field>
                <Field label="Gender">
                  <select className={fieldSelectCls} {...form.register("gender")}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              </div>

              <Field label="Choose your home branch" error={form.formState.errors.branch_id?.message}>
                <select className={fieldSelectCls} {...form.register("branch_id")}>
                  <option value="">Select a branch…</option>
                  {branches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.city ? `— ${b.city}` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="City"><Input className={fieldInputCls} {...form.register("city")} /></Field>
                <Field label="Pincode"><Input className={fieldInputCls} {...form.register("postal_code")} /></Field>
              </div>

              <Field label="Emergency contact name">
                <Input className={fieldInputCls} {...form.register("emergency_contact_name")} />
              </Field>
              <Field label="Emergency contact phone">
                <Input className={fieldInputCls} {...form.register("emergency_contact_phone")} />
              </Field>

              <Field label="Primary fitness goal (optional)">
                <div className="grid grid-cols-2 gap-2.5">
                  {PRIMARY_GOALS.map((g) => {
                    const Icon = g.icon;
                    const active = selectedGoal === g.key;
                    return (
                      <button
                        type="button"
                        key={g.key}
                        onClick={() => form.setValue("fitness_goals", active ? "" : g.key)}
                        className={`group flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all duration-200 ${
                          active
                            ? "border-primary/60 bg-primary/15 shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]"
                            : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10"
                        }`}
                      >
                        <div className={`rounded-lg p-1.5 ${active ? "bg-primary text-primary-foreground" : "bg-white/10 text-white/70"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className={`text-sm font-medium ${active ? "text-white" : "text-white/80"}`}>{g.key}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setShowMoreGoals((v) => !v)}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMoreGoals ? "rotate-180" : ""}`} />
                  {showMoreGoals ? "Fewer" : "More options"}
                </button>
                {showMoreGoals && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MORE_GOALS.map((g) => {
                      const active = selectedGoal === g;
                      return (
                        <button
                          type="button"
                          key={g}
                          onClick={() => form.setValue("fitness_goals", active ? "" : g)}
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                            active ? "bg-primary text-primary-foreground" : "bg-white/10 text-white/80 hover:bg-white/15"
                          }`}
                        >
                          {g}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>

              <Field label="Any health conditions or injuries? (tap all that apply)">
                <div className="flex flex-wrap gap-2">
                  {HEALTH_CONDITION_OPTIONS.map((opt) => {
                    const checked = healthConditions.includes(opt);
                    return (
                      <button
                        type="button"
                        key={opt}
                        onClick={() =>
                          setHealthConditions((prev) =>
                            checked ? prev.filter((p) => p !== opt) : [...prev, opt]
                          )
                        }
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                          checked
                            ? "bg-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.6)]"
                            : "bg-white/5 text-white/80 ring-1 ring-inset ring-white/10 hover:bg-white/10"
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {healthConditions.includes("Other") && (
                  <Input
                    placeholder="Please specify"
                    value={healthOther}
                    onChange={(e) => setHealthOther(e.target.value)}
                    className={`mt-3 ${fieldInputCls}`}
                  />
                )}
                <p className="mt-2 text-[11px] text-white/50">Confidential — only your trainer sees this.</p>
              </Field>

              <LiquidButton type="submit" size="lg" className="w-full">
                Continue <ArrowRight className="h-4 w-4" />
              </LiquidButton>
            </form>
          )}

          {step === "parq" && (
            <div className="space-y-5">
              <p className="text-sm text-white/70">Quick health check — answer honestly to keep you safe.</p>
              <div className="space-y-3">
                {PARQ_QUESTIONS.map((q, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="mb-3 text-sm font-medium text-white/90">{q}</p>
                    <div className="flex gap-2">
                      {(["no", "yes"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setParq((p) => ({ ...p, [`q${i}`]: v }))}
                          className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                            parq[`q${i}`] === v
                              ? v === "yes"
                                ? "bg-amber-500 text-white shadow-[0_4px_14px_-4px_rgb(245_158_11/0.5)]"
                                : "bg-emerald-500 text-white shadow-[0_4px_14px_-4px_rgb(16_185_129/0.5)]"
                              : "bg-white/5 text-white/70 ring-1 ring-inset ring-white/10 hover:bg-white/10"
                          }`}
                        >
                          {v.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <LiquidButton type="button" variant="glass" size="lg" className="flex-1" onClick={() => setStep("details")}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </LiquidButton>
                <LiquidButton type="button" size="lg" className="flex-1" onClick={submitParq}>
                  Continue <ArrowRight className="h-4 w-4" />
                </LiquidButton>
              </div>
            </div>
          )}

          {step === "sign" && (
            <div className="space-y-5">
              <p className="text-sm text-white/70">Review and sign to continue.</p>
              <div className="max-h-44 overflow-auto rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-white/80">
                I acknowledge that physical exercise involves inherent risk of injury. I voluntarily assume all such risks
                and agree to follow gym rules, trainer instructions, and equipment guidelines. I release The Incline Life
                by Incline, its staff and contractors from liability for any injury, loss, or damage arising from my
                participation, except in cases of gross negligence. I confirm my PAR-Q answers are accurate and I'll seek
                medical clearance if any answer was "Yes".
              </div>

              <div className="space-y-2.5">
                {[
                  { k: "waiver", l: "I accept the assumption of risk and waiver above.", required: true },
                  { k: "dpdp", l: "I consent to processing of my personal data per the DPDP Act, 2023.", required: true },
                  { k: "whatsapp", l: "I agree to receive WhatsApp / SMS updates from Incline.", required: true },
                  { k: "photo", l: "I consent to my photo being used for member identification.", required: false },
                ].map((c) => (
                  <label
                    key={c.k}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/80 transition-colors hover:bg-white/10"
                  >
                    <Checkbox
                      checked={(consents as Record<string, boolean>)[c.k]}
                      onCheckedChange={(v) => setConsents((s) => ({ ...s, [c.k]: !!v }))}
                      className="mt-0.5 border-white/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <span className="leading-snug">
                      {c.l}
                      {c.required && <span className="ml-1 text-red-400">*</span>}
                      {!c.required && <span className="ml-1 text-white/40">(optional)</span>}
                    </span>
                  </label>
                ))}
              </div>

              <div>
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Signature</Label>
                <p className="mb-2 mt-1 flex items-center gap-1.5 text-xs text-white/50">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Sign with Apple Pencil or your finger
                </p>
                <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-white/20">
                  <SignaturePad ref={sigRef} />
                </div>
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                  onClick={() => sigRef.current?.clear()}
                >
                  <RefreshCw className="h-3 w-3" /> Clear & redo
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <LiquidButton type="button" variant="glass" size="lg" className="flex-1" onClick={() => setStep("parq")}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </LiquidButton>
                <LiquidButton type="button" size="lg" className="flex-1" onClick={submitSign} disabled={sendOtp.isPending}>
                  {sendOtp.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send OTP <ArrowRight className="h-4 w-4" />
                </LiquidButton>
              </div>
            </div>
          )}

          {step === "otp" && (
            <div className="space-y-6">
              <p className="text-sm text-white/70">
                We sent a 6-digit code to <span className="font-semibold text-white">{details?.phone}</span> on WhatsApp
                {details?.email ? " & email" : ""}.
              </p>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-14 w-12 rounded-xl border-2 border-white/15 bg-white/5 text-xl font-bold text-white shadow-sm transition-all data-[active=true]:border-primary data-[active=true]:ring-2 data-[active=true]:ring-primary/30"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <LiquidButton
                type="button"
                size="lg"
                className="w-full"
                disabled={otp.length !== 6 || verifyAndRegister.isPending}
                onClick={() => verifyAndRegister.mutate()}
              >
                {verifyAndRegister.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Verify & complete <ArrowRight className="h-4 w-4" />
              </LiquidButton>
              <button
                type="button"
                className="block w-full text-center text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
                onClick={() => sendOtp.mutate(details!.phone)}
                disabled={sendOtp.isPending}
              >
                Resend code
              </button>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-4 py-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-400/40">
                <ShieldCheck className="h-8 w-8 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold">You're in!</h3>
              <p className="text-sm text-white/70">
                Visit reception to activate your plan. Redirecting to your dashboard…
              </p>
            </div>
          )}
        </GlassCard>

        {/* Trust strip */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-white/50">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" /> DPDP-compliant</span>
          <span className="inline-flex items-center gap-1.5"><MapPin className="h-3 w-3" /> {branches?.length ?? 0} branches</span>
          <span>© 2026 The Incline Life by Incline</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {error && <p className="mt-1.5 text-xs font-medium text-red-400">{error}</p>}
    </div>
  );
}
