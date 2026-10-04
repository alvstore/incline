import { useEffect, useState } from 'react';
import {
  Home, Dumbbell, QrCode, Waves, User, Flame, MapPin, Play, Clock, Check,
  Snowflake, ThermometerSun, CloudFog, ChevronRight, ScanLine, Timer, Plus, Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Screen = 'home' | 'workout' | 'pass' | 'recovery' | 'profile';

const tabs: { id: Screen; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'workout', label: 'Workout', icon: Dumbbell },
  { id: 'pass', label: 'Pass', icon: QrCode },
  { id: 'recovery', label: 'Recovery', icon: Waves },
  { id: 'profile', label: 'Profile', icon: User },
];

function HomeScreen({ go }: { go: (s: Screen) => void }) {
  const week = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Good evening</p>
          <h2 className="text-lg font-bold text-foreground">Mohit Gurjar</h2>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><MapPin size={12} /> Sector 14, Udaipur</p>
        </div>
        <button aria-label="Notifications" className="flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-md"><Bell size={18} className="text-primary" /></button>
      </div>

      <div className="rounded-2xl bg-theme-gradient p-4 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-white/80"><Flame size={14} /> 4-day streak</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px]">Club 42% busy</span>
        </div>
        <div className="mt-3 flex justify-between">
          {week.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold', i < 4 ? 'bg-white text-primary' : 'bg-white/15')}>
                {i < 4 ? <Check size={14} /> : d}
              </div>
              <span className="text-[10px] text-white/80">{d}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's workout</p>
        <h3 className="mt-1 font-bold text-foreground">Push Day · Chest & Delts</h3>
        <p className="text-xs text-muted-foreground">6 exercises · 55 min · Coach Bhagirath</p>
        <button onClick={() => go('workout')} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
          <Play size={16} /> Start workout
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { l: 'Pass', i: QrCode, s: 'pass' as Screen },
          { l: 'Recovery', i: Waves, s: 'recovery' as Screen },
          { l: 'Classes', i: Clock, s: 'home' as Screen },
          { l: '3D Scan', i: ScanLine, s: 'profile' as Screen },
        ].map(({ l, i: I, s }) => (
          <button key={l} onClick={() => go(s)} className="flex flex-col items-center gap-1 rounded-2xl bg-card py-3 shadow-md">
            <span className="rounded-full bg-primary/10 p-2 text-primary"><I size={16} /></span>
            <span className="text-[10px] font-medium text-foreground">{l}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-md">
        <span className="rounded-full bg-primary/10 p-2 text-primary"><Snowflake size={16} /></span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Ice Bath</p>
          <p className="text-[11px] text-muted-foreground">Tomorrow · 7:30 AM</p>
        </div>
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-medium text-emerald-700">Booked</span>
      </div>
    </div>
  );
}

function PassScreen() {
  const [sec, setSec] = useState(30);
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => (s <= 1 ? 30 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const cells = Array.from({ length: 121 }, (_, i) => ((i * 7919 + sec * 31) % 5) < 2);
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl bg-theme-gradient p-5 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/80">The Incline Life</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">FOUNDER'S PASS</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 font-bold">MG</div>
          <div>
            <p className="font-bold">Mohit Gurjar</p>
            <p className="text-xs text-white/80">INC-26-0025</p>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-white/80">Valid till 31 Jul 2027</p>
      </div>

      <div className="relative mx-auto w-fit rounded-2xl bg-card p-4 shadow-lg">
        <div className="grid grid-cols-11 gap-[2px]">
          {cells.map((on, i) => <div key={i} className={cn('h-4 w-4 rounded-[2px]', on ? 'bg-foreground' : 'bg-transparent')} />)}
        </div>
        <div className="pointer-events-none absolute inset-x-4 top-4 h-0.5 animate-pulse bg-primary" />
      </div>
      <p className="text-center text-xs text-muted-foreground">Code refreshes in {sec}s</p>

      <button
        onClick={() => { setTapped(true); setTimeout(() => setTapped(false), 2000); }}
        className={cn('flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors', tapped ? 'bg-emerald-500 text-white' : 'bg-primary text-primary-foreground')}
      >
        {tapped ? <><Check size={16} /> Gate open — welcome!</> : 'Simulate gate tap'}
      </button>
    </div>
  );
}

function WorkoutScreen() {
  const [sets, setSets] = useState<boolean[]>([true, true, false, false]);
  const [rest, setRest] = useState(0);
  useEffect(() => {
    if (rest <= 0) return;
    const t = setTimeout(() => setRest((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [rest]);
  const done = sets.filter(Boolean).length;
  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exercise 2 of 6</p>
        <h2 className="text-lg font-bold text-foreground">Incline Bench Press</h2>
      </div>
      <div className="rounded-2xl bg-card p-3 shadow-lg shadow-slate-200/50">
        {sets.map((d, i) => (
          <div key={i} className="flex items-center justify-between border-b border-border py-2 last:border-0">
            <span className="text-xs text-muted-foreground">Set {i + 1}</span>
            <span className="text-sm font-semibold text-foreground">10 × 40 kg</span>
            <button
              aria-label={`Mark set ${i + 1}`}
              onClick={() => { setSets((s) => s.map((v, j) => (j === i ? !v : v))); if (!d) setRest(90); }}
              className={cn('flex h-9 w-9 items-center justify-center rounded-full', d ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground')}
            ><Check size={16} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 rounded-2xl bg-theme-gradient p-4 text-white shadow-lg">
        <Timer size={24} />
        <div className="flex-1">
          <p className="text-xs text-white/80">Rest timer</p>
          <p className="text-2xl font-bold">{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}</p>
        </div>
        <button onClick={() => setRest((r) => r + 30)} className="flex h-11 items-center gap-1 rounded-xl bg-white/20 px-3 text-xs font-semibold"><Plus size={14} /> 30s</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card p-3 shadow-md"><p className="text-[11px] text-muted-foreground">Sets done</p><p className="text-xl font-bold text-foreground">{done}/{sets.length}</p></div>
        <div className="rounded-2xl bg-card p-3 shadow-md"><p className="text-[11px] text-muted-foreground">Volume</p><p className="text-xl font-bold text-foreground">{done * 400} kg</p></div>
      </div>
    </div>
  );
}

function RecoveryScreen() {
  const facilities = [
    { n: 'Infrared Sauna', i: ThermometerSun, notice: '24h notice', left: 2 },
    { n: 'Ice Bath', i: Snowflake, notice: '24h notice', left: 1 },
    { n: 'Steam', i: CloudFog, notice: '12h notice', left: 4 },
  ];
  const [sel, setSel] = useState(0);
  const [slot, setSlot] = useState<string | null>(null);
  const slots = ['6:00 AM', '7:30 AM', '9:00 AM', '5:00 PM', '6:30 PM', '8:00 PM'];
  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-bold text-foreground">Book recovery</h2>
      <div className="space-y-2">
        {facilities.map((f, idx) => (
          <button key={f.n} onClick={() => { setSel(idx); setSlot(null); }} className={cn('flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-md', sel === idx && 'ring-2 ring-primary')}>
            <span className="rounded-full bg-primary/10 p-2 text-primary"><f.i size={16} /></span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">{f.n}</p>
              <p className="text-[11px] text-muted-foreground">{f.notice} · {f.left} sessions left</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
        ))}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tomorrow</p>
      <div className="grid grid-cols-3 gap-2">
        {slots.map((s, i) => {
          const full = i === 2;
          return (
            <button key={s} disabled={full} onClick={() => setSlot(s)} className={cn('h-11 rounded-xl text-xs font-medium', full ? 'bg-muted text-muted-foreground line-through' : slot === s ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground shadow-md')}>
              {s}
            </button>
          );
        })}
      </div>
      <button disabled={!slot} className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {slot ? `Confirm ${facilities[sel].n} · ${slot}` : 'Pick a time'}
      </button>
    </div>
  );
}

function ProfileScreen() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col items-center gap-2 pt-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-theme-gradient text-2xl font-bold text-white">MG</div>
        <h2 className="font-bold text-foreground">Mohit Gurjar</h2>
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Active</span>
      </div>
      {['3D body scan reports', 'Diet & workout plans', 'Payment history', 'Appearance & theme', 'Help & support'].map((l) => (
        <div key={l} className="flex items-center justify-between rounded-2xl bg-card p-4 shadow-md">
          <span className="text-sm text-foreground">{l}</span><ChevronRight size={16} className="text-muted-foreground" />
        </div>
      ))}
    </div>
  );
}

export default function MobileAppPreview() {
  const [screen, setScreen] = useState<Screen>('home');
  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-8">
      <div className="mx-auto mb-6 max-w-3xl text-center">
        <h1 className="text-2xl font-bold text-slate-900">Incline Member App — Mockup</h1>
        <p className="text-sm text-slate-500">Clickable preview with sample data. Tap the tabs and buttons inside the phone.</p>
      </div>
      <div className="mx-auto w-[375px] max-w-full rounded-[3rem] bg-slate-900 p-3 shadow-2xl">
        <div className="relative flex h-[760px] flex-col overflow-hidden rounded-[2.4rem] bg-background">
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold text-foreground">
            <span>9:41</span>
            <span className="h-6 w-24 rounded-full bg-slate-900" />
            <span>5G</span>
          </div>
          <div className="flex-1 overflow-y-auto pb-24">
            {screen === 'home' && <HomeScreen go={setScreen} />}
            {screen === 'pass' && <PassScreen />}
            {screen === 'workout' && <WorkoutScreen />}
            {screen === 'recovery' && <RecoveryScreen />}
            {screen === 'profile' && <ProfileScreen />}
          </div>
          <nav className="absolute inset-x-0 bottom-0 flex items-end justify-around border-t border-border bg-card px-2 pb-5 pt-2">
            {tabs.map(({ id, label, icon: I }) => {
              const active = screen === id;
              if (id === 'pass') {
                return (
                  <button key={id} aria-label={label} onClick={() => setScreen(id)} className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-theme-gradient text-white shadow-lg">
                    <I size={22} />
                  </button>
                );
              }
              return (
                <button key={id} onClick={() => setScreen(id)} className={cn('flex min-h-11 min-w-11 flex-col items-center gap-0.5 text-[10px]', active ? 'text-primary font-semibold' : 'text-muted-foreground')}>
                  <I size={20} />{label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
