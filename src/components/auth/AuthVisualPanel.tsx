import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MapPin } from "lucide-react";
import heroImg from "@/assets/auth-hero-athlete.jpg";
import riseImg from "@/assets/auth-rise.jpg";
import reflectImg from "@/assets/auth-reflect.jpg";
import repeatImg from "@/assets/auth-repeat.jpg";

const CARDS = [
  { id: "rise", title: "Rise.", text: "Panatta strength floor & personal training", img: riseImg },
  { id: "reflect", title: "Reflect.", text: "Infrared sauna, ice bath & recovery lounge", img: reflectImg },
  { id: "repeat", title: "Repeat.", text: "3D body scans that track every milestone", img: repeatImg },
];

/** Photo panel with an animated, tappable Rise/Reflect/Repeat card stack. */
export function AuthVisualPanel() {
  const [order, setOrder] = useState(CARDS.map((_, i) => i));
  const reduce = useReducedMotion();
  const next = () => setOrder((o) => [...o.slice(1), o[0]]);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(next, 4500);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <aside className="relative isolate h-56 overflow-hidden rounded-3xl bg-sidebar sm:h-64 lg:h-full lg:min-h-[560px]" aria-label="The Incline Life">
      <img src={heroImg} alt="" width={1024} height={1280} className="absolute inset-0 h-full w-full object-cover object-[50%_20%] opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/50 to-sidebar/10" aria-hidden="true" />

      <div className="relative flex h-full flex-col justify-end p-4 sm:p-6">
        <div className="relative mx-auto h-36 w-full max-w-sm sm:h-40 lg:h-56">
          <AnimatePresence initial={false}>
            {order.map((cardIdx, pos) => {
              const c = CARDS[cardIdx];
              const top = pos === 0;
              return (
                <motion.button
                  type="button"
                  key={c.id}
                  onClick={top ? next : undefined}
                  drag={top && !reduce ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  onDragEnd={(_, i) => { if (Math.abs(i.offset.x) > 80) next(); }}
                  aria-label={top ? `${c.title} ${c.text}. Show next` : undefined}
                  tabIndex={top ? 0 : -1}
                  className="absolute inset-x-0 bottom-0 h-full overflow-hidden rounded-2xl border border-sidebar-foreground/15 text-left shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ zIndex: CARDS.length - pos, cursor: top ? "grab" : "default" }}
                  initial={false}
                  animate={{ y: pos * -14, scale: 1 - pos * 0.06, rotate: pos === 0 ? 0 : pos % 2 ? -2.5 : 2.5, opacity: 1 - pos * 0.2 }}
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 26 }}
                >
                  <img src={c.img} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-sidebar/95 via-sidebar/40 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="text-2xl font-bold tracking-tight text-sidebar-foreground">{c.title}</p>
                    <p className="text-xs text-sidebar-foreground/80">{c.text}</p>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden="true">
            {CARDS.map((c, i) => (
              <span key={c.id} className={`h-1.5 rounded-full transition-all duration-300 ${order[0] === i ? "w-6 bg-primary" : "w-1.5 bg-sidebar-foreground/40"}`} />
            ))}
          </div>
          <p className="hidden items-center gap-1.5 text-xs text-sidebar-foreground/85 sm:flex">
            <MapPin className="h-3.5 w-3.5" /> Sector 14, Udaipur
          </p>
        </div>
      </div>
    </aside>
  );
}

export default AuthVisualPanel;
