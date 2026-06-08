import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBranchContext } from '@/contexts/BranchContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Plus, Search, Edit2, Trash2, BookUser, Phone, Mail, MessageSquare, Building2,
  UserCircle2, Sparkles, UserPlus, ExternalLink, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { SegmentsManagerDrawer } from '@/components/contacts/SegmentsManagerDrawer';
import { useNavigate } from 'react-router-dom';
import {
  CONTACT_CATEGORIES, ContactInput, ContactRow, deleteContact, listContacts,
  updateContact, upsertContact,
} from '@/services/contactService';
import { formatPhoneDisplay } from '@/lib/contacts/phone';

const empty = (branchId: string): ContactInput => ({
  branch_id: branchId,
  full_name: '',
  phone: '',
  email: '',
  category: 'general',
  company: '',
  notes: '',
  tags: [],
});

export default function ContactBookPage() {
  const { selectedBranch, effectiveBranchId } = useBranchContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [form, setForm] = useState<ContactInput>(empty(effectiveBranchId || ''));
  const [deleteTarget, setDeleteTarget] = useState<ContactRow | null>(null);
  const [segmentsOpen, setSegmentsOpen] = useState(false);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts', selectedBranch],
    queryFn: () => listContacts(selectedBranch),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (sourceFilter !== 'all' && (c.source_type || 'manual') !== sourceFilter) return false;
      if (!q) return true;
      return (
        c.full_name.toLowerCase().includes(q)
        || c.phone.toLowerCase().includes(q)
        || (c.email || '').toLowerCase().includes(q)
        || (c.company || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, search, categoryFilter, sourceFilter]);

  const counts = useMemo(() => {
    const c = { total: contacts.length, member: 0, lead: 0, ai: 0, manual: 0 };
    contacts.forEach((x) => {
      const s = (x.source_type || 'manual') as keyof typeof c;
      if (s in c) (c as any)[s]++;
    });
    return c;
  }, [contacts]);

  const createMutation = useMutation({
    mutationFn: (input: ContactInput) => upsertContact(input),
    onSuccess: () => {
      toast.success('Contact saved');
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      closeDrawer();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ContactInput> }) =>
      updateContact(id, patch),
    onSuccess: () => {
      toast.success('Contact updated');
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      closeDrawer();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteContact(id),
    onSuccess: () => {
      toast.success('Contact deleted');
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCreate() {
    if (!effectiveBranchId) {
      toast.error('Pick a specific branch to add a contact');
      return;
    }
    setEditing(null);
    setForm(empty(effectiveBranchId));
    setDrawerOpen(true);
  }

  function openEdit(c: ContactRow) {
    setEditing(c);
    setForm({
      branch_id: c.branch_id,
      full_name: c.full_name,
      phone: c.phone,
      email: c.email || '',
      category: c.category,
      company: c.company || '',
      notes: c.notes || '',
      tags: c.tags,
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditing(null);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim() || !form.phone.trim()) {
      toast.error('Name and phone are required');
      return;
    }
    if (editing) updateMutation.mutate({ id: editing.id, patch: form });
    else createMutation.mutate(form);
  }

  const initials = (n: string) =>
    n.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="p-2 rounded-xl bg-primary/10 text-primary">
                <BookUser className="h-5 w-5" />
              </span>
              Contact Book
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Save vendors, walk-ins, prospects and other non-member numbers so chats show real names.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setSegmentsOpen(true)} className="rounded-xl gap-2">
              <Layers className="h-4 w-4" /> Segments
            </Button>
            <Button onClick={openCreate} className="rounded-xl gap-2">
              <Plus className="h-4 w-4" /> Add Contact
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total', value: counts.total, cls: 'bg-muted text-foreground' },
            { label: 'Members', value: counts.member, cls: 'bg-success/10 text-success' },
            { label: 'Leads', value: counts.lead, cls: 'bg-warning/10 text-warning' },
            { label: 'AI / Marketing', value: counts.ai, cls: 'bg-primary/10 text-primary' },
            { label: 'Manual', value: counts.manual, cls: 'bg-primary/10 text-primary' },
          ].map((s) => (
            <div key={s.label} className={`rounded-2xl p-3 ${s.cls}`}>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{s.label}</p>
              <p className="text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, email or company"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl"
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="md:w-44 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="member">Members</SelectItem>
              <SelectItem value="lead">Leads</SelectItem>
              <SelectItem value="ai">AI / Marketing</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="md:w-48 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CONTACT_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-2xl bg-card shadow-md shadow/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2">
                      <BookUser className="h-10 w-10 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground">No contacts yet</p>
                      <p className="text-xs text-muted-foreground">
                        Members and leads sync automatically. Add vendors or walk-ins manually.
                      </p>
                      <Button size="sm" onClick={openCreate} className="mt-2 rounded-xl gap-2">
                        <Plus className="h-4 w-4" /> Add manual contact
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => {
                  const sourceMeta = (() => {
                    switch (c.source_type) {
                      case 'member': return { label: 'Member', icon: UserCircle2, cls: 'bg-success/15 text-success' };
                      case 'lead':   return { label: 'Lead',   icon: UserPlus,    cls: 'bg-warning/15 text-warning' };
                      case 'ai':     return { label: 'AI',     icon: Sparkles,    cls: 'bg-primary/15 text-primary' };
                      default:       return { label: 'Manual', icon: BookUser,    cls: 'bg-muted text-foreground' };
                    }
                  })();
                  const SourceIcon = sourceMeta.icon;
                  return (
                  <TableRow key={c.id} className="hover:bg-muted">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                            {initials(c.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{c.full_name}</p>
                          {c.company && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Building2 className="h-3 w-3" /> {c.company}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono">{formatPhoneDisplay(c.phone)}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.email || '—'}</TableCell>
                    <TableCell>
                      <Badge className={`gap-1 rounded-full ${sourceMeta.cls}`} variant="secondary">
                        <SourceIcon className="h-3 w-3" /> {sourceMeta.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize rounded-full">
                        {c.category.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {c.source_type === 'member' && c.source_id && (
                          <Button
                            variant="ghost" size="icon" aria-label="Open member"
                            onClick={() => navigate(`/members?member=${c.source_id}`)}
                          >
                            <ExternalLink className="h-4 w-4 text-success" />
                          </Button>
                        )}
                        {c.source_type === 'lead' && c.source_id && (
                          <Button
                            variant="ghost" size="icon" aria-label="Open lead"
                            onClick={() => navigate(`/leads?lead=${c.source_id}`)}
                          >
                            <ExternalLink className="h-4 w-4 text-warning" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Open chat"
                          onClick={() => navigate(`/whatsapp-chat?phone=${encodeURIComponent(c.phone)}`)}
                        >
                          <MessageSquare className="h-4 w-4 text-success" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit"
                          onClick={() => openEdit(c)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete"
                          onClick={() => setDeleteTarget(c)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create/Edit drawer */}
      <Sheet open={drawerOpen} onOpenChange={(v) => (v ? setDrawerOpen(true) : closeDrawer())}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit contact' : 'Add new contact'}</SheetTitle>
            <SheetDescription>
              Save people who are not yet members or leads — vendors, walk-ins, partners, etc.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSave} className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label htmlFor="cb-name">Full name *</Label>
              <Input
                id="cb-name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Ravi Kumar"
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cb-phone">Phone *</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="cb-phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                    required
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cb-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="cb-email"
                    type="email"
                    value={form.email || ''}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="ravi@example.com"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTACT_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cb-company">Company</Label>
                <Input
                  id="cb-company"
                  value={form.company || ''}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cb-notes">Notes</Label>
              <Textarea
                id="cb-notes"
                value={form.notes || ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                placeholder="Anything worth remembering"
              />
            </div>

            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={closeDrawer}>Cancel</Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editing ? 'Save changes' : 'Create contact'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleteTarget?.full_name}</strong> from your
              Contact Book. Existing chat history is unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SegmentsManagerDrawer open={segmentsOpen} onOpenChange={setSegmentsOpen} branchId={effectiveBranchId || ''} />
    </AppLayout>
  );
}
