import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { LiquidButton } from "@/components/ui/liquid-button";
import { GlassCard } from "@/components/registration/GlassCard";
import { StepDots } from "@/components/registration/StepDots";
import { OtpStep } from "@/components/registration/OtpStep";
import { SignaturePad, type SignaturePadHandle } from "@/components/registration/SignaturePad";
import { toast } from "sonner";
import {
  Loader2, ShieldCheck, ArrowRight, ArrowLeft,
  Sparkles, RefreshCw, ChevronDown, MapPin, Check, History,
} from "lucide-react";
import heroImage from "@/assets/registration-hero-v2.jpg";
import inclineLogo from "@/assets/incline-logo.png";
import { cn } from "@/lib/utils";

import SEO from "@/components/seo/SEO";
import { FACILITY_TERMS, TERMS_VERSION } from "@/lib/registration/terms";
import {
  useInitialRegistrationDraft,
  useRegistrationDraftAutosave,
  clearRegistrationDraft,
} from "@/lib/registration/useRegistrationDraft";
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
  city: z.string().trim().min(2, "City required").max(80),
  state: z.string().optional(),
  postal_code: z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit pincode"),
  address: z.string().trim().min(6, "Address required").max(240),
  government_id_type: z.string().min(1, "Select an ID type"),
  government_id_number: z.string().trim().min(4, "ID number required").max(30),
  emergency_contact_name: z.string().trim().min(2, "Emergency contact name required").max(120),
  emergency_contact_phone: z.string().regex(/^\+91\d{10}$/, "Enter a valid +91 number"),
  fitness_goals: z.string().trim().min(1, "Select a fitness goal"),
  health_conditions: z.string().optional(),
  health_conditions_other: z.string().optional(),
}).refine((v) => v.emergency_contact_phone !== v.phone, {
  path: ["emergency_contact_phone"],
  message: "Emergency contact must differ from your own number",
});
type DetailsForm = z.infer<typeof detailsSchema>;

const STEPS = ["Profile", "Health", "Sign", "Verify"] as const;

// Dark glass form input styles
const fieldInputCls =
  "h-11 rounded-xl bg-card/5 border-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/40 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:border-primary/60";
const fieldSelectCls =
  "h-11 w-full rounded-xl border border-primary-foreground/10 bg-card/5 px-3 text-sm text-primary-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none [&>option]:text-foreground";

const OTP_ERROR_COPY: Record<string, string> = {
  otp_invalid: "That code doesn't match. Check the digits and try again.",
  otp_expired: "That code expired. Tap Resend to get a fresh one.",
  otp_not_found: "We couldn't find an active code. Tap Resend to get a new one.",
  too_many_attempts: "Too many wrong attempts. Tap Resend to get a new code.",
  already_member: "This number is already registered. Please log in instead.",
  rate_limited: "Too many requests. Please try again in 10 minutes.",
};
const friendlyOtpError = (raw: string) =>
  OTP_ERROR_COPY[raw] || raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function PublicRegistration() {
  const nav = useNavigate();
  const initialDraft = useInitialRegistrationDraft();
  const [step, setStep] = useState<"details" | "parq" | "sign" | "otp" | "done">(
    initialDraft?.step ?? "details",
  );
  const [details, setDetails] = useState<DetailsForm | null>(null);
  const [parq, setParq] = useState<Record<string, string>>(initialDraft?.parq ?? {});
  const [consents, setConsents] = useState({
    dpdp: false, whatsapp: false, photo: false, waiver: false, facility_rules: false,
    ...(initialDraft?.consents ?? {}),
  });
  const [termsRead, setTermsRead] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState<string>("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSentAt, setOtpSentAt] = useState(() => Date.now());
  const [resendLockedUntil, setResendLockedUntil] = useState(0);
  const [verifyStage, setVerifyStage] = useState("Verifying code...");
  const [healthConditions, setHealthConditions] = useState<string[]>(initialDraft?.healthConditions ?? []);
  const [healthOther, setHealthOther] = useState(initialDraft?.healthOther ?? "");
  const [showMoreGoals, setShowMoreGoals] = useState(false);
  const [draftRestored, setDraftRestored] = useState(!!initialDraft);
  const sigRef = useRef<SignaturePadHandle>(null);

  const { data: branches } = useQuery({
    queryKey: ["public-branches"],
    queryFn: async () => {
      // Calls SECURITY DEFINER RPC that returns only non-sensitive columns to anon users.
      const { data, error } = await supabase.rpc("get_public_branches");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; city: string | null }>;
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  const form = useForm<DetailsForm>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      gender: "male" as const,
      phone: "+91",
      ...(initialDraft?.values ?? {}),
    } as Partial<DetailsForm> as DetailsForm,
  });

  const selectedGoal = form.watch("fitness_goals");
  const watchedValues = form.watch();

  // Autosave the wizard (never the signature, OTP or government ID number).
  useRegistrationDraftAutosave(
    {
      step: step === "otp" || step === "done" ? "sign" : step,
      values: watchedValues as unknown as Record<string, unknown>,
      parq,
      consents,
      healthConditions,
      healthOther,
    },
    step !== "done",
  );

  const sendOtp = useMutation({
    mutationFn: async (phone: string) => {
      const { data, error } = await supabase.functions.invoke("register-member", {
        body: { mode: "send_otp", phone, email: details?.email ?? form.getValues("email") ?? null },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.status === "rate_limited") throw new Error("rate_limited");
      if (data?.status === "already_member") throw new Error("already_member");
      return data as { channels?: string[] };
    },
    onSuccess: (data) => {
      const ch = data?.channels?.includes("email") ? "WhatsApp & email" : "WhatsApp";
      toast.success(`OTP sent on ${ch}`);
      setOtp("");
      setOtpError(null);
      setOtpSentAt(Date.now());
      setResendLockedUntil(0);
      setStep("otp");
    },
    onError: (e: Error) => {
      const msg = friendlyOtpError(e.message);
      if (e.message === "rate_limited") setResendLockedUntil(Date.now() + 10 * 60_000);
      setOtpError(msg);
      toast.error(msg);
      // Keep the member on the OTP screen if they were already there.
      if (step === "sign") setStep("otp");
    },
  });

  const verifyAndRegister = useMutation({
    mutationFn: async () => {
      if (!details) throw new Error("Missing details");
      setVerifyStage("Verifying code...");
      const parqMap: Record<string, string> = {};
      PARQ_QUESTIONS.forEach((q, i) => { parqMap[q] = parq[`q${i}`] || "no"; });
      const stageTimer = window.setTimeout(() => setVerifyStage("Creating your account..."), 1200);
      const stageTimer2 = window.setTimeout(() => setVerifyStage("Almost there..."), 4000);
      try {
        const { data, error } = await supabase.functions.invoke("register-member", {
          body: {
            mode: "verify_and_register",
            phone: details.phone,
            code: otp,
            registration: details,
            par_q: parqMap,
            consents,
            terms_version: TERMS_VERSION,
            signature_data_url: signatureUrl,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data as { access_token: string; refresh_token: string; member_code: string };
      } finally {
        window.clearTimeout(stageTimer);
        window.clearTimeout(stageTimer2);
      }
    },
    onSuccess: async (data) => {
      clearRegistrationDraft();
      if (data.access_token && data.refresh_token) {
        await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      }
      toast.success(`Welcome to Incline! Your member code: ${data.member_code}`);
      setStep("done");
      setTimeout(() => nav("/member-dashboard", { replace: true }), 1500);
    },
    onError: (e: Error) => {
      const msg = friendlyOtpError(e.message);
      setOtpError(msg);
      toast.error(msg);
    },
  });

  const handleVerify = useCallback(() => {
    if (verifyAndRegister.isPending) return;
    verifyAndRegister.mutate();
  }, [verifyAndRegister]);

  const startOver = () => {
    clearRegistrationDraft();
    window.location.reload();
  };

  // Single source of truth for the comma-joined health string. Used by both the
  // normal submit path and the draft-restore path so a refresh never drops it.
  const buildHealthConditions = useCallback(() => {
    const conditions = [...healthConditions];
    if (conditions.includes("Other") && healthOther.trim()) {
      const idx = conditions.indexOf("Other");
      conditions[idx] = `Other: ${healthOther.trim()}`;
    } else if (conditions.includes("Other") && !healthOther.trim()) {
      conditions.splice(conditions.indexOf("Other"), 1);
    }
    return conditions.join(", ") || undefined;
  }, [healthConditions, healthOther]);

  const submitDetails = form.handleSubmit((values) => {
    if (healthConditions.length === 0) {
      setHealthError("Select at least one option (choose “None” if you have no conditions)");
      toast.error("Please answer the health conditions question");
      return;
    }
    if (healthConditions.includes("Other") && !healthOther.trim()) {
      setHealthError("Please specify your other condition");
      return;
    }
    setHealthError(null);
    const health = buildHealthConditions();
    const merged: DetailsForm = { ...values, health_conditions: health };
    // Mirror into the form so the autosaved draft carries it through a refresh.
    form.setValue("health_conditions", health);
    setDetails(merged);
    setStep("parq");
  });

  const parqComplete = PARQ_QUESTIONS.every((_, i) => parq[`q${i}`] === "yes" || parq[`q${i}`] === "no");

  const submitParq = () => {
    if (!parqComplete) {
      setParqError("Please answer every question before continuing");
      toast.error("Answer all health check questions");
      return;
    }
    setParqError(null);
    setStep("sign");
  };

  const submitSign = () => {
    if (sigRef.current?.isEmpty()) return toast.error("Please sign before continuing");
    if (!consents.dpdp || !consents.whatsapp || !consents.waiver || !consents.facility_rules)
      return toast.error("All required consents must be accepted");
    setSignatureUrl(sigRef.current!.toDataURL());
    // Re-merge in case the member edited health chips after the details step.
    setDetails((prev) => (prev ? { ...prev, health_conditions: buildHealthConditions() } : prev));
    sendOtp.mutate(details?.phone ?? form.getValues("phone"));
  };

  // A restored draft can land on "sign" without `details` in memory — rebuild it
  // from the restored form values so the signature step can still send an OTP.
  useEffect(() => {
    if (!details && (step === "parq" || step === "sign")) {
      const values = form.getValues();
      if (values.phone && values.email && values.full_name && values.branch_id) {
        setDetails({ ...values, health_conditions: buildHealthConditions() });
      } else {
        setStep("details");
      }
    }
  }, [details, step, form, buildHealthConditions]);


  const stepIdx = useMemo(
    () => Math.min({ details: 0, parq: 1, sign: 2, otp: 3, done: 3 }[step], 3),
    [step]
  );



  return (
    <div
      className="relative min-h-[100dvh] w-full overflow-hidden bg-[#08060f] text-primary-foreground"
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
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#08060f]/40 via-[#08060f]/70 to-[#08060f]" />
        <div className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-primary/30 blur-[140px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col px-4 pb-10 pt-6 sm:px-6 sm:pt-10">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={inclineLogo}
              alt="The Incline Life"
              className="h-11 w-auto object-contain drop-shadow-[0_2px_12px_rgba(167,139,250,0.35)]"
            />
            <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/50">
              Member registration
            </span>
          </div>


          <div className="rounded-full border border-primary-foreground/15 bg-card/5 px-3 py-1 text-[11px] font-medium text-primary-foreground/80 backdrop-blur-md">
            Step {Math.min(stepIdx + 1, 4)} of 4
          </div>
        </header>

        {/* Headline */}
        <div className="mt-8 sm:mt-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-primary/90">Welcome</p>
          <h2 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
            Your transformation
            <br />
            <span className="bg-gradient-to-r from-primary to-primary/40 bg-clip-text text-transparent">
              starts here.
            </span>
          </h2>
        </div>

        {/* Glass card */}
        <GlassCard className="mt-8 flex-1 p-5 sm:mt-10 sm:p-7">
          {draftRestored && step !== "done" && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5 text-xs text-primary-foreground/85">
              <span className="flex items-center gap-2">
                <History className="h-3.5 w-3.5 text-primary" />
                We restored the details you filled earlier.
              </span>
              <button
                type="button"
                onClick={startOver}
                className="shrink-0 font-semibold text-primary hover:text-primary/80"
              >
                Start over
              </button>
            </div>
          )}
          <div className="mb-6 flex items-center justify-between">
            <StepDots total={4} current={stepIdx} labels={[...STEPS]} />
            <span className="text-xs font-medium text-primary-foreground/60">{STEPS[stepIdx]}</span>
          </div>


          {step === "details" && (
            <form onSubmit={submitDetails} className="space-y-5">
              <Field label="Full name" error={form.formState.errors.full_name?.message}>
                <Input className={fieldInputCls} placeholder="Your name" {...form.register("full_name")} />
              </Field>

              <Field label="Phone (WhatsApp)" error={form.formState.errors.phone?.message}>
                <PhoneInput
                  className="bg-card/5 border-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/40"
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
                <input type="hidden" {...form.register("branch_id")} />
                {!branches ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="h-[62px] rounded-xl bg-card/5 animate-pulse" />
                    <div className="h-[62px] rounded-xl bg-card/5 animate-pulse" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {branches.map((b) => {
                      const selected = form.watch("branch_id") === b.id;
                      return (
                        <button
                          type="button"
                          key={b.id}
                          onClick={() => form.setValue("branch_id", b.id, { shouldValidate: true })}
                          aria-pressed={selected}
                          className={cn(
                            "group flex items-center gap-3 rounded-xl border p-3 text-left transition-all backdrop-blur-md",
                            selected
                              ? "border-primary/70 bg-primary/15 ring-2 ring-primary/40 shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.5)]"
                              : "border-primary-foreground/10 bg-card/5 hover:bg-card/10 hover:border-primary-foreground/20"
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                              selected ? "bg-primary/25 text-primary-foreground" : "bg-card/10 text-primary-foreground/70"
                            )}
                          >
                            <MapPin className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-primary-foreground">{b.name}</span>
                            {b.city && (
                              <span className="block truncate text-xs text-primary-foreground/55">{b.city}</span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
                              selected ? "border-primary bg-primary" : "border-primary-foreground/25"
                            )}
                          >
                            {selected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>


              <Field label="Address">
                <Input
                  className={fieldInputCls}
                  placeholder="House / street / area"
                  {...form.register("address")}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="City"><Input className={fieldInputCls} {...form.register("city")} /></Field>
                <Field label="Pincode"><Input className={fieldInputCls} {...form.register("postal_code")} /></Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Government ID type">
                  <select className={fieldSelectCls} {...form.register("government_id_type")}>
                    <option value="">Select</option>
                    <option value="aadhaar">Aadhaar</option>
                    <option value="pan">PAN</option>
                    <option value="passport">Passport</option>
                    <option value="driving_license">Driving licence</option>
                    <option value="voter_id">Voter ID</option>
                  </select>
                </Field>
                <Field label="ID number" error={form.formState.errors.government_id_number?.message}>
                  <Input className={fieldInputCls} placeholder="XXXX XXXX XXXX" {...form.register("government_id_number")} />
                </Field>
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
                            : "border-primary-foreground/10 bg-card/5 hover:border-primary-foreground/25 hover:bg-card/10"
                        }`}
                      >
                        <div className={`rounded-lg p-1.5 ${active ? "bg-primary text-primary-foreground" : "bg-card/10 text-primary-foreground/70"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className={`text-sm font-medium ${active ? "text-primary-foreground" : "text-primary-foreground/80"}`}>{g.key}</span>
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
                            active ? "bg-primary text-primary-foreground" : "bg-card/10 text-primary-foreground/80 hover:bg-card/15"
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
                            : "bg-card/5 text-primary-foreground/80 ring-1 ring-inset ring-white/10 hover:bg-card/10"
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
                <p className="mt-2 text-[11px] text-primary-foreground/50">Confidential — only your trainer sees this.</p>
              </Field>

              <LiquidButton type="submit" size="lg" className="w-full">
                Continue <ArrowRight className="h-4 w-4" />
              </LiquidButton>
            </form>
          )}

          {step === "parq" && (
            <div className="space-y-5">
              <p className="text-sm text-primary-foreground/70">Quick health check — answer honestly to keep you safe.</p>
              <div className="space-y-3">
                {PARQ_QUESTIONS.map((q, i) => (
                  <div key={i} className="rounded-2xl border border-primary-foreground/10 bg-card/5 p-4">
                    <p className="mb-3 text-sm font-medium text-primary-foreground/90">{q}</p>
                    <div className="flex gap-2">
                      {(["no", "yes"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setParq((p) => ({ ...p, [`q${i}`]: v }))}
                          className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                            parq[`q${i}`] === v
                              ? v === "yes"
                                ? "bg-warning text-primary-foreground shadow-[0_4px_14px_-4px_rgb(245_158_11/0.5)]"
                                : "bg-success text-primary-foreground shadow-[0_4px_14px_-4px_rgb(16_185_129/0.5)]"
                              : "bg-card/5 text-primary-foreground/70 ring-1 ring-inset ring-white/10 hover:bg-card/10"
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
              <p className="text-sm text-primary-foreground/70">Review the facility terms, then sign to continue.</p>

              <div className="rounded-2xl border border-primary-foreground/10 bg-card/5">
                <div className="flex items-center justify-between border-b border-primary-foreground/10 px-4 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/60">
                    Incline — Facility Terms &amp; Conditions
                  </p>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    v{TERMS_VERSION}
                  </span>
                </div>
                <div
                  className="max-h-60 space-y-3 overflow-auto px-4 py-3 text-xs leading-relaxed text-primary-foreground/75"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setTermsRead(true);
                  }}
                >
                  <p>
                    I acknowledge that physical exercise involves inherent risk of injury. I voluntarily assume all such
                    risks, confirm my PAR-Q answers are accurate, and will seek medical clearance if any answer was
                    &ldquo;Yes&rdquo;.
                  </p>
                  {FACILITY_TERMS.map((t, i) => (
                    <div key={t.title}>
                      <p className="font-semibold text-primary-foreground/90">
                        {i + 1}. {t.title}
                      </p>
                      <p className="mt-0.5">{t.body}</p>
                    </div>
                  ))}
                </div>
                {!termsRead && (
                  <p className="border-t border-primary-foreground/10 px-4 py-2 text-[11px] text-primary-foreground/50">
                    Scroll to the end to read all {FACILITY_TERMS.length} clauses.
                  </p>
                )}
              </div>

              <div className="space-y-2.5">
                {[
                  { k: "waiver", l: "I accept the assumption of risk and waiver above.", required: true },
                  { k: "facility_rules", l: "I have read and accept the Incline facility terms, including 24/7 unstaffed-hours access, CCTV, turnstile, footwear, locker and parking rules.", required: true },
                  { k: "dpdp", l: "I consent to processing of my personal data per the DPDP Act, 2023.", required: true },
                  { k: "whatsapp", l: "I agree to receive WhatsApp / SMS / Email / RCS updates from Incline.", required: true },
                  { k: "photo", l: "I consent to my photo being used for member identification.", required: false },
                ].map((c) => (
                  <label
                    key={c.k}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-primary-foreground/10 bg-card/5 p-3 text-xs text-primary-foreground/80 transition-colors hover:bg-card/10"
                  >
                    <Checkbox
                      checked={(consents as Record<string, boolean>)[c.k]}
                      onCheckedChange={(v) => setConsents((s) => ({ ...s, [c.k]: !!v }))}
                      className="mt-0.5 border-primary-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <span className="leading-snug">
                      {c.l}
                      {c.required && <span className="ml-1 text-destructive">*</span>}
                      {!c.required && <span className="ml-1 text-primary-foreground/40">(optional)</span>}
                    </span>
                  </label>
                ))}
              </div>

              <div>
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/60">Signature</Label>
                <p className="mb-2 mt-1 flex items-center gap-1.5 text-xs text-primary-foreground/50">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Sign with Apple Pencil or your finger
                </p>
                <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-white/20">
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
            <OtpStep
              phone={details?.phone ?? ""}
              email={details?.email}
              sentAt={otpSentAt}
              lockedUntil={resendLockedUntil}
              otp={otp}
              onOtpChange={(v) => { setOtp(v); setOtpError(null); }}
              onVerify={handleVerify}
              onResend={() => sendOtp.mutate(details!.phone)}
              verifying={verifyAndRegister.isPending}
              verifyStage={verifyStage}
              resending={sendOtp.isPending}
              errorMessage={otpError}
              onChangeNumber={() => { setOtp(""); setOtpError(null); setStep("details"); }}
            />
          )}


          {step === "done" && (
            <div className="space-y-4 py-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/20 ring-1 ring-success/40">
                <ShieldCheck className="h-8 w-8 text-success" />
              </div>
              <h3 className="text-xl font-bold">You're in!</h3>
              <p className="text-sm text-primary-foreground/70">
                Visit reception to activate your plan. We've sent your welcome message with
                your member code and login link.
              </p>
              <a
                href="/auth"
                className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-foreground px-5 py-2.5 text-sm font-semibold text-primary shadow-lg transition-all duration-200 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary-foreground"
              >
                Log in to your account
              </a>
            </div>

          )}
        </GlassCard>

        {/* Trust strip */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-primary-foreground/50">
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
      <Label className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/60">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {error && <p className="mt-1.5 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
