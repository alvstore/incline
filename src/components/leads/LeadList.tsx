import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserPlus, Phone, MessageSquare, Calendar, ArrowRight, ChevronLeft, ChevronRight, Flame, Sun, Snowflake, Tag, Users, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leadService } from '@/services/leadService';
import { communicationService } from '@/services/communicationService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { STATUS_CONFIG, LEAD_STATUSES } from './LeadFilters';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadSourceBadge } from './LeadSourceBadge';

const PAGE_SIZE = 50;

interface LeadListProps {
  leads: any[];
  isLoading: boolean;
  page: number;
  onPageChange: (page: number) => void;
  onSelectLead: (lead: any) => void;
  onFollowup: (lead: any) => void;
  onConvert: (lead: any) => void;
}

export function LeadList({ leads, isLoading, page, onPageChange, onSelectLead, onFollowup, onConvert }: LeadListProps) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const paginatedLeads = leads.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(leads.length / PAGE_SIZE);

  const { data: staffMembers = [] } = useQuery({
    queryKey: ['staff-for-assignment'],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_roles')
        .select('user_id, role, profiles:user_id(id, full_name, avatar_url)')
        .in('role', ['owner', 'admin', 'manager', 'staff'] as any);
      if (!data) return [];
      const unique = new Map<string, any>();
      data.forEach((r: any) => {
        if (r.profiles && !unique.has(r.user_id)) {
          unique.set(r.user_id, { id: r.user_id, full_name: r.profiles.full_name, avatar_url: r.profiles.avatar_url });
        }
      });
      return Array.from(unique.values());
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ leadId, ownerId }: { leadId: string; ownerId: string | null }) =>
      leadService.assignLead(leadId, ownerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead assigned');
    },
    onError: () => toast.error('Failed to assign lead'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      leadService.updateLeadStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Failed to update status'),
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: ({ ids, updates }: { ids: string[]; updates: any }) =>
      leadService.bulkUpdateLeads(ids, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      setSelectedIds(new Set());
      toast.success(`Updated ${selectedIds.size} leads`);
    },
    onError: () => toast.error('Bulk update failed'),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === paginatedLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedLeads.map((l: any) => l.id)));
    }
  };

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg shadow-primary/5">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>All Leads ({leads.length})</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <div className="flex gap-2 flex-wrap">
              {LEAD_STATUSES.map(s => (
                <Button key={s} size="sm" variant="outline" className="h-7 text-xs rounded-lg"
                  onClick={() => bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), updates: { status: s } })}
                >
                  {STATUS_CONFIG[s].label}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={paginatedLeads.length > 0 && selectedIds.size === paginatedLeads.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Temp</TableHead>
                  <TableHead>Source</TableHead>
                   <TableHead>Score</TableHead>
                   <TableHead>Owner</TableHead>
                   <TableHead>Created</TableHead>
                   <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedLeads.map((lead: any) => {
                  const TempIcon = lead.temperature === 'hot' ? Flame : lead.temperature === 'cold' ? Snowflake : Sun;
                  const tempColor = lead.temperature === 'hot' ? 'text-destructive' : lead.temperature === 'cold' ? 'text-info' : 'text-warning';
                  const isOverdue = lead.next_action_at && new Date(lead.next_action_at) < new Date();
                  const isSelected = selectedIds.has(lead.id);

                  return (
                    <TableRow
                      key={lead.id}
                      className={`cursor-pointer hover:bg-muted/50 ${isOverdue ? 'bg-destructive/5' : ''} ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={() => onSelectLead(lead)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(lead.id)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-sm font-bold text-primary">
                              {lead.full_name?.charAt(0)?.toUpperCase() || '?'}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{lead.full_name}</div>
                            {lead.tags?.length > 0 && (
                              <div className="flex gap-1 mt-0.5">
                                {lead.tags.slice(0, 2).map((t: string) => (
                                  <span key={t} className="text-[10px] bg-muted rounded px-1">{t}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{lead.phone}</div>
                        {lead.email && <div className="text-xs text-muted-foreground truncate max-w-[150px]">{lead.email}</div>}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Select value={lead.status} onValueChange={(s) => updateStatusMutation.mutate({ id: lead.id, status: s })}>
                          <SelectTrigger className="w-32 h-8">
                            <Badge className={`${STATUS_CONFIG[lead.status]?.color || 'bg-muted'} text-xs`}>
                              {STATUS_CONFIG[lead.status]?.label || lead.status}
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {LEAD_STATUSES.map(s => (
                              <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <TempIcon className={`h-4 w-4 ${tempColor}`} />
                      </TableCell>
                      <TableCell>
                        <LeadSourceBadge source={lead.source} className="max-w-[140px] truncate" />
                      </TableCell>
                      <TableCell>
                        {lead.score > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <Progress value={lead.score} className="w-10 h-1.5" />
                            <span className="text-xs text-muted-foreground">{lead.score}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1.5">
                              {lead.owner_id ? (
                                <>
                                  <Avatar className="h-5 w-5">
                                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                                      {staffMembers.find((s: any) => s.id === lead.owner_id)?.full_name?.charAt(0)?.toUpperCase() || '?'}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="truncate max-w-[60px]">{staffMembers.find((s: any) => s.id === lead.owner_id)?.full_name || 'Assigned'}</span>
                                </>
                              ) : (
                                <>
                                  <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-muted-foreground">Assign</span>
                                </>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-48 p-1" align="start">
                            <div className="space-y-0.5 max-h-48 overflow-y-auto">
                              <Button size="sm" variant="ghost" className="w-full justify-start h-7 text-xs text-muted-foreground"
                                onClick={() => assignMutation.mutate({ leadId: lead.id, ownerId: null })}>
                                Unassign
                              </Button>
                              {staffMembers.map((staff: any) => (
                                <Button key={staff.id} size="sm" variant={lead.owner_id === staff.id ? 'secondary' : 'ghost'}
                                  className="w-full justify-start h-7 text-xs gap-2"
                                  onClick={() => assignMutation.mutate({ leadId: lead.id, ownerId: staff.id })}>
                                  <Avatar className="h-4 w-4">
                                    <AvatarFallback className="text-[8px]">{staff.full_name?.charAt(0)?.toUpperCase()}</AvatarFallback>
                                  </Avatar>
                                  <span className="truncate">{staff.full_name}</span>
                                </Button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(lead.created_at), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {lead.phone && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => communicationService.sendWhatsApp(lead.phone, `Hi ${lead.full_name}!`)}>
                              <MessageSquare className="h-3.5 w-3.5 text-success" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => window.open(`tel:${lead.phone}`)}>
                            <Phone className="h-3.5 w-3.5 text-info" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onFollowup(lead)}>
                            <Calendar className="h-3.5 w-3.5" />
                          </Button>
                          {lead.status !== 'converted' && (
                            <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={() => onConvert(lead)}>
                              <ArrowRight className="h-3 w-3 mr-1" /> Convert
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {paginatedLeads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      No leads found matching your filters
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">Page {page + 1} of {totalPages} ({leads.length} leads)</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPageChange(page - 1)} className="rounded-lg">
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)} className="rounded-lg">
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
