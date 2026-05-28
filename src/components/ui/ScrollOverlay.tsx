import {
  ChevronDown, Instagram, Dumbbell, Snowflake, Flame, Target, Wind, Car, Clock, Award, Layers, Lock, Coffee
} from "lucide-react";

// NOTE: The logo + hero copy were lifted out of this overlay into
// <InclineAscent> so they paint immediately, before the lazy Three.js
// bundle finishes downloading. Do not re-add the logo here.

const ScrollOverlay = () => {
  return (
    <div className="w-full">

      {/* Section 1: Hero */}
      <section className="h-[100dvh] flex items-center relative px-4">
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
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <span className="text-sm tracking-widest uppercase font-bold text-primary animate-pulse text-center">
            BEGIN YOUR ASCENT • 2026
          </span>
          <ChevronDown className="w-6 h-6 scroll-indicator text-primary animate-bounce" />
        </div>
      </section>

      {/* Section 2: Strength Arsenal */}
      <section className="h-[100dvh] flex items-center px-4">
        <div className="w-full max-w-7xl mx-auto flex justify-start">
          <div className="glass p-8 md:p-12 rounded-3xl max-w-md fade-in-up shadow-2xl border border-border/50 ml-4 md:ml-16">
            <div className="flex items-center gap-3 mb-4">
              <Dumbbell className="w-5 h-5 text-primary" />
              <span className="text-primary text-sm tracking-[0.3em] uppercase font-bold">The Strength Arsenal</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-foreground tracking-tight">
              BIO-MECHANICAL<br /><span className="text-primary">DOMINANCE.</span>
            </h2>
            <p className="text-muted-foreground mt-4 text-base leading-relaxed text-justify">
              A curated fleet of 50+ Machines. Experience the Italian precision of{" "}
              <span className="font-semibold text-foreground">Panatta</span>, the raw power of{" "}
              <span className="font-semibold text-foreground">Real Leader USA</span>, the original{" "}
              <span className="font-semibold text-foreground">Booty Builder</span>, and the endurance technology of{" "}
              <span className="font-semibold text-foreground">Relax</span>.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-2">
              <div className="glass p-3 rounded-xl text-center hover:scale-105 transition-transform duration-300">
                <Dumbbell className="w-5 h-5 text-primary mx-auto mb-2" />
                <div className="text-lg font-black text-foreground">50+ Stations</div>
                <div className="text-xs text-muted-foreground mt-1">Global Import Series</div>
              </div>
              <div className="glass p-3 rounded-xl text-center hover:scale-105 transition-transform duration-300">
                <Clock className="w-5 h-5 text-primary mx-auto mb-2" />
                <div className="text-lg font-black text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.8)]">Full Day Access</div>
                <div className="text-xs text-muted-foreground mt-1">24-Hour Daily Access</div>
              </div>
              <div className="glass p-3 rounded-xl text-center hover:scale-105 transition-transform duration-300">
                <Award className="w-5 h-5 text-primary mx-auto mb-2" />
                <div className="text-lg font-black text-foreground">100% Original</div>
                <div className="text-xs text-muted-foreground mt-1">Official Equipment Partners</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Recovery */}
      <section className="h-[100dvh] flex items-center px-4">
        <div className="w-full max-w-7xl mx-auto flex justify-end">
          <div className="glass p-8 md:p-12 rounded-3xl max-w-md fade-in-up shadow-2xl border border-border/50 mr-4 md:mr-16">
            <div className="flex items-center gap-3 mb-4">
              <Snowflake className="w-5 h-5 text-primary" />
              <span className="text-primary text-sm tracking-[0.3em] uppercase font-bold">Recovery Science</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-foreground tracking-tight">
              CLINICAL RECOVERY<br /><span className="text-primary">& MOVEMENT.</span>
            </h2>
            <p className="text-muted-foreground mt-4 text-base leading-relaxed">
              The complete restoration ecosystem. From{" "}
              <span className="font-semibold text-foreground">7-wavelength Infrared heat</span> to{" "}
              <span className="font-semibold text-foreground">precision core alignment</span>.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="glass p-3 rounded-xl hover:scale-105 transition-transform duration-300">
                <div className="flex items-center gap-2 mb-1">
                  <Snowflake className="w-4 h-4 text-primary" />
                  <span className="text-foreground font-bold text-sm">ICE BATH</span>
                </div>
                <div className="text-xs text-muted-foreground">Precision Cold Exposure.</div>
              </div>
              <div className="glass p-3 rounded-xl hover:scale-105 transition-transform duration-300">
                <div className="flex items-center gap-2 mb-1">
                  <Flame className="w-4 h-4 text-primary" />
                  <span className="text-foreground font-bold text-sm">INFRARED SAUNA</span>
                </div>
                <div className="text-xs text-muted-foreground">7-Wavelength Restoration</div>
              </div>
              <div className="glass p-3 rounded-xl hover:scale-105 transition-transform duration-300">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-primary" />
                  <span className="text-foreground font-bold text-sm">PILATES</span>
                </div>
                <div className="text-xs text-muted-foreground">Core Alignment & Stability</div>
              </div>
              <div className="glass p-3 rounded-xl hover:scale-105 transition-transform duration-300">
                <div className="flex items-center gap-2 mb-1">
                  <Wind className="w-4 h-4 text-primary" />
                  <span className="text-foreground font-bold text-sm">MOBILITY ZONE</span>
                </div>
                <div className="text-xs text-muted-foreground">Dynamic Stretching & Decompression.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Lifestyle */}
      <section className="h-[100dvh] flex items-center px-4">
        <div className="w-full max-w-7xl mx-auto flex justify-start">
          <div className="glass p-8 md:p-12 rounded-3xl max-w-md fade-in-up shadow-2xl border border-border/50 ml-4 md:ml-16">
            <div className="flex items-center gap-3 mb-4">
              <Layers className="w-5 h-5 text-primary" />
              <span className="text-primary text-sm tracking-[0.3em] uppercase font-bold">The Lifestyle</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-foreground tracking-tight">
              UDAIPUR'S FIRST<br /><span className="text-primary">FITNESS-CLUB.</span>
            </h2>
            <p className="text-muted-foreground mt-4 text-base leading-relaxed text-justify">
              The city's largest training facility spanning{" "}
              <span className="font-semibold text-foreground">Two Dedicated Floors</span>. Massive scale. Unrivaled
              technology. Space to breathe, space to conquer.
            </p>
            <div className="mt-6 grid grid-cols-4 gap-2">
              <div className="glass p-3 rounded-xl text-center hover:scale-105 transition-transform duration-300">
                <Layers className="w-5 h-5 text-primary mx-auto mb-2" />
                <div className="text-sm font-black text-foreground">2 FLOORS</div>
                <div className="text-xs text-muted-foreground mt-1">Dedicated Zoning</div>
              </div>
              <div className="glass p-3 rounded-xl text-center hover:scale-105 transition-transform duration-300">
                <Lock className="w-5 h-5 text-primary mx-auto mb-2" />
                <div className="text-sm font-black text-foreground">DIGITAL LOCKERS</div>
                <div className="text-xs text-muted-foreground mt-1">Keyless Security</div>
              </div>
              <div className="glass p-3 rounded-xl text-center hover:scale-105 transition-transform duration-300">
                <Coffee className="w-5 h-5 text-primary mx-auto mb-2" />
                <div className="text-sm font-black text-foreground">FUEL BAR</div>
                <div className="text-xs text-muted-foreground mt-1">In-House Nutrition</div>
              </div>
              <div className="glass p-3 rounded-xl text-center hover:scale-105 transition-transform duration-300">
                <Car className="w-5 h-5 text-primary mx-auto mb-2" />
                <div className="text-sm font-black text-foreground">PARKING</div>
                <div className="text-xs text-muted-foreground mt-1">Dedicated Slots</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 5: Waitlist CTA */}
      <section className="h-[100dvh] flex flex-col justify-between relative px-4 pt-20 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto">
        <div className="flex-1 flex items-center">
          <div className="w-full max-w-7xl mx-auto flex justify-end">
            <div className="glass-strong p-8 md:p-12 rounded-3xl max-w-sm shadow-2xl border border-primary/20 mr-4 md:mr-16">
              <span className="text-primary text-sm tracking-[0.3em] uppercase font-bold">Exclusive Access</span>
              <h2 className="text-3xl md:text-4xl font-black text-foreground mt-4 tracking-tight">
                JOIN THE<br /><span className="text-primary">WAITLIST</span>
              </h2>
              <p className="text-muted-foreground mt-4 text-base leading-relaxed">
                Be among the first to experience INCLINE. Limited founding memberships with exclusive benefits.
              </p>
              <button
                className="mt-8 w-full px-8 py-4 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base tracking-wider uppercase rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-[1.02]"
                onClick={() => window.dispatchEvent(new CustomEvent("open-register-modal"))}
              >
                Join Waitlist
              </button>
            </div>
          </div>
        </div>
        <footer className="flex flex-col items-center gap-4 pb-2">
          <a
            href="https://www.instagram.com/theinclinelife/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors group"
          >
            <Instagram className="w-5 h-5 group-hover:scale-110 transition-transform" />
            <span className="text-sm tracking-wider font-medium">@theinclinelife</span>
          </a>

          <nav
            aria-label="Legal"
            className="flex items-center gap-1.5 sm:gap-2 rounded-full border border-primary/20 bg-card/40 backdrop-blur-md px-2 py-1.5 shadow-lg shadow-primary/5"
          >
            {[
              { key: "privacy",  label: "Privacy" },
              { key: "terms",    label: "Terms" },
              { key: "deletion", label: "Data Deletion" },
            ].map((item, i, arr) => (
              <span key={item.key} className="flex items-center">
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("open-legal-modal", { detail: item.key })
                    )
                  }
                  className="px-3 py-1 rounded-full text-xs font-semibold tracking-wide text-muted-foreground hover:text-primary-foreground hover:bg-primary transition-all duration-200 cursor-pointer"
                >
                  {item.label}
                </button>
                {i < arr.length - 1 && (
                  <span aria-hidden="true" className="text-primary/30 select-none">·</span>
                )}
              </span>
            ))}
          </nav>

          <p className="text-muted-foreground/50 text-xs tracking-wider text-center px-4">
            © 2026 The Incline Life by Incline. All rights reserved.
          </p>
        </footer>
      </section>
    </div>
  );
};

export default ScrollOverlay;
