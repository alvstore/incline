import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import ScrollProgressBar from '@/components/ui/ScrollProgressBar';
import useSoundEffects from '@/hooks/useSoundEffects';
import SEO from '@/components/seo/SEO';
import { PUBLIC_BRANCHES, PUBLIC_FAQS } from '@/config/publicSite';

// Logo lives in /public so it can be preloaded from index.html with a stable
// path (Vite hashes anything under /src/assets, which breaks <link rel="preload">).
const INCLINE_LOGO = '/incline-logo.png';

// Lazy-load Scene3D so the heavy Three.js / drei bundle does not block the
// main thread during initial paint. This dramatically reduces Max Potential FID.
const Scene3D = lazy(() => import('@/components/3d/Scene3D'));
const RegisterModal = lazy(() => import('@/components/ui/RegisterModal'));
const LegalModal = lazy(() => import('@/components/ui/LegalModal'));

const InclineAscent = () => {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [mountScene, setMountScene] = useState(false);
  const [mountModals, setMountModals] = useState(false);
  const interactionRootRef = useRef<HTMLDivElement | null>(null);
  const { handleScrollProgress } = useSoundEffects({ enabled: true });

  // Defer mounting RegisterModal/LegalModal until first user interaction or
  // browser idle. They're only opened via clicks, so there's no need to ship
  // their JS/CSS in the first paint of the landing page.
  useEffect(() => {
    if (mountModals) return;
    const onEngage = () => setMountModals(true);
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'keydown', 'scroll'];
    events.forEach(e => window.addEventListener(e, onEngage, { once: true, passive: true }));
    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout?: number }) => number)
      | undefined;
    const idleId = idle
      ? idle(() => setMountModals(true), { timeout: 4000 })
      : window.setTimeout(() => setMountModals(true), 3000);
    return () => {
      events.forEach(e => window.removeEventListener(e, onEngage));
      if (idle && typeof (window as any).cancelIdleCallback === 'function') {
        (window as any).cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId as unknown as number);
      }
    };
  }, [mountModals]);

  // Defer mounting the 3D scene until (a) the browser is idle and (b) the
  // hero section is on-screen. On low-end mobiles we further defer until the
  // user actually engages (scroll/touch), so phones get instant static paint.
  useEffect(() => {
    let cancelled = false;
    const target = interactionRootRef.current;
    if (!target) return;

    // Honor reduced-motion: never mount the 3D scene.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const isLowEndMobile =
      window.innerWidth < 768 &&
      (navigator.hardwareConcurrency ?? 8) <= 4;

    const idleMount = () => {
      if (cancelled) return;
      const idle = (window as any).requestIdleCallback as
        | ((cb: () => void, opts?: { timeout?: number }) => number)
        | undefined;
      if (idle) idle(() => !cancelled && setMountScene(true), { timeout: 1200 });
      else window.setTimeout(() => !cancelled && setMountScene(true), 200);
    };

    // Low-end mobile: wait for first user interaction instead of idle.
    if (isLowEndMobile) {
      const onEngage = () => {
        if (cancelled) return;
        cleanup();
        idleMount();
      };
      const cleanup = () => {
        window.removeEventListener('scroll', onEngage);
        window.removeEventListener('touchstart', onEngage);
        window.removeEventListener('pointerdown', onEngage);
      };
      window.addEventListener('scroll', onEngage, { once: true, passive: true });
      window.addEventListener('touchstart', onEngage, { once: true, passive: true });
      window.addEventListener('pointerdown', onEngage, { once: true, passive: true });
      return () => {
        cancelled = true;
        cleanup();
      };
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        entries => {
          if (entries.some(e => e.isIntersecting)) {
            io.disconnect();
            idleMount();
          }
        },
        { rootMargin: '0px', threshold: 0.05 },
      );
      io.observe(target);
      return () => {
        cancelled = true;
        io.disconnect();
      };
    }

    idleMount();
    return () => {
      cancelled = true;
    };
  }, []);

  const onScrollProgress = (progress: number) => {
    setScrollProgress(progress);
    handleScrollProgress(progress);
  };

  const branchJsonLd = PUBLIC_BRANCHES.map(b => ({
    '@context': 'https://schema.org',
    '@type': 'HealthClub',
    name: b.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: b.address,
      addressLocality: b.city,
      addressCountry: 'IN',
    },
    openingHours: b.hours,
    amenityFeature: b.facilities.map(f => ({
      '@type': 'LocationFeatureSpecification',
      name: f,
      value: true,
    })),
  }));

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: PUBLIC_FAQS.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <div
      ref={interactionRootRef}
      className="incline-landing w-full min-h-[100dvh] overflow-x-hidden"
      style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)' }}
    >
      <SEO
        title="The Incline Life | Luxury Gym & Recovery Club in Udaipur"
        description="Udaipur's most luxurious fitness destination. Panatta equipment, elite personal training, group classes, sauna, ice bath & recovery suite. Join Incline today."
        path="/"
        jsonLd={[...branchJsonLd, faqJsonLd]}
      />
      <ScrollProgressBar progress={scrollProgress} />

      {/* Brand logo — lives outside the 3D canvas so it paints with the
          first HTML render, not after the lazy Three.js bundle finishes. */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 md:left-8 md:translate-x-0 z-50 pointer-events-none">
        <img
          src={INCLINE_LOGO}
          alt="INCLINE"
          width={224}
          height={128}
          decoding="async"
          {...({ fetchpriority: 'high' } as Record<string, string>)}
          className="h-16 sm:h-20 md:h-28 w-auto brightness-0"
        />
      </div>

      {/*
        Static SEO hero — paints instantly for LCP / crawlers.
        The 3D Canvas mounts on top (z-0 + fixed) and visually covers this
        layer once ready, so users see no change. The H1 text matches the
        Scroll overlay exactly to avoid any visual mismatch during handoff.
      */}
      <section
        aria-hidden={mountScene}
        className="fixed inset-0 -z-10 flex items-center px-4 pointer-events-none"
        style={{ height: '100dvh' }}
      >
        <div className="w-full max-w-7xl mx-auto flex justify-end">
          <div className="max-w-md text-right mr-8 md:mr-32">
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-black text-foreground leading-tight mb-6 tracking-tight">
              WHERE <span className="text-primary">GLOBAL STRENGTH</span>
              <br />
              MEETS <span className="text-primary">CLINICAL SERENITY.</span>
            </h1>
            <p className="text-muted-foreground text-base leading-relaxed">
              Rajasthan's new benchmark for excellence. An elevated sanctuary designed for the driven—delivering Italian
              biomechanics in every rep, and advanced restoration in every recovery.
            </p>
          </div>
        </div>
      </section>

      {mountScene && (
        <Suspense fallback={null}>
          <Scene3D onScrollProgress={onScrollProgress} />
        </Suspense>
      )}

      {/* Crawlable, static branches & FAQ. Visually hidden from the 3D
          experience but available to bots, screen readers, and AI crawlers. */}
      <div className="sr-only" aria-hidden="false">
        <section aria-labelledby="branches-heading">
          <h2 id="branches-heading">Our Branches & Services</h2>
          {PUBLIC_BRANCHES.map(b => (
            <article key={b.slug}>
              <h3>{b.name}</h3>
              <p>{b.address}</p>
              <p>Hours: {b.hours}</p>
              <h4>Facilities</h4>
              <ul>{b.facilities.map(f => <li key={f}>{f}</li>)}</ul>
              <h4>Group Classes</h4>
              <ul>{b.classes.map(c => <li key={c}>{c}</li>)}</ul>
              {b.pt && <p>Personal training available.</p>}
              <h4>Premium Add-ons</h4>
              <ul>{b.addOns.map(a => <li key={a}>{a}</li>)}</ul>
            </article>
          ))}
        </section>
        <section aria-labelledby="faq-heading">
          <h2 id="faq-heading">Frequently Asked Questions</h2>
          {PUBLIC_FAQS.map(f => (
            <div key={f.q}>
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          ))}
        </section>
      </div>

      {mountModals && (
        <Suspense fallback={null}>
          <RegisterModal />
          <LegalModal />
        </Suspense>
      )}
    </div>
  );
};

export default InclineAscent;
