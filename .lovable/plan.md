## Scope
Two small UI fixes on `/register` (`src/pages/PublicRegistration.tsx`).

### 1. Header logo
- Replace the `Dumbbell` icon + hard-coded `"The Incline Life"` / `"Member registration"` text block with the actual brand logo image.
- Import `inclineLogo from "@/assets/incline-logo.png"`.
- Render in a glass chip:
  ```tsx
  <div className="rounded-xl bg-white/10 p-1.5 backdrop-blur-md ring-1 ring-white/15">
    <img src={inclineLogo} alt="The Incline Life" className="h-9 w-9 object-contain" />
  </div>
  ```
- Keep the right-side "Step X of 4" pill unchanged.
- Drop the `Dumbbell` import (still used? check — only header uses it; remove if unused).

### 2. "Choose your home branch" selector
Replace the native `<select>` (which falls back to OS-styled blue list) with a branded tile picker that matches the dark glass aesthetic. Single-select, keyboard accessible.

- Render branches as a responsive grid of clickable cards (1 col on mobile, 2 col `sm:grid-cols-2`):
  ```tsx
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
    {branches?.map((b) => {
      const selected = form.watch("branch_id") === b.id;
      return (
        <button
          type="button"
          key={b.id}
          onClick={() => form.setValue("branch_id", b.id, { shouldValidate: true })}
          aria-pressed={selected}
          className={cn(
            "group flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
            "bg-white/5 hover:bg-white/10 backdrop-blur-md",
            selected
              ? "border-primary ring-2 ring-primary/40 bg-primary/10"
              : "border-white/10"
          )}
        >
          <span className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            selected ? "bg-primary/20 text-primary" : "bg-white/10 text-white/70"
          )}>
            <MapPin className="h-4 w-4" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-white truncate">{b.name}</span>
            {b.city && <span className="block text-xs text-white/60 truncate">{b.city}</span>}
          </span>
          <span className={cn(
            "h-4 w-4 rounded-full border-2 flex items-center justify-center transition",
            selected ? "border-primary bg-primary" : "border-white/30"
          )}>
            {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          </span>
        </button>
      );
    })}
  </div>
  ```
- Loading state: when `branches` is undefined, render 2 skeleton tiles (`<div className="h-[60px] rounded-xl bg-white/5 animate-pulse" />`).
- Keep `form.register("branch_id")` validation via the existing `useForm` + zod — value is set imperatively with `setValue`.
- Error message still rendered by `<Field>`.

### Files touched
- `src/pages/PublicRegistration.tsx` (only)

No backend, schema, or business-logic changes.
