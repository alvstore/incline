// Body avatar canvas — renders the latest HOWBODY .obj scan when available,
// with a glass-style metrics overlay (body composition + posture).
// Falls back to the SVG silhouette when no Howbody scan exists.
import { Suspense, useMemo, useState } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Environment, Center, ContactShadows } from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import * as THREE from "three";
import { Loader2, Activity, Camera, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MemberBodyAvatarSvg } from "./MemberBodyAvatarSvg";
import { BodyFallbackCard } from "./BodyFallbackCard";
import { useLatestHowbodyScan } from "@/hooks/useLatestHowbodyScan";
import type { MemberMeasurementRecord } from "@/lib/measurements/types";

interface MemberBodyAvatarCanvasProps {
  memberId?: string | null;
  measurement?: MemberMeasurementRecord | null;
  previousMeasurement?: MemberMeasurementRecord | null;
  label: string;
  memberGender?: string | null;
}

export function MemberBodyAvatarCanvas({
  memberId,
  measurement,
  previousMeasurement,
  label,
  memberGender,
}: MemberBodyAvatarCanvasProps) {
  const { data: scan, isLoading } = useLatestHowbodyScan(memberId ?? null);
  const modelUrl = scan?.posture?.model_url || null;
  const [view, setView] = useState<"3d" | "photos">("3d");

  // No Howbody data → existing fallbacks
  if (!modelUrl && !scan?.body && !scan?.posture) {
    if (!measurement) {
      return <BodyFallbackCard latest={measurement} previous={previousMeasurement} title={label} />;
    }
    return (
      <MemberBodyAvatarSvg
        measurement={measurement}
        previousMeasurement={previousMeasurement}
        label={label}
        memberGender={memberGender}
      />
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-muted via-muted to-primary shadow-xl shadow-primary/20">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div className="flex items-center gap-2">
          <Badge className="border-0 bg-card/15 text-primary-foreground">
            <Sparkles className="mr-1 h-3 w-3" /> {label}
          </Badge>
          {scan?.posture?.test_time && (
            <span className="text-[11px] text-muted-foreground">
              {new Date(scan.posture.test_time).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex gap-1 rounded-full bg-card/10 p-1">
          <button
            onClick={() => setView("3d")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              view === "3d" ? "bg-card text-foreground" : "text-primary-foreground/80 hover:text-primary-foreground"
            }`}
          >
            3D Model
          </button>
          <button
            onClick={() => setView("photos")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              view === "photos" ? "bg-card text-foreground" : "text-primary-foreground/80 hover:text-primary-foreground"
            }`}
          >
            <Camera className="mr-1 inline h-3 w-3" /> Photos
          </button>
        </div>
      </div>

      <div className="relative h-[480px] w-full">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-foreground/70" />
          </div>
        ) : view === "3d" && modelUrl ? (
          <Canvas
            camera={{ position: [0, 1.3, 3.2], fov: 38 }}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[3, 5, 5]} intensity={0.9} />
            <directionalLight position={[-4, 3, -2]} intensity={0.4} />
            <Suspense fallback={null}>
              <Center>
                <ObjModel url={modelUrl} />
              </Center>
              <Environment preset="studio" />
              <ContactShadows position={[0, -1, 0]} opacity={0.5} scale={5} blur={2.5} far={3} />
            </Suspense>
            <OrbitControls
              enablePan={false}
              enableZoom
              minDistance={1.8}
              maxDistance={6}
              autoRotate
              autoRotateSpeed={0.7}
            />
          </Canvas>
        ) : view === "3d" && !modelUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-primary-foreground/70">
            <Activity className="h-10 w-10" />
            <p className="text-sm">No 3D model yet — body composition only</p>
          </div>
        ) : (
          <PhotoGrid posture={scan?.posture ?? null} />
        )}

        {/* Metrics overlay */}
        {(scan?.body || scan?.posture) && (
          <div className="pointer-events-none absolute inset-y-3 right-3 hidden w-56 rounded-2xl bg-card/10 p-4 text-primary-foreground shadow-2xl backdrop-blur-md md:block">
            <MetricsList scan={scan} />
          </div>
        )}
      </div>

      {/* Mobile metrics panel */}
      <div className="border-t border-primary-foreground/10 bg-card/5 p-3 text-primary-foreground md:hidden">
        <MetricsList scan={scan} compact />
      </div>
    </div>
  );
}

function ObjModel({ url }: { url: string }) {
  // useLoader caches per-URL; OBJ may include MTL refs we ignore.
  const obj = useLoader(OBJLoader, url) as THREE.Group;

  const cloned = useMemo(() => {
    const g = obj.clone(true);
    g.traverse((child: any) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color("#cbd5e1"),
          metalness: 0.1,
          roughness: 0.7,
        });
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Auto-fit: scale to ~1.8 units tall
    const box = new THREE.Box3().setFromObject(g);
    const size = new THREE.Vector3();
    box.getSize(size);
    const target = 1.8;
    const scale = size.y > 0 ? target / size.y : 1;
    g.scale.setScalar(scale);
    return g;
  }, [obj]);

  return <primitive object={cloned} />;
}

function PhotoGrid({ posture }: { posture: { front_img: string | null; left_img: string | null; right_img: string | null; back_img: string | null } | null }) {
  if (!posture) return null;
  const items: { label: string; url: string | null }[] = [
    { label: "Front", url: posture.front_img },
    { label: "Left", url: posture.left_img },
    { label: "Right", url: posture.right_img },
    { label: "Back", url: posture.back_img },
  ];
  const present = items.filter((i) => i.url);
  if (!present.length) {
    return (
      <div className="flex h-full items-center justify-center text-primary-foreground/60">
        <p>No posture photos available</p>
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-2 gap-2 p-3">
      {present.map((it) => (
        <div key={it.label} className="relative overflow-hidden rounded-xl bg-foreground/20">
          <img src={it.url!} alt={it.label} className="h-full w-full object-contain" loading="lazy" />
          <div className="absolute bottom-1 left-2 rounded-full bg-foreground/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary-foreground">
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricsList({ scan, compact }: { scan: { body: any; posture: any } | undefined; compact?: boolean }) {
  if (!scan) return null;
  const rows: { label: string; value: string | null; tone?: string }[] = [];
  if (scan.body) {
    if (scan.body.health_score != null) rows.push({ label: "Health Score", value: `${Math.round(scan.body.health_score)}`, tone: "text-success" });
    if (scan.body.weight != null) rows.push({ label: "Weight", value: `${scan.body.weight} kg` });
    if (scan.body.bmi != null) rows.push({ label: "BMI", value: `${scan.body.bmi}` });
    if (scan.body.pbf != null) rows.push({ label: "Body Fat %", value: `${scan.body.pbf}%`, tone: "text-warning" });
    if (scan.body.smm != null) rows.push({ label: "Skeletal Muscle", value: `${scan.body.smm} kg`, tone: "text-primary" });
    if (scan.body.bmr != null) rows.push({ label: "BMR", value: `${scan.body.bmr} kcal` });
    if (scan.body.vfr != null) rows.push({ label: "Visceral Fat", value: `${scan.body.vfr}` });
    if (scan.body.metabolic_age != null) rows.push({ label: "Metabolic Age", value: `${scan.body.metabolic_age}` });
  }
  if (scan.posture) {
    if (scan.posture.score != null) rows.push({ label: "Posture Score", value: `${Math.round(scan.posture.score)}`, tone: "text-success" });
    if (scan.posture.head_forward != null) rows.push({ label: "Head Forward", value: `${scan.posture.head_forward}°` });
    if (scan.posture.shoulder_left != null && scan.posture.shoulder_right != null) {
      rows.push({ label: "Shoulder L/R", value: `${scan.posture.shoulder_left}° / ${scan.posture.shoulder_right}°` });
    }
    if (scan.posture.pelvis_forward != null) rows.push({ label: "Pelvis Forward", value: `${scan.posture.pelvis_forward}°` });
  }
  if (!rows.length) return null;
  return (
    <div className={compact ? "grid grid-cols-2 gap-2" : "space-y-2"}>
      {rows.slice(0, compact ? 6 : 12).map((r) => (
        <div key={r.label} className="flex items-center justify-between rounded-lg bg-card/5 px-2 py-1.5 text-xs">
          <span className="text-primary-foreground/70">{r.label}</span>
          <span className={`font-semibold ${r.tone || "text-primary-foreground"}`}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
