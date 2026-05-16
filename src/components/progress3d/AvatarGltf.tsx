import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { BodyModel } from './BodyModel';
import type { AvatarSnapshot } from '@/lib/measurements/measurementToAvatar';

/**
 * AvatarGltf — loads a real GLB avatar (with morph targets) when a URL is configured,
 * otherwise renders the procedural BodyModel.
 *
 * Configure GLB sources (optional) via Vite env at build time:
 *   VITE_AVATAR_MALE_URL=https://your-cdn/avatar-male.glb
 *   VITE_AVATAR_FEMALE_URL=https://your-cdn/avatar-female.glb
 *   VITE_AVATAR_NEUTRAL_URL=https://your-cdn/avatar-neutral.glb
 *
 * If no env vars are set, we render the procedural BodyModel directly with no
 * network requests (no more 404 noise on /models/avatar-*.glb).
 *
 * Recommended GLB rigs: Ready Player Me / Mixamo with morph target names that
 * match `AvatarSnapshot.morphs` keys (waistWidth, chestVolume, hipWidth, etc.).
 * Any morph keys not present on the mesh are silently ignored.
 */

interface AvatarGltfProps {
  snapshot: AvatarSnapshot;
  interactiveRotationY: number;
}

// Pull URLs from Vite env. Empty / missing values disable GLB loading entirely.
const ENV_URLS: Record<'male' | 'female' | 'neutral', string | undefined> = {
  male: import.meta.env.VITE_AVATAR_MALE_URL as string | undefined,
  female: import.meta.env.VITE_AVATAR_FEMALE_URL as string | undefined,
  neutral:
    (import.meta.env.VITE_AVATAR_NEUTRAL_URL as string | undefined) ||
    (import.meta.env.VITE_AVATAR_MALE_URL as string | undefined),
};

function getModelUrl(gender: string): string | null {
  const key: 'male' | 'female' | 'neutral' =
    gender === 'male' ? 'male' : gender === 'female' ? 'female' : 'neutral';
  const url = ENV_URLS[key];
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Common morph-target name aliases for Ready Player Me / Mixamo / custom rigs. */
const MORPH_ALIASES: Record<string, string[]> = {
  waistWidth: ['Waist', 'waist', 'viseme_Waist'],
  chestVolume: ['Chest', 'chest', 'ChestSize'],
  hipWidth: ['Hip', 'hips', 'Hips'],
  armBicep: ['Arm', 'Bicep', 'biceps'],
  thighGirth: ['Thigh', 'thighs', 'Thighs'],
  bodyFat: ['BodyFat', 'body_fat', 'Fat'],
};

function findMorphIndex(dict: Record<string, number>, key: string): number | undefined {
  if (typeof dict[key] === 'number') return dict[key];
  for (const alias of MORPH_ALIASES[key] || []) {
    if (typeof dict[alias] === 'number') return dict[alias];
  }
  return undefined;
}

function GltfMesh({ url, snapshot, interactiveRotationY }: { url: string } & AvatarGltfProps) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh & {
        morphTargetDictionary?: Record<string, number>;
        morphTargetInfluences?: number[];
      };
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      Object.entries(snapshot.morphs).forEach(([key, value]) => {
        const idx = findMorphIndex(mesh.morphTargetDictionary!, key);
        if (typeof idx === 'number') {
          mesh.morphTargetInfluences![idx] = Math.max(0, Math.min(1, value));
        }
      });
    });
  }, [cloned, snapshot]);

  return (
    <primitive
      object={cloned}
      rotation-y={interactiveRotationY}
      position={[0, -1.45, 0]}
    />
  );
}

/** Catches GLB load/parse errors at runtime and falls back to BodyModel. */
class GltfErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
     
    console.warn('[AvatarGltf] GLB load failed, falling back to procedural model:', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function AvatarGltf({ snapshot, interactiveRotationY }: AvatarGltfProps) {
  const url = getModelUrl(snapshot.genderPresentation);
  const fallback = <BodyModel snapshot={snapshot} interactiveRotationY={interactiveRotationY} />;

  // No GLB URL configured → render procedural model immediately, zero network probes.
  if (!url) return fallback;

  return (
    <GltfErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <GltfMesh url={url} snapshot={snapshot} interactiveRotationY={interactiveRotationY} />
      </Suspense>
    </GltfErrorBoundary>
  );
}
