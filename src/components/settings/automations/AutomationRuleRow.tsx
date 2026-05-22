import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Clock, Play, Pencil, MoreVertical, Sparkles, Lock, ExternalLink, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';
import { describeCron } from '@/lib/automations/cronHumanize';
import { type AutomationRule, type AutomationRun, RULE_DEEP_LINKS } from './types';

interface Props {
  rule: AutomationRule;
  recentRuns: AutomationRun[];
  onToggle: (active: boolean) => void;
  onRunNow: () => void;
  onEdit: () => void;
  onFocusRail: () => void;
}

export function AutomationRuleRow({ rule, recentRuns, onToggle, onRunNow, onEdit, onFocusRail }: Props) {
  const deepLink = RULE_DEEP_LINKS[rule.key];
  const sparkline = recentRuns.slice(0, 10).reverse();

  return (
    <div className="py-3 flex items-center gap-4 group">
      {/* Status dot */}
      <div
        className={`h-2.5 w-2.5 rounded-full shrink-0 ${
          !rule.is_active
            ? 'bg-slate-300'
            : rule.last_status === 'error'
              ? 'bg-rose-500 animate-pulse'
              : rule.last_status === 'success'
                ? 'bg-emerald-500'
                : 'bg-slate-300'
        }`}
        aria-hidden
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-slate-900 truncate">{rule.name}</p>
          {rule.use_ai && (
            <Badge className="bg-violet-100 text-violet-700 gap-1 hover:bg-violet-100">
              <Sparkles className="h-3 w-3" /> AI
            </Badge>
          )}
          {rule.is_system && (
            <Badge variant="outline" className="gap-1 text-slate-500 border-slate-200">
              <Lock className="h-3 w-3" /> System
            </Badge>
          )}
          {rule.last_status === 'error' && (
            <Badge className="bg-rose-100 text-rose-700 gap-1 hover:bg-rose-100">
              <AlertTriangle className="h-3 w-3" /> Failing
            </Badge>
          )}
        </div>
        {rule.description && (
          <p className="text-xs text-slate-500 mt-0.5 truncate">{rule.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {describeCron(rule.cron_expression)}
          </span>
          {rule.last_run_at && (
            <span>· Last {formatDistanceToNow(new Date(rule.last_run_at), { addSuffix: true })}</span>
          )}
          <span>· Next {formatDistanceToNow(new Date(rule.next_run_at), { addSuffix: true })}</span>
          {rule.last_error && (
            <span className="text-rose-600 truncate max-w-[260px]" title={rule.last_error}>
              · {rule.last_error}
            </span>
          )}
        </div>
      </div>

      {/* Sparkline of last 10 runs */}
      {sparkline.length > 0 && (
        <button
          onClick={onFocusRail}
          aria-label="Show recent runs"
          className="hidden md:flex items-end gap-0.5 h-6 px-1 rounded hover:bg-slate-100"
        >
          {sparkline.map((r) => (
            <span
              key={r.id}
              title={`${r.status} · ${r.dispatched_count} dispatched`}
              className={`w-1 rounded-sm ${
                r.status === 'success'
                  ? 'bg-emerald-400 h-4'
                  : r.status === 'error'
                    ? 'bg-rose-400 h-5'
                    : 'bg-slate-300 h-2'
              }`}
            />
          ))}
        </button>
      )}

      <Switch
        checked={rule.is_active}
        onCheckedChange={onToggle}
        aria-label={`${rule.is_active ? 'Disable' : 'Enable'} ${rule.name}`}
      />

      <Button size="sm" variant="outline" className="rounded-xl hidden sm:inline-flex" onClick={onRunNow}>
        <Play className="h-4 w-4 mr-1" /> Run
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="rounded-xl" aria-label="More actions">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-xl">
          <DropdownMenuItem onClick={onRunNow}>
            <Play className="h-4 w-4 mr-2" /> Run now
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFocusRail}>
            <Clock className="h-4 w-4 mr-2" /> View runs
          </DropdownMenuItem>
          {deepLink && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={deepLink.href}>
                  <ExternalLink className="h-4 w-4 mr-2" /> {deepLink.label}
                </Link>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
