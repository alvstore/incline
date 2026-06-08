import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tags, Plus, Search, Pencil, Share2, Eye, TicketPercent, Hash, Clock, TrendingUp } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, isPast, differenceInDays } from 'date-fns';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { AddCouponDrawer } from '@/components/coupons/AddCouponDrawer';
import { EditCouponDrawer } from '@/components/coupons/EditCouponDrawer';
import { CouponDetailDrawer } from '@/components/coupons/CouponDetailDrawer';
import { BroadcastDrawer } from '@/components/announcements/BroadcastDrawer';

export default function DiscountCouponsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<any>(null);
  const [broadcastMessage, setBroadcastMessage] = useState('');

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-list'],
    queryFn: async () => {
      const { data } = await supabase.from('branches').select('id, name').eq('is_active', true);
      return data || [];
    },
  });

  // Fetch branch for broadcast
  const branchId = branches[0]?.id;

  // Fetch coupons
  const { data: coupons = [], isLoading } = useQuery({
    queryKey: ['discount-coupons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discount_codes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Toggle active
  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('discount_codes').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discount-coupons'] });
      toast.success('Coupon status updated');
    },
  });

  const getCouponStatus = (c: any) => {
    if (!c.is_active) return 'inactive';
    if (c.valid_until && isPast(new Date(c.valid_until))) return 'expired';
    return 'active';
  };

  // Stats
  const totalCoupons = coupons.length;
  const activeCoupons = coupons.filter(c => getCouponStatus(c) === 'active').length;
  const expiredCoupons = coupons.filter(c => getCouponStatus(c) === 'expired').length;
  const totalRedemptions = coupons.reduce((sum, c) => sum + (c.times_used || 0), 0);

  // Filter
  const filtered = coupons.filter(c => {
    const matchesSearch = !search || c.code.toLowerCase().includes(search.toLowerCase());
    const status = getCouponStatus(c);
    const matchesStatus = statusFilter === 'all' || status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleShare = (coupon: any) => {
    const value = coupon.discount_type === 'percentage' ? `${coupon.discount_value}%` : `₹${coupon.discount_value}`;
    const expiry = coupon.valid_until ? ` Valid until ${format(new Date(coupon.valid_until), 'dd MMM yyyy')}.` : '';
    setBroadcastMessage(`🎉 Use code *${coupon.code}* to get ${value} off your next purchase!${expiry} Don't miss out!`);
    setBroadcastOpen(true);
  };

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['discount-coupons'] });

  const stats = [
    { label: 'Total Coupons', value: totalCoupons, icon: Tags, color: 'text-primary' },
    { label: 'Active Coupons', value: activeCoupons, icon: TicketPercent, color: 'text-success' },
    { label: 'Expired', value: expiredCoupons, icon: Clock, color: 'text-destructive' },
    { label: 'Total Redemptions', value: totalRedemptions, icon: TrendingUp, color: 'text-warning' },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Discount Coupons</h1>
            <p className="text-sm text-muted-foreground">Create and manage promo codes for store & POS</p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Create Coupon
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(s => (
            <Card key={s.label} className="rounded-xl border-none shadow-lg shadow-primary/5">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`rounded-lg p-2.5 bg-muted ${s.color}`}>
                  <s.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card className="rounded-xl border-none shadow-lg shadow-primary/5">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code..." className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="rounded-xl border-none shadow-lg shadow-primary/5">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Valid Until</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No coupons found</TableCell></TableRow>
                ) : (
                  filtered.map(c => {
                    const status = getCouponStatus(c);
                    const daysLeft = c.valid_until ? differenceInDays(new Date(c.valid_until), new Date()) : null;
                    return (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setSelectedCoupon(c); setDetailOpen(true); }}>
                        <TableCell>
                          <span className="font-mono font-bold text-foreground tracking-wider">{c.code}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {c.discount_type === 'percentage' ? '%' : '₹'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">
                          {c.discount_type === 'percentage' ? `${c.discount_value}%` : `₹${c.discount_value}`}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1 text-sm">
                            <Hash className="h-3 w-3 text-muted-foreground" />
                            {c.times_used || 0} / {c.max_uses || '∞'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {c.valid_until ? (
                            <span className={`text-sm ${status === 'expired' ? 'text-destructive' : daysLeft !== null && daysLeft <= 7 ? 'text-warning' : 'text-muted-foreground'}`}>
                              {format(new Date(c.valid_until), 'dd MMM yyyy')}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">No expiry</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {status === 'active' && <Badge className="bg-success/15 text-success border-success/25">Active</Badge>}
                          {status === 'expired' && <Badge variant="destructive">Expired</Badge>}
                          {status === 'inactive' && <Badge variant="secondary">Inactive</Badge>}
                        </TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedCoupon(c); setDetailOpen(true); }}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedCoupon(c); setEditOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleShare(c)}>
                              <Share2 className="h-4 w-4" />
                            </Button>
                            <Switch
                              checked={c.is_active}
                              onCheckedChange={v => toggleActive.mutate({ id: c.id, is_active: v })}
                              className="ml-1"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Drawers */}
      <AddCouponDrawer open={addOpen} onOpenChange={setAddOpen} onSuccess={handleRefresh} branches={branches} />
      <EditCouponDrawer open={editOpen} onOpenChange={setEditOpen} onSuccess={handleRefresh} branches={branches} coupon={selectedCoupon} />
      <CouponDetailDrawer open={detailOpen} onOpenChange={setDetailOpen} coupon={selectedCoupon} onShare={() => { setDetailOpen(false); if (selectedCoupon) handleShare(selectedCoupon); }} />
      <BroadcastDrawer open={broadcastOpen} onOpenChange={setBroadcastOpen} branchId={branchId} initialMessage={broadcastMessage} />
    </AppLayout>
  );
}
