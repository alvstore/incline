import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Phone, MessageSquare, Calendar, ArrowRight, Flame, Sun, Snowflake, UserPlus } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leadService } from '@/services/leadService';
import { communicationService } from '@/services/communicationService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { STATUS_CONFIG, LEAD_STATUSES } from './LeadFilters';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LeadSourceBadge } from './LeadSourceBadge';

interface LeadKanbanProps {
  leads: any[];
  onSelectLead: (lead: any) => void;
  onFollowup: (lead: any) => void;
  onConvert: (lead: any) => void;
}

export function LeadKanban({ leads, onSelectLead, onFollowup, onConvert }: LeadKanbanProps) {
  const queryClient = useQueryClient();
  const [optimisticUpdates, setOptimisticUpdates] = useState<Record<string, string>>({});

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

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      leadService.updateLeadStatus(id, status),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
      setOptimisticUpdates(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.success('Status updated');
    },
    onError: (_, { id }) => {
      setOptimisticUpdates(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.error('Failed to update status');
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

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    const leadId = result.draggableId;
    const lead = leads.find(l => l.id === leadId);
    if (!lead || lead.status === newStatus) return;

    // Optimistic update
    setOptimisticUpdates(prev => ({ ...prev, [leadId]: newStatus }));
    updateStatusMutation.mutate({ id: leadId, status: newStatus });
  };

  const getLeadStatus = (lead: any) => optimisticUpdates[lead.id] || lead.status;

  const handleWhatsApp = (e: React.MouseEvent, phone: string, name: string) => {
    e.stopPropagation();
    communicationService.sendWhatsApp(phone, `Hi ${name}, thanks for your interest!`);
  };

  const getOwnerInfo = (ownerId: string | null) => {
    if (!ownerId) return null;
    return staffMembers.find((s: any) => s.id === ownerId);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {LEAD_STATUSES.map(status => {
          const statusLeads = leads.filter((l: any) => getLeadStatus(l) === status);
          const cfg = STATUS_CONFIG[status];
          return (
            <Droppable droppableId={status} key={status}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`space-y-3 ${snapshot.isDraggingOver ? 'bg-primary/5 rounded-xl p-2 -m-2' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <Badge className={`${cfg.color} rounded-full px-3`}>{cfg.label}</Badge>
                    <span className="text-sm font-bold text-muted-foreground">{statusLeads.length}</span>
                  </div>
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                    {statusLeads.map((lead: any, index: number) => {
                      const TempIcon = lead.temperature === 'hot' ? Flame : lead.temperature === 'cold' ? Snowflake : Sun;
                      const tempColor = lead.temperature === 'hot' ? 'text-destructive' : lead.temperature === 'cold' ? 'text-info' : 'text-warning';
                      const isOverdue = lead.next_action_at && new Date(lead.next_action_at) < new Date();
                      const ACTIVE = ['new', 'contacted', 'qualified', 'negotiation'];
                      const ref = lead.last_contacted_at || lead.created_at;
                      const isStale = ACTIVE.includes(lead.status) && ref &&
                        (Date.now() - new Date(ref).getTime()) > 3 * 24 * 60 * 60 * 1000;
                      const owner = getOwnerInfo(lead.owner_id);

                      return (
                        <Draggable key={lead.id} draggableId={lead.id} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <Card
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={`rounded-xl border-border/50 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                                isOverdue ? 'ring-1 ring-destructive/30' : ''
                              } ${dragSnapshot.isDragging ? 'shadow-lg ring-2 ring-primary/30 rotate-2' : ''}`}
                              onClick={() => onSelectLead(lead)}
                            >
                              <CardContent className="p-3 space-y-2">
                                <div className="flex items-start justify-between gap-1">
                                  <p className="font-semibold text-sm truncate flex-1">{lead.full_name}</p>
                                  <TempIcon className={`h-3.5 w-3.5 shrink-0 ${tempColor}`} />
                                </div>
                                <p className="text-xs text-muted-foreground truncate">{lead.phone || lead.email}</p>

                                {lead.score > 0 && (
                                  <div className="flex items-center gap-1.5">
                                    <Progress value={lead.score} className="h-1 flex-1" />
                                    <span className="text-[10px] text-muted-foreground font-mono">{lead.score}</span>
                                  </div>
                                )}

                                {lead.notes && (
                                  <p className="text-xs text-muted-foreground/80 italic line-clamp-2 bg-muted/30 rounded px-2 py-1">
                                    {lead.notes}
                                  </p>
                                )}

                                <div className="flex items-center justify-between">
                                  <LeadSourceBadge source={lead.source} compact className="max-w-[120px] truncate" />
                                  <span className="text-[10px] text-muted-foreground">
                                    {format(new Date(lead.created_at), 'dd MMM')}
                                  </span>
                                </div>

                                {isOverdue && (
                                  <p className="text-[10px] text-destructive font-medium">
                                    Overdue: {format(new Date(lead.next_action_at), 'MMM dd')}
                                  </p>
                                )}
                                {!isOverdue && isStale && (
                                  <p className="text-[10px] text-warning font-medium bg-warning/10 rounded px-1.5 py-0.5 inline-block">
                                    Stale · no contact in 3+ days
                                  </p>
                                )}

                                {/* Owner + Assign */}
                                <div className="flex items-center justify-between pt-1 border-t border-border/30">
                                  <Popover>
                                    <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1">
                                        {owner ? (
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Avatar className="h-4 w-4">
                                                  <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                                                    {owner.full_name?.charAt(0)?.toUpperCase() || '?'}
                                                  </AvatarFallback>
                                                </Avatar>
                                              </TooltipTrigger>
                                              <TooltipContent>{owner.full_name}</TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        ) : (
                                          <>
                                            <UserPlus className="h-3 w-3 text-muted-foreground" />
                                            <span className="text-muted-foreground">Assign</span>
                                          </>
                                        )}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-48 p-1" align="start" onClick={(e) => e.stopPropagation()}>
                                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                        <Button
                                          size="sm" variant="ghost" className="w-full justify-start h-7 text-xs text-muted-foreground"
                                          onClick={() => assignMutation.mutate({ leadId: lead.id, ownerId: null })}
                                        >
                                          Unassign
                                        </Button>
                                        {staffMembers.map((staff: any) => (
                                          <Button
                                            key={staff.id} size="sm" variant={lead.owner_id === staff.id ? 'secondary' : 'ghost'}
                                            className="w-full justify-start h-7 text-xs gap-2"
                                            onClick={() => assignMutation.mutate({ leadId: lead.id, ownerId: staff.id })}
                                          >
                                            <Avatar className="h-4 w-4">
                                              <AvatarFallback className="text-[8px]">{staff.full_name?.charAt(0)?.toUpperCase()}</AvatarFallback>
                                            </Avatar>
                                            <span className="truncate">{staff.full_name}</span>
                                          </Button>
                                        ))}
                                      </div>
                                    </PopoverContent>
                                  </Popover>

                                  <div className="flex items-center gap-1">
                                    {lead.phone && (
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => handleWhatsApp(e, lead.phone, lead.full_name)}>
                                        <MessageSquare className="h-3 w-3 text-success" />
                                      </Button>
                                    )}
                                    {lead.phone && (
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); window.open(`tel:${lead.phone}`); }}>
                                        <Phone className="h-3 w-3 text-info" />
                                      </Button>
                                    )}
                                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onFollowup(lead); }}>
                                      <Calendar className="h-3 w-3" />
                                    </Button>
                                    {lead.status !== 'converted' && (
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onConvert(lead); }}>
                                        <ArrowRight className="h-3 w-3 text-primary" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                    {statusLeads.length === 0 && (
                      <div className="text-center py-8 text-xs text-muted-foreground border border-dashed border-border/50 rounded-xl">
                        No leads
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    </DragDropContext>
  );
}
