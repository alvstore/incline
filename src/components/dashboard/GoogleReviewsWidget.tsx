import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Star, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

interface ReviewRow {
  id: string;
  author_name: string | null;
  rating: number | null;
  review_text: string | null;
  posted_at: string | null;
  reply_status: string | null;
}

interface Props {
  branchId?: string;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

export default function GoogleReviewsWidget({ branchId }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-google-reviews', branchId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('google_reviews_inbound')
        .select('id, author_name, rating, review_text, posted_at, reply_status')
        .order('posted_at', { ascending: false, nullsFirst: false })
        .limit(5);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
    staleTime: 60_000,
  });

  const reviews = data ?? [];
  const avg =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + (r.rating ?? 0), 0) / reviews.filter((r) => r.rating != null).length
      : 0;

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Star className="h-5 w-5 text-amber-500" aria-hidden />
          Google Reviews
          {reviews.length > 0 && (
            <span className="ml-auto text-sm font-bold text-slate-900">{avg.toFixed(1)}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-slate-500">Could not load reviews.</p>
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-slate-500">
              No reviews synced yet. Connect Google Business Profile to pull reviews in automatically.
            </p>
            <Button asChild size="sm" variant="outline" className="cursor-pointer">
              <Link to="/feedback">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Open Reviews Hub
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {r.author_name || 'Google user'}
                  </span>
                  <Stars rating={r.rating ?? 0} />
                </div>
                {r.review_text && (
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-600">{r.review_text}</p>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">
                    {r.posted_at ? format(new Date(r.posted_at), 'dd MMM yyyy') : '—'}
                  </span>
                  {r.reply_status !== 'replied' && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      Needs reply
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
