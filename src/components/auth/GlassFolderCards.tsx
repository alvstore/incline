import { useId, useRef, useState } from 'react';
import { ArrowUpRight, Activity, Snowflake, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import clubImage from '@/assets/registration-hero-v2.jpg';

export interface FolderFile {
  name: string;
  summary: string;
  icon: typeof Activity;
}

const FILES: FolderFile[] = [
  { name: 'Rise', summary: 'Panatta strength, personal training and group classes.', icon: ArrowUpRight },
  { name: 'Reflect', summary: 'Infrared sauna, cold plunge and steam recovery.', icon: Snowflake },
  { name: 'Repeat', summary: '3D body scans and a clearer picture of your progress.', icon: Activity },
];

/** Reference-inspired folder: finite CSS motion, no canvas or blur near inputs. */
export function GlassFolderCards() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const contentsId = useId();
  const current = FILES[selected] ?? FILES[0];

  return (
    <div className="auth-dossier" data-open={open} onKeyDown={(event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }}>
      <div className="auth-folder-stage">
        <div className="auth-folder-back" aria-hidden="true">
          <img src={clubImage} alt="" width={1280} height={1600} className="h-full w-full object-cover" />
        </div>
        <div id={contentsId} className="auth-folder-files" aria-label="The Incline experience">
          {FILES.map(({ name, icon: Icon }, index) => (
            <Button key={name} type="button" variant="ghost"
              tabIndex={open ? 0 : -1} aria-hidden={!open} aria-pressed={selected === index}
              className={`auth-folder-file auth-folder-file-${index + 1} cursor-pointer`}
              onClick={() => setSelected(index)}>
              <span className="flex w-full items-center justify-between text-xs">
                <span>0{index + 1}</span><Icon className="h-5 w-5" />
              </span>
              <span className="mt-auto text-lg font-semibold">{name}</span>
            </Button>
          ))}
        </div>
        <Button ref={toggleRef} type="button" variant="ghost" className="auth-folder-front cursor-pointer"
          aria-expanded={open} aria-controls={contentsId} aria-label={open ? 'Close the Incline experience folder' : 'Open the Incline experience folder'}
          onClick={() => setOpen(!open)}>
          <span className="flex w-full items-start justify-between">
            <span className="text-xs font-medium uppercase">The Incline Life</span>
            <ChevronDown className="h-5 w-5 transition-transform duration-200" />
          </span>
          <span className="mt-auto flex w-full items-end justify-between text-left">
            <span><span className="block text-2xl font-semibold">Your next chapter.</span><span className="mt-2 block text-sm">Rise. Reflect. Repeat.</span></span>
            <ArrowUpRight className="h-6 w-6 shrink-0" />
          </span>
        </Button>
      </div>
      <div className="auth-folder-caption" aria-live="polite">
        <p className="text-sm font-semibold text-sidebar-foreground">{current.name}</p>
        <p className="mt-1 text-sm leading-relaxed text-sidebar-foreground/80">{current.summary}</p>
      </div>
    </div>
  );
}