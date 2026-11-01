import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dumbbellPose } from './dumbbellMotion';

interface HeroDumbbellProps {
  scrollProgress: number;
  isMobile: boolean;
  reducedMotion?: boolean;
}

const createHexagonalPrismGeometry = (radius: number, height: number) => {
  return new THREE.CylinderGeometry(radius, radius, height, 6);
};

const HeroDumbbell = ({ scrollProgress, isMobile, reducedMotion = false }: HeroDumbbellProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const plate1Ref = useRef<THREE.Group>(null);
  const plate2Ref = useRef<THREE.Group>(null);
  const plate3Ref = useRef<THREE.Group>(null);
  const plate4Ref = useRef<THREE.Group>(null);

  const handleGeometry = useMemo(() => new THREE.CylinderGeometry(0.08, 0.08, 1.6, 32), []);
  const largePlateGeometry = useMemo(() => createHexagonalPrismGeometry(0.45, 0.08), []);
  const mediumPlateGeometry = useMemo(() => createHexagonalPrismGeometry(0.35, 0.06), []);
  const endCapGeometry = useMemo(() => new THREE.CylinderGeometry(0.1, 0.1, 0.05, 32), []);

  const chromeMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.85, 0.85, 0.9), metalness: 0.95, roughness: 0.1, envMapIntensity: 1.5,
  }), []);

  const obsidianMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.08, 0.08, 0.1), metalness: 0.3, roughness: 0.4, envMapIntensity: 0.8,
  }), []);

  const glowMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.2, 0.5, 1.0), emissive: new THREE.Color(0.1, 0.3, 0.8),
    emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.2,
  }), []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const time = reducedMotion ? 0 : state.clock.getElapsedTime();
    const pose = dumbbellPose(scrollProgress, state.viewport.width, state.viewport.height, isMobile);
    const ease = reducedMotion ? 1 : 1 - Math.exp(-8 * Math.min(delta, 0.05));
    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, pose.x, ease);
    groupRef.current.position.y = reducedMotion ? 0 : Math.sin(time * 0.5) * pose.scale * 0.06;
    groupRef.current.rotation.set(0.15, Math.sin(time * 0.3) * 0.55 + 0.35, pose.rotation);
    groupRef.current.scale.setScalar(pose.scale);
    const plateSpread = pose.spread;
    const wrapper = state.gl.domElement.parentElement?.parentElement;
    if (wrapper && !wrapper.dataset.sceneReady) wrapper.dataset.sceneReady = 'true';

    if (plate1Ref.current && plate2Ref.current && plate3Ref.current && plate4Ref.current) {
      plate1Ref.current.position.x = -0.6 - plateSpread;
      plate2Ref.current.position.x = -0.5 - plateSpread * 0.5;
      plate3Ref.current.position.x = 0.5 + plateSpread * 0.5;
      plate4Ref.current.position.x = 0.6 + plateSpread;
      const floatOffset = Math.sin(time * 2) * 0.02 * plateSpread;
      plate1Ref.current.position.y = floatOffset;
      plate2Ref.current.position.y = -floatOffset;
      plate3Ref.current.position.y = floatOffset;
      plate4Ref.current.position.y = -floatOffset;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={handleGeometry} material={chromeMaterial} rotation={[0, 0, Math.PI / 2]} />
      <group ref={plate1Ref} position={[-0.6, 0, 0]}>
        <mesh geometry={largePlateGeometry} material={obsidianMaterial} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={largePlateGeometry} material={glowMaterial} rotation={[0, 0, Math.PI / 2]} scale={[1.02, 0.3, 1.02]} />
      </group>
      <group ref={plate2Ref} position={[-0.5, 0, 0]}>
        <mesh geometry={mediumPlateGeometry} material={obsidianMaterial} rotation={[0, 0, Math.PI / 2]} />
      </group>
      <group ref={plate3Ref} position={[0.5, 0, 0]}>
        <mesh geometry={mediumPlateGeometry} material={obsidianMaterial} rotation={[0, 0, Math.PI / 2]} />
      </group>
      <group ref={plate4Ref} position={[0.6, 0, 0]}>
        <mesh geometry={largePlateGeometry} material={obsidianMaterial} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={largePlateGeometry} material={glowMaterial} rotation={[0, 0, Math.PI / 2]} scale={[1.02, 0.3, 1.02]} />
      </group>
      <mesh geometry={endCapGeometry} material={chromeMaterial} position={[-0.82, 0, 0]} rotation={[0, 0, Math.PI / 2]} />
      <mesh geometry={endCapGeometry} material={chromeMaterial} position={[0.82, 0, 0]} rotation={[0, 0, Math.PI / 2]} />
    </group>
  );
};

export default HeroDumbbell;
