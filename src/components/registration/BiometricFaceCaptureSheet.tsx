import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, Loader2, RefreshCw, Check, Sun, ScanFace, Glasses } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the final photo. Throw to keep the sheet open (e.g. photo rejected). */
  onCapture: (file: File) => Promise<void>;
  busy?: boolean;
}

type Phase = "starting" | "live" | "review" | "fallback";

/**
 * Live camera viewfinder with an oval face guide so members frame their face
 * the way the gate terminals expect. Falls back to file/gallery upload when the
 * camera is unavailable or permission is denied.
 */
export function BiometricFaceCaptureSheet({ open, onOpenChange, onCapture, busy }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    if (!navigator.mediaDevices?.getUserMedia) { setPhase("fallback"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      setPhase("live");
    } catch {
      setPhase("fallback");
    }
  }, []);

  useEffect(() => {
    if (open) start();
    else { stop(); setPreview(null); setCountdown(null); }
    return stop;
  }, [open, start, stop]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const snap = useCallback(() => {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    // Square crop centred on the oval guide, mirrored back to true orientation.
    const side = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, side, side);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "face.jpg", { type: "image/jpeg" });
      setPreview({ url: URL.createObjectURL(blob), file });
      setPhase("review");
      stop();
    }, "image/jpeg", 0.92);
  }, [stop]);

  const startCountdown = () => {
    let n = 3; setCountdown(n);
    const t = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(t); setCountdown(null); snap(); } else setCountdown(n);
    }, 700);
  };

  const retake = () => { setPreview(null); start(); };

  const confirm = async () => {
    if (!preview) return;
    try { await onCapture(preview.file); onOpenChange(false); } catch { /* parent shows issues; allow retake */ }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="sticky top-0 z-10 border-b bg-background px-5 py-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <span className="rounded-full bg-primary/10 p-2 text-primary"><ScanFace className="h-5 w-5" /></span>
            Gate entry photo
          </SheetTitle>
          <SheetDescription>Fit your face inside the oval, look straight ahead, then capture.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-slate-900">
            {phase === "review" && preview ? (
              <img src={preview.url} alt="Captured face preview" className="h-full w-full object-cover" />
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                className={`h-full w-full scale-x-[-1] object-cover ${phase === "live" ? "opacity-100" : "opacity-0"}`}
              />
            )}

            {/* Oval guide + dimmed surround */}
            {(phase === "live" || phase === "review") && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                <defs>
                  <mask id="face-oval-mask">
                    <rect width="100" height="100" fill="white" />
                    <ellipse cx="50" cy="46" rx="27" ry="35" fill="black" />
                  </mask>
                </defs>
                <rect width="100" height="100" fill="rgba(15,23,42,0.55)" mask="url(#face-oval-mask)" />
                <ellipse cx="50" cy="46" rx="27" ry="35" fill="none" stroke="white" strokeWidth="0.8" strokeDasharray={phase === "live" ? "2 1.5" : undefined} />
                <line x1="38" y1="40" x2="62" y2="40" stroke="white" strokeOpacity="0.35" strokeWidth="0.4" />
              </svg>
            )}

            {phase === "starting" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-6 w-6 animate-spin" /> Opening camera…
              </div>
            )}
            {phase === "fallback" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-300">
                <Camera className="h-7 w-7" />
                Camera not available. Upload a clear, front-facing photo instead.
              </div>
            )}
            {countdown !== null && (
              <div className="absolute inset-0 flex items-center justify-center text-6xl font-bold text-white drop-shadow-lg">{countdown}</div>
            )}
            {phase === "live" && countdown === null && (
              <p className="absolute inset-x-0 bottom-3 text-center text-xs font-medium text-white/90">Align eyes with the line</p>
            )}
          </div>

          <ul className="mx-auto mt-5 grid max-w-sm grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
            <li className="rounded-xl bg-muted p-2.5"><Sun className="mx-auto mb-1 h-4 w-4 text-amber-500" />Good light on face</li>
            <li className="rounded-xl bg-muted p-2.5"><ScanFace className="mx-auto mb-1 h-4 w-4 text-primary" />Face fills the oval</li>
            <li className="rounded-xl bg-muted p-2.5"><Glasses className="mx-auto mb-1 h-4 w-4 text-slate-500" />No cap, mask or shades</li>
          </ul>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              stop();
              setPreview({ url: URL.createObjectURL(f), file: f });
              setPhase("review");
            }}
          />
        </div>

        <div className="sticky bottom-0 flex gap-3 border-t bg-background px-5 py-4 pb-safe">
          {phase === "review" ? (
            <>
              <Button variant="outline" className="min-h-[44px] flex-1" onClick={retake} disabled={busy}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retake
              </Button>
              <Button className="min-h-[44px] flex-1" onClick={confirm} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {busy ? "Checking…" : "Use this photo"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="min-h-[44px] flex-1" onClick={() => fileRef.current?.click()}>
                <ImageUp className="mr-2 h-4 w-4" /> Upload
              </Button>
              <Button className="min-h-[44px] flex-1" onClick={startCountdown} disabled={phase !== "live" || countdown !== null}>
                <Camera className="mr-2 h-4 w-4" /> Capture
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
