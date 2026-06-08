import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageSquare, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBranchContext } from '@/contexts/BranchContext';

export function MemberVoiceWidget() {
  const navigate = useNavigate();
  const { branchFilter } = useBranchContext();

  const { data: feedbackItems = [] } = useQuery({
    queryKey: ['member-voice', branchFilter],
    queryFn: async () => {
      let query = supabase
        .from('feedback')
        .select('id, rating, feedback_text, status, created_at, member_id')
        .order('created_at', { ascending: false })
        .limit(5);
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;

      // Fetch member profiles
      const memberIds = [...new Set((data || []).map(f => f.member_id))];
      if (memberIds.length === 0) return [];

      const { data: members } = await supabase
        .from('members')
        .select('id, user_id')
        .in('id', memberIds);

      const userIds = (members || []).map(m => m.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);

      const profileMap: Record<string, { name: string; avatar: string | null }> = {};
      (members || []).forEach(m => {
        const p = profiles?.find(pr => pr.id === m.user_id);
        if (p) profileMap[m.id] = { name: p.full_name || 'Member', avatar: p.avatar_url };
      });

      return (data || []).map(f => ({
        ...f,
        memberName: profileMap[f.member_id]?.name || 'Member',
        memberAvatar: profileMap[f.member_id]?.avatar || null,
      }));
    },
  });

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-success/15 text-success border-0 text-xs">Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-destructive/15 text-destructive border-0 text-xs">Rejected</Badge>;
      default:
        return <Badge className="bg-warning/15 text-warning border-0 text-xs">Pending</Badge>;
    }
  };

  return (
    <Card className="shadow-lg rounded-2xl border-0">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Member Voice
          </CardTitle>
          <button
            onClick={() => navigate('/feedback')}
            className="text-xs text-primary hover:underline font-medium"
          >
            View All
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {feedbackItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No feedback yet</p>
        ) : (
          <div className="space-y-3">
            {feedbackItems.map((item: any) => (
              <div
                key={item.id}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => navigate('/feedback')}
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={item.memberAvatar || ''} />
                  <AvatarFallback className="text-xs">{item.memberName?.[0] || 'M'}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium truncate">{item.memberName}</span>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: item.rating || 0 }).map((_, i) => (
                        <Star key={i} className="h-3 w-3 fill-warning text-warning" />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.feedback_text?.slice(0, 60) || 'No comment'}
                    {(item.feedback_text?.length || 0) > 60 ? '...' : ''}
                  </p>
                </div>
                {getStatusBadge(item.status)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
