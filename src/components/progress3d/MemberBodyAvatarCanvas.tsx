// HOWBODY studio viewer; historical measurements use the silhouette only.
import { Component, Suspense, useMemo, useState, type ReactNode } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Center, Html } from "@react-three/drei";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import * as THREE from "three";
import { Loader2, Activity, Camera, RotateCcw, Box, Play, Pause, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MemberBodyAvatarSvg } from "./MemberBodyAvatarSvg";
import { BodyFallbackCard } from "./BodyFallbackCard";
import { useLatestHowbodyScan, type LatestHowbodyScan, type HowbodyPostureReport } from "@/hooks/useLatestHowbodyScan";
import type { MemberMeasurementRecord } from "@/lib/measurements/types";

interface MemberBodyAvatarCanvasProps {
  memberId?: string | null;
  measurement?: MemberMeasurementRecord | null;
  previousMeasurement?: MemberMeasurementRecord | null;
  label: string;
  memberGender?: string | null;
  useScanner?: boolean;
}

export function MemberBodyAvatarCanvas({ memberId, measurement, previousMeasurement, label, memberGender, useScanner = true }: MemberBodyAvatarCanvasProps) {
  const { data: scan, isLoading, isError, refetch } = useLatestHowbodyScan(useScanner ? memberId : null);
  const modelUrl = scan?.posture?.model_url || null;
  const [view, setView] = useState<"3d" | "photos">("3d");
  const [rotating, setRotating] = useState(false);
  const [reset, setReset] = useState(0);

  if (isLoading) return <Card className="flex h-[440px] items-center justify-center rounded-2xl" aria-label="Loading body scan"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></Card>;
  if (isError) return <Card className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-2xl"><AlertCircle className="h-7 w-7 text-destructive" /><p className="text-sm text-muted-foreground">Unable to load the body scan.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></Card>;
  if (!modelUrl && !scan?.body && !scan?.posture) {
    if (!measurement) return <BodyFallbackCard latest={measurement} previous={previousMeasurement} title={label} />;
    return <MemberBodyAvatarSvg measurement={measurement} previousMeasurement={previousMeasurement} label={label} memberGender={memberGender} />;
  }
  const date = scan?.posture?.test_time || scan?.body?.test_time;
  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-border bg-card" data-testid="body-studio">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-foreground">{label}</h3><Badge variant="secondary" className="text-xs">HOWBODY</Badge></div>
          {date && <p className="mt-1 text-xs text-muted-foreground">{new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>}
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Body view">
          <Button variant={view === '3d' ? 'secondary' : 'ghost'} className="min-h-11 gap-2 px-3" aria-pressed={view === '3d'} onClick={() => setView('3d')}><Box className="h-4 w-4" />3D Model</Button>
          <Button variant={view === 'photos' ? 'secondary' : 'ghost'} className="min-h-11 gap-2 px-3" aria-pressed={view === 'photos'} onClick={() => setView('photos')}><Camera className="h-4 w-4" />Photos</Button>
        </div>
      </div>
      <div className="relative h-[400px] w-full bg-muted sm:h-[520px]" data-testid="body-stage">
        {view === '3d' && modelUrl ? (
          <ModelBoundary key={`${modelUrl}-${reset}`} fallback={<div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center"><AlertCircle className="h-7 w-7 text-muted-foreground" /><p className="text-sm text-muted-foreground">3D model unavailable. Your report and photos are still saved.</p><Button variant="outline" onClick={() => setReset(r => r + 1)}>Retry model</Button><Button variant="ghost" onClick={() => setView('photos')}>View photos</Button></div>}>
            <Canvas camera={{ position: [0, 0, 3.4], fov: 38 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
              <ambientLight intensity={0.8} />
              <directionalLight position={[3, 5, 5]} intensity={2} />
              <directionalLight position={[-4, 3, -2]} intensity={1} />
              <Suspense fallback={<Html center><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></Html>}>
                <Center><ObjModel url={modelUrl} /></Center>
              </Suspense>
              <OrbitControls enablePan={false} enableZoom minDistance={2} maxDistance={5} target={[0, 0, 0]} autoRotate={rotating} autoRotateSpeed={0.7} />
            </Canvas>
          </ModelBoundary>
        ) : view === '3d' ? <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center text-muted-foreground"><Activity className="h-10 w-10" /><p className="text-sm">No 3D model available for this scan</p></div> : <PhotoGrid posture={scan?.posture ?? null} />}
      </div>
      {view === '3d' && modelUrl && <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border px-4 py-2">
        <p className="mr-auto text-xs text-muted-foreground">Drag to turn · Pinch or scroll to zoom</p>
        <Button variant="ghost" className="min-h-11 gap-2 text-xs" aria-pressed={rotating} onClick={() => setRotating(r => !r)}>{rotating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{rotating ? 'Pause rotation' : 'Rotate'}</Button>
        <Button variant="ghost" className="min-h-11 gap-2 text-xs" onClick={() => { setReset(r => r + 1); setRotating(false); }}><RotateCcw className="h-4 w-4" />Reset view</Button>
      </div>}
      {scan && <MetricsList scan={scan} />}
    </Card>
  );
}

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function ObjModel({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);
  const cloned = useMemo(() => {
    const g = obj.clone(true);
    // Neutral, token-derived material remains readable across member themes.
    const foreground = getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground').trim();
    const color = new THREE.Color(`hsl(${foreground.split(/\s+/).join(', ')})`);
    const material = new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.75 });
    g.traverse(child => { if (child instanceof THREE.Mesh) child.material = material; });
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    const scale = 1.8 / Math.max(size.y, size.x, size.z, 0.001);
    g.scale.setScalar(scale);
    return g;
  }, [obj]);
  return <primitive object={cloned} />;
}

function PhotoGrid({ posture }: { posture: HowbodyPostureReport | null }) {
  const items = [{ label: 'Front', url: posture?.front_img }, { label: 'Left', url: posture?.left_img }, { label: 'Right', url: posture?.right_img }, { label: 'Back', url: posture?.back_img }].filter((item): item is { label: string; url: string } => Boolean(item.url));
  if (!items.length) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No posture photos available</div>;
  return <div className="grid h-full grid-cols-2 gap-3 p-3 sm:grid-cols-4">{items.map(item => <div key={item.label} className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-card"><img src={item.url} alt={`${item.label} posture`} className="min-h-0 flex-1 object-contain" loading="lazy" /><p className="py-2 text-center text-xs font-medium text-muted-foreground">{item.label}</p></div>)}</div>;
}

function MetricsList({ scan }: { scan: LatestHowbodyScan }) {
  const n = (value: number | null | undefined, unit = '') => value == null ? null : `${Number(value.toFixed(1))}${unit}`;
  const body = scan.body;
  const posture = scan.posture;
  const groups = [
    { title: 'Body composition', rows: [
      { label: 'Health score', value: n(body?.health_score), unit: '/ 100' },
      { label: 'Weight', value: n(body?.weight), unit: 'kg' },
      { label: 'BMI', value: n(body?.bmi) },
      { label: 'Body fat', value: n(body?.pbf), unit: '%' },
      { label: 'Skeletal muscle', value: n(body?.smm), unit: 'kg' },
      { label: 'BMR', value: n(body?.bmr), unit: 'kcal' },
      { label: 'Visceral fat', value: n(body?.vfr) },
      { label: 'Metabolic age', value: n(body?.metabolic_age), unit: 'years' },
    ] },
    { title: 'Posture alignment', rows: [
      { label: 'Posture score', value: n(posture?.score), unit: '/ 100' },
      { label: 'Head forward', value: n(posture?.head_forward, '°') },
      { label: 'Shoulder L / R', value: posture?.shoulder_left != null && posture.shoulder_right != null ? `${n(posture.shoulder_left, '°')} / ${n(posture.shoulder_right, '°')}` : null },
      { label: 'Pelvis forward', value: n(posture?.pelvis_forward, '°') },
    ] },
  ];
  return <div className="space-y-5 p-4 sm:p-5">{groups.map(group => {
    const rows = group.rows.filter(row => row.value != null);
    if (!rows.length) return null;
    return <section key={group.title}><h4 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">{group.title}</h4><dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">{rows.map(row => <div key={row.label} className="min-w-0"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="mt-1 flex flex-wrap items-baseline gap-1 text-lg font-semibold tabular-nums text-foreground">{row.value}{row.unit && <span className="text-xs font-normal text-muted-foreground">{row.unit}</span>}</dd></div>)}</dl></section>;
  })}</div>;
}
