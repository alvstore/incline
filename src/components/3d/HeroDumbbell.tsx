import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface HeroDumbbellProps {
  scrollProgress: number;
  isMobile: boolean;
}

const createHexagonalPrismGeometry = (radius: number, height: number) => {
  return new THREE.CylinderGeometry(radius, radius, height, 6);
};

const HeroDumbbell = ({ scrollProgress, isMobile }: HeroDumbbellProps) => {
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

  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.getElapsedTime();
    const baseScale = isMobile ? 0.7 : 1.0;
    const xOffset = isMobile ? 1.5 : 3.0;

    let posX = 0, posY = 0, scale = baseScale;
    const rotY = time * 0.3;
    let rotZ = Math.PI / 2;
    let plateSpread = 0;

    if (scrollProgress < 0.2) {
      posX = isMobile ? -xOffset * 0.3 : -xOffset * 0.5;
      posY = isMobile ? 1.2 + Math.sin(time * 0.5) * 0.1 : Math.sin(time * 0.5) * 0.1;
      scale = baseScale * (isMobile ? 0.8 : 1.0);
      rotZ = Math.PI / 3 + Math.sin(time * 0.8) * 0.1;
    } else if (scrollProgress < 0.4) {
      const rawT = (scrollProgress - 0.2) / 0.2;
      const t = Math.min(rawT * 3, 1);
      posX = THREE.MathUtils.lerp(-xOffset * 0.5, xOffset * 0.7, t);
      scale = baseScale * THREE.MathUtils.lerp(1.0, 0.9, Math.min(rawT * 2, 1));
      rotZ = THREE.MathUtils.lerp(Math.PI / 2, Math.PI / 3, t);
      plateSpread = Math.min(rawT * 2, 1) * 0.15;
      posY = Math.sin(time * 0.5) * 0.08;
    } else if (scrollProgress < 0.6) {
      const rawT = (scrollProgress - 0.4) / 0.2;
      const t = Math.min(rawT * 3, 1);
      posX = THREE.MathUtils.lerp(xOffset * 0.7, -xOffset * 0.5, t);
      scale = baseScale * THREE.MathUtils.lerp(0.9, 0.85, Math.min(rawT * 2, 1));
      rotZ = THREE.MathUtils.lerp(Math.PI / 3, Math.PI / 4, t);
      plateSpread = 0.15 - Math.min(rawT * 2, 1) * 0.05;
      posY = Math.sin(time * 0.5) * 0.06;
    } else if (scrollProgress < 0.8) {
      const rawT = (scrollProgress - 0.6) / 0.2;
      const t = Math.min(rawT * 3, 1);
      posX = THREE.MathUtils.lerp(-xOffset * 0.5, xOffset * 0.7, t);
      scale = baseScale * THREE.MathUtils.lerp(0.85, 0.9, Math.min(rawT * 2, 1));
      rotZ = THREE.MathUtils.lerp(Math.PI / 4, Math.PI / 3, t);
      plateSpread = 0.1 + Math.min(rawT * 2, 1) * 0.05;
      posY = Math.sin(time * 0.5) * 0.04;
    } else {
      const t = (scrollProgress - 0.8) / 0.2;
      posX = THREE.MathUtils.lerp(xOffset * 0.7, -xOffset * 0.5, t);
      posY = THREE.MathUtils.lerp(0, -0.5, Math.pow(t, 2));
      scale = baseScale * THREE.MathUtils.lerp(0.9, 1.1, t);
      rotZ = THREE.MathUtils.lerp(Math.PI / 3, Math.PI / 6, t);
      plateSpread = 0.15 - t * 0.1;
    }

    groupRef.current.position.set(posX, posY, 0);
    groupRef.current.rotation.set(0, rotY, rotZ);
    groupRef.current.scale.setScalar(scale);

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
