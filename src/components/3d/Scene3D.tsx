import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import HeroDumbbell from './HeroDumbbell';
import FloatingWords from './FloatingWords';

// Quick WebGL availability probe — avoids mounting the Canvas on devices
// that will throw "Error creating WebGL context." Logged previously as a
// critical error on `/`.
function hasWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

interface SceneContentProps {
  isMobile: boolean;
  scrollProgress: number;
  reducedMotion: boolean;
}

const SceneContent = ({ isMobile, scrollProgress, reducedMotion }: SceneContentProps) => {
  return (
    <>
      {/* Cheap lighting rig — no HDR Environment so we don't ship a multi-MB
          asset on first paint of the public landing. */}
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 10, 10]} intensity={1.2} color="#ffffff" castShadow />
      <spotLight position={[10, 10, 10]} angle={0.3} penumbra={1} intensity={1.2} castShadow color="#ffffff" />
      <spotLight position={[-10, 5, -5]} angle={0.4} penumbra={1} intensity={0.6} color="#3b82f6" />
      <pointLight position={[0, 5, 5]} intensity={0.6} color="#ffffff" />
      <pointLight position={[0, -5, 0]} intensity={0.25} color="#3b82f6" />
      <Environment resolution={64}>
        <Lightformer intensity={3} position={[0, 5, 3]} scale={[10, 4, 1]} />
        <Lightformer intensity={2} position={[-4, 0, 2]} scale={[3, 8, 1]} />
      </Environment>
      <HeroDumbbell scrollProgress={scrollProgress} isMobile={isMobile} reducedMotion={reducedMotion} />
    </>
  );
};

interface Scene3DProps {
  onScrollProgress: (progress: number) => void;
}

const Scene3D = ({ onScrollProgress }: Scene3DProps) => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 700);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [webglOk, setWebglOk] = useState<boolean>(() => hasWebGL());
  const onScrollProgressRef = useRef(onScrollProgress);

  // Notify index.html shell that the live scene is up so it can drop the
  // static LCP shell without a visual gap. Also wire context-loss handlers
  // so we gracefully fall back to the static hero.
  const onCanvasCreated = useCallback((state: { gl: { domElement: HTMLCanvasElement } }) => {
    try {
      window.dispatchEvent(new CustomEvent('scene3d:ready'));
    } catch { /* ignore */ }
    const canvas = state.gl.domElement;
    const handleLost = (e: Event) => {
      e.preventDefault();
      setWebglOk(false);
    };
    canvas.addEventListener('webglcontextlost', handleLost as EventListener, false);
  }, []);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 700);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    onScrollProgressRef.current = onScrollProgress;
  }, [onScrollProgress]);

  useEffect(() => {
    let frame = 0;
    const updateScrollProgress = () => {
      frame = 0;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const nextProgress = maxScroll > 0 ? Math.min(Math.max(window.scrollY / maxScroll, 0), 1) : 0;
      setScrollProgress(nextProgress);
      onScrollProgressRef.current(nextProgress);
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateScrollProgress);
    };

    updateScrollProgress();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
    };
  }, []);

  return (
    <>
      {/* DOM-rendered floating words sit between the static SEO hero and the
          WebGL canvas. They animate via CSS keyframes — no per-frame work. */}
      {!reducedMotion && <FloatingWords scrollProgress={scrollProgress} />}

      {webglOk && (
        <div aria-hidden="true" className={`fixed inset-0 z-[2] pointer-events-none transition-opacity duration-300 ${isMobile && scrollProgress > 0.12 ? 'opacity-0' : 'opacity-100'}`} style={{ height: '100dvh' }}>
          <Canvas
            camera={{ position: [0, 0, 5], fov: 50 }}
            dpr={isMobile ? [1, 1.25] : [1, 1.75]}
            frameloop={reducedMotion || (isMobile && scrollProgress > 0.12) ? 'demand' : 'always'}
            gl={{
              antialias: !isMobile,
              alpha: true,
              powerPreference: 'high-performance',
              failIfMajorPerformanceCaveat: false,
            }}
            style={{ background: 'transparent' }}
            onCreated={onCanvasCreated}
            
          >
            <Suspense fallback={null}>
              <SceneContent isMobile={isMobile} scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
            </Suspense>
          </Canvas>
        </div>
      )}

    </>
  );
};

export default Scene3D;
