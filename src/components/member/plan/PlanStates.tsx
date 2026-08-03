import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, FileText, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Page-level skeleton matching the plan page layout. */
export function PlanPageSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <Skeleton className="h-44 w-full rounded-2xl" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    </div>
  );
}

interface PlanEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  primaryLabel: string;
  primaryTo: string;
  secondary?: { label: string; to: string };
}

/** Shared empty state for "no plan assigned yet". */
export function PlanEmptyState({
  icon,
  title,
  description,
  primaryLabel,
  primaryTo,
  secondary,
}: PlanEmptyStateProps) {
  return (
    <Card className="rounded-2xl border-dashed">
      <CardContent className="py-16 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          {icon}
        </div>
        <h3 className="mb-2 text-xl font-semibold">{title}</h3>
        <CardDescription className="mx-auto mb-6 max-w-md">{description}</CardDescription>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link to={primaryTo}>{primaryLabel}</Link>
          </Button>
          {secondary && (
            <Button asChild size="lg" variant="outline">
              <Link to={secondary.to}>{secondary.label}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Shared PDF-backed plan viewer card. */
export function PlanPdfCard({
  url,
  filename,
  fallbackTitle,
}: {
  url: string;
  filename?: string | null;
  fallbackTitle: string;
}) {
  return (
    <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base">{filename || fallbackTitle}</CardTitle>
            <CardDescription className="text-xs">
              Tap download if the preview doesn't load
            </CardDescription>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer" download>
            <Download className="mr-1.5 h-4 w-4" /> Download
          </a>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <iframe src={url} title={filename || fallbackTitle} className="h-[80vh] w-full border-0" />
      </CardContent>
    </Card>
  );
}

/** Shared tips card. */
export function PlanTipsCard({ title, tips }: { title: string; tips: string[] }) {
  return (
    <Card className="rounded-2xl border-border/60 bg-gradient-to-br from-muted/40 to-background">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-accent" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2.5 text-sm text-muted-foreground sm:grid-cols-2">
          {tips.map((tip) => (
            <div key={tip} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{tip}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
