import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ResponsiveSheet,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetFooter,
} from '@/components/ui/ResponsiveSheet';
import { useBranchContext } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, isToday, isYesterday } from 'date-fns';
import {
  MessageSquare, Send, Search, Phone, User,
  CheckCheck, Check, Clock, Paperclip, Smile, MoreVertical, Sparkles, Loader2, Plus, AlertTriangle, Bot, UserPlus, Image, FileText,
  Trash2, Ban, Eye, CircleDot, AlertCircle, Instagram, Facebook, Users, PanelRightOpen, PanelRightClose, BookUser,
} from 'lucide-react';

// Platform icon helper
const PlatformIcon = ({ platform, className = "h-3.5 w-3.5" }: { platform?: string; className?: string }) => {
  switch (platform) {
    case 'instagram': return <Instagram className={`${className} text-pink-500`} />;
    case 'messenger': return <Facebook className={`${className} text-blue-500`} />;
    default: return <MessageSquare className={`${className} text-emerald-500`} />;
  }
};
import { AddLeadDrawer } from '@/components/leads/AddLeadDrawer';
import { ContactMemberContext } from '@/components/communications/ContactMemberContext';
import { useChatSound } from '@/hooks/useChatSound';
import { resolveIdentities, type ResolvedIdentity } from '@/lib/contacts/resolveIdentity';
import { upsertContact, CONTACT_CATEGORIES } from '@/services/contactService';
import { formatPhoneDisplay, normalizePhone as normalizePhoneE164 } from '@/lib/contacts/phone';
import { Textarea } from '@/components/ui/textarea';
import { useConversationPresence } from '@/hooks/useConversationPresence';
import { AgentPresenceBar } from '@/components/whatsapp/AgentPresenceBar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatContact {
  phone_number: string;
  contact_name: string | null;
  contact_avatar_url?: string | null;
  member_id: string | null;
  last_message: string;
  last_message_time: string;
  unread_count: number;
  is_unread?: boolean;
  bot_active?: boolean;
  platform?: string;
  assigned_staff?: { full_name: string; avatar_url: string | null } | null;
}

interface MessageMediaMeta {
  meta_id?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  bucket?: string | null;
  size?: number | null;
  error?: string | null;
  kind?: string | null;
}

interface Message {
  id: string;
  content: string;
  direction: 'inbound' | 'outbound';
  status: string;
  created_at: string;
  message_type: string;
  is_internal_note?: boolean;
  media_url?: string | null;
  media_meta?: MessageMediaMeta | null;
}

interface ChatSettingsRow {
  phone_number: string;
  bot_active: boolean | null;
  is_unread: boolean | null;
  assigned_to: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatChatDate(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM dd, yyyy');
}

function formatContactTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM dd');
}

function isAiNotConfiguredError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('not configured') ||
    lower.includes('api key') ||
    lower.includes('openai') ||
    lower.includes('configuration') ||
    lower.includes('not set up')
  );
}

type ChatFilter = 'all' | 'unread' | 'needs_human' | 'my_chats' | 'whatsapp' | 'instagram' | 'messenger';

function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, '');
}

/** True for raw Instagram-Scoped IDs (long numeric string, no '+'). */
function isIgsid(value: string): boolean {
  return /^\d{12,}$/.test(value);
}

/** Friendly display label when no resolved name is available. */
function displayLabel(c: { contact_name: string | null; phone_number: string; platform?: string }): string {
  if (c.contact_name && c.contact_name.trim()) return c.contact_name;
  if ((c.platform === 'instagram' || c.platform === 'messenger') && isIgsid(c.phone_number)) {
    return c.platform === 'instagram' ? 'Instagram User' : 'Messenger User';
  }
  return formatPhoneDisplay(c.phone_number);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WhatsAppChatPage() {
  const { selectedBranch } = useBranchContext();
  const { user } = useAuth();
  const [selectedContact, setSelectedContact] = useState<ChatContact | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');

  // New chat dialog state
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [botActive, setBotActive] = useState(true);
  const [convertLeadOpen, setConvertLeadOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachUploading, setAttachUploading] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');

  // Multi-device agent presence (typing/viewing) for the open conversation
  const conversationKey = selectedContact ? normalizePhone(selectedContact.phone_number) : null;
  const { typingOthers, viewingOthers, setTyping, broadcastReplied, lastPeerReplyAt } =
    useConversationPresence(conversationKey);

  // Clear chat confirmation
  const [clearChatConfirmOpen, setClearChatConfirmOpen] = useState(false);
  // Transfer to staff
  const [transferStaffOpen, setTransferStaffOpen] = useState(false);
  // Right context panel — collapsed by default to maximise chat view area
  const [contextPanelOpen, setContextPanelOpen] = useState(false);

  // Save-as-Contact drawer state
  const [saveContactOpen, setSaveContactOpen] = useState(false);
  const [saveContactForm, setSaveContactForm] = useState({
    full_name: '', category: 'general', company: '', notes: '',
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Fetch bot_active state for selected contact
  useEffect(() => {
    if (!selectedContact || !selectedBranch || selectedBranch === 'all') {
      setBotActive(true);
      return;
    }
    supabase
      .from('whatsapp_chat_settings')
      .select('bot_active')
      .eq('branch_id', selectedBranch)
      .eq('phone_number', selectedContact.phone_number)
      .maybeSingle()
      .then(({ data }) => {
        setBotActive(data?.bot_active ?? true);
      });
  }, [selectedContact, selectedBranch]);

  // Realtime subscription: refresh messages + contacts + chat settings on any change
  useEffect(() => {
    const channel = supabase
      .channel('whatsapp-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ['whatsapp-messages'] });
        queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_chat_settings' }, () => {
        queryClient.invalidateQueries({ queryKey: ['whatsapp-chat-settings'] });
        queryClient.invalidateQueries({ queryKey: ['whatsapp-unread-count'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Chat settings query for triage
  const { data: chatSettings = [] } = useQuery<ChatSettingsRow[]>({
    queryKey: ['whatsapp-chat-settings', selectedBranch],
    queryFn: async () => {
      if (!selectedBranch || selectedBranch === 'all') return [];
      const { data, error } = await supabase
        .from('whatsapp_chat_settings')
        .select('phone_number, bot_active, is_unread, assigned_to')
        .eq('branch_id', selectedBranch);
      if (error) throw error;
      return (data ?? []) as ChatSettingsRow[];
    },
  });

  // Staff list for Transfer to Staff
  const { data: staffList = [] } = useQuery({
    queryKey: ['staff-list-for-transfer'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('user_id, role, profiles:user_id(id, full_name, avatar_url, email)')
        .in('role', ['owner', 'admin', 'manager', 'staff']);
      if (error) throw error;
      // Deduplicate by user_id
      const seen = new Set<string>();
      return (data ?? []).filter((r: any) => {
        if (seen.has(r.user_id)) return false;
        seen.add(r.user_id);
        return true;
      }).map((r: any) => ({
        id: r.user_id,
        full_name: r.profiles?.full_name || r.profiles?.email || 'Unknown',
        avatar_url: r.profiles?.avatar_url,
        role: r.role,
      }));
    },
    enabled: transferStaffOpen,
  });

  // Slash command templates
  const { data: slashTemplates = [] } = useQuery({
    queryKey: ['slash-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('templates')
        .select('id, name, content')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // Build a map for quick lookup
  const settingsMap = new Map<string, ChatSettingsRow>();
  chatSettings.forEach(s => settingsMap.set(s.phone_number, s));

  // Contacts query — builds a unique contact list from whatsapp_messages
  const { data: contacts = [] } = useQuery<ChatContact[]>({
    queryKey: ['whatsapp-contacts', selectedBranch],
    queryFn: async (): Promise<ChatContact[]> => {
      const branchFilter = selectedBranch !== 'all' ? selectedBranch : undefined;
      let q = supabase
        .from('whatsapp_messages')
        .select('phone_number, contact_name, contact_avatar_url, member_id, content, created_at, direction, platform')
        .order('created_at', { ascending: false });
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data, error } = await q;
      if (error) throw error;
      const contactMap = new Map<string, ChatContact>();
      (data || []).forEach((msg: {
        phone_number: string;
        contact_name: string | null;
        contact_avatar_url: string | null;
        member_id: string | null;
        content: string | null;
        created_at: string;
        direction: string;
        platform: string | null;
      }) => {
        const existing = contactMap.get(msg.phone_number);
        if (!existing) {
          contactMap.set(msg.phone_number, {
            phone_number: msg.phone_number,
            contact_name: msg.contact_name,
            contact_avatar_url: msg.contact_avatar_url,
            member_id: msg.member_id,
            last_message: msg.content || '',
            last_message_time: msg.created_at,
            unread_count: 0,
            platform: msg.platform || 'whatsapp',
          });
        } else if (!existing.contact_avatar_url && msg.contact_avatar_url) {
          // Backfill avatar from older inbound msg if newest didn't have one
          existing.contact_avatar_url = msg.contact_avatar_url;
        }
      });
      return Array.from(contactMap.values());
    },
  });

  // Resolve identities (member → lead → contact book) for every phone in the list.
  const phonesKey = contacts.map(c => c.phone_number).sort().join('|');
  const { data: identityMap } = useQuery({
    queryKey: ['chat-identities', phonesKey],
    queryFn: () => resolveIdentities(contacts.map(c => c.phone_number)),
    enabled: contacts.length > 0,
    staleTime: 60_000,
  });

  // Enrich contacts with settings (normalize phone for matching)
  const enrichedContacts: ChatContact[] = contacts.map(c => {
    const normalized = normalizePhone(c.phone_number);
    const s = settingsMap.get(c.phone_number) || settingsMap.get(normalized) || settingsMap.get('+' + normalized);
    const ident = identityMap?.get(normalizePhoneE164(c.phone_number));
    const resolvedName = ident && ident.source !== 'unknown'
      ? ident.display_name
      : c.contact_name;
    return {
      ...c,
      contact_name: resolvedName,
      member_id: ident?.member_id ?? c.member_id,
      is_unread: s?.is_unread ?? false,
      bot_active: s?.bot_active ?? true,
      identity_source: ident?.source ?? 'unknown',
      lead_id: ident?.lead_id ?? null,
      contact_id: ident?.contact_id ?? null,
    } as ChatContact & { identity_source: string; lead_id: string | null; contact_id: string | null };
  });

  // Messages query for the selected contact
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['whatsapp-messages', selectedContact?.phone_number, selectedBranch],
    queryFn: async (): Promise<Message[]> => {
      if (!selectedContact) return [];
      let q = supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('phone_number', selectedContact.phone_number)
        .order('created_at', { ascending: true });
      if (selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Message[];
    },
    enabled: !!selectedContact,
  });

  // Play sound on incoming inbound message arrival.
  // Pass selectedContact?.phone_number as resetKey so switching contacts
  // re-baselines the counter and doesn't ping for previously-loaded messages.
  const inboundCount = messages.filter((m) => m.direction === 'inbound').length;
  useChatSound(inboundCount, selectedContact?.phone_number ?? null);

  // AI Tool Logs for this contact (for thought banners)
  const { data: aiToolLogs = [] } = useQuery({
    queryKey: ['ai-tool-logs-chat', selectedContact?.phone_number],
    queryFn: async () => {
      if (!selectedContact) return [];
      const { data, error } = await supabase
        .from('ai_tool_logs')
        .select('*')
        .eq('phone_number', selectedContact.phone_number)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedContact,
    refetchInterval: 15000,
  });

  // Helper: find tool logs near a message timestamp
  const getToolLogsForMessage = useCallback((msgCreatedAt: string) => {
    const msgTime = new Date(msgCreatedAt).getTime();
    return aiToolLogs.filter((log: any) => {
      const logTime = new Date(log.created_at).getTime();
      return Math.abs(logTime - msgTime) < 10000; // within 10 seconds
    });
  }, [aiToolLogs]);

  // Send message mutation
  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedContact) throw new Error('No contact selected');
      if (!selectedBranch || selectedBranch === 'all') {
        throw new Error('Please select a specific branch before sending messages');
      }

      const isNote = whisperMode;

      const { data, error } = await supabase
        .from('whatsapp_messages')
        .insert({
          branch_id: selectedBranch,
          phone_number: selectedContact.phone_number,
          contact_name: selectedContact.contact_name,
          member_id: selectedContact.member_id,
          content,
          direction: 'outbound',
          status: isNote ? 'delivered' : 'pending',
          message_type: 'text',
          is_internal_note: isNote,
        })
        .select()
        .single();
      if (error) throw error;

      // Don't send to WhatsApp if it's an internal note
      if (isNote) return data;

      const messageId: string = data.id;

      try {
        const { error: sendError } = await supabase.functions.invoke('send-whatsapp', {
          body: {
            message_id: messageId,
            phone_number: selectedContact.phone_number,
            content,
            branch_id: selectedBranch,
          },
        });

        if (sendError) {
          console.warn('WhatsApp delivery failed (message saved as pending):', sendError);
          toast.info('Message saved. WhatsApp delivery failed — check integration settings.');
        } else {
          const { error: updateErr } = await supabase
            .from('whatsapp_messages')
            .update({ status: 'sent' })
            .eq('id', messageId);
          if (updateErr) {
            console.warn('Failed to update message status to sent:', updateErr.message);
          }
        }

        // Auto-pause bot when staff sends a manual message
        if (selectedBranch !== 'all') {
          await supabase.from('whatsapp_chat_settings').upsert(
            {
              branch_id: selectedBranch,
              phone_number: selectedContact.phone_number,
              bot_active: false,
              paused_at: new Date().toISOString(),
            },
            { onConflict: 'branch_id,phone_number' }
          );
          setBotActive(false);
        }
      } catch (apiErr) {
        console.warn('send-whatsapp invocation error:', apiErr);
      }

      return data;
    },
    onSuccess: () => {
      setNewMessage('');
      setTyping(false);
      broadcastReplied();
      queryClient.invalidateQueries({ queryKey: ['whatsapp-messages'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to send message'),
  });

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Filter contacts by search + triage tab + platform
  const filteredContacts = enrichedContacts.filter((c: ChatContact) => {
    const matchesSearch = c.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone_number.includes(searchQuery);
    if (!matchesSearch) return false;
    if (chatFilter === 'unread') return c.is_unread === true;
    if (chatFilter === 'needs_human') return c.bot_active === false;
    if (chatFilter === 'my_chats') {
      const s = settingsMap.get(c.phone_number) || settingsMap.get(normalizePhone(c.phone_number));
      return s?.assigned_to === user?.id;
    }
    if (chatFilter === 'whatsapp') return (c.platform || 'whatsapp') === 'whatsapp';
    if (chatFilter === 'instagram') return c.platform === 'instagram';
    if (chatFilter === 'messenger') return c.platform === 'messenger';
    return true;
  });

  const handleSend = () => {
    if (selectedBranch === 'all') {
      toast.warning('Please select a specific branch from the selector before sending messages');
      return;
    }
    if (newMessage.trim()) sendMessage.mutate(newMessage.trim());
  };

  const handleEmojiSelect = useCallback((emoji: any) => {
    setNewMessage(prev => prev + emoji.native);
    setEmojiOpen(false);
  }, []);

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedContact || !selectedBranch || selectedBranch === 'all') return;
    setAttachUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `whatsapp-attachments/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('attachments').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: signed, error: signErr } = await supabase.storage
        .from('attachments')
        .createSignedUrl(path, 60 * 60 * 24 * 30); // 30 days
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error('Failed to sign attachment URL');
      const mediaUrl = signed.signedUrl;

      const { data: msgData, error: msgError } = await supabase
        .from('whatsapp_messages')
        .insert({
          branch_id: selectedBranch,
          phone_number: selectedContact.phone_number,
          contact_name: selectedContact.contact_name,
          member_id: selectedContact.member_id,
          content: mediaUrl,
          direction: 'outbound',
          status: 'pending',
          message_type: file.type.startsWith('image/') ? 'image' : 'document',
        })
        .select()
        .single();
      if (msgError) throw msgError;

      await supabase.functions.invoke('send-whatsapp', {
        body: {
          message_id: msgData.id,
          phone_number: selectedContact.phone_number,
          content: mediaUrl,
          branch_id: selectedBranch,
          message_type: file.type.startsWith('image/') ? 'image' : 'document',
          media_url: mediaUrl,
        },
      });

      queryClient.invalidateQueries({ queryKey: ['whatsapp-messages'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      toast.success('Attachment sent');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send attachment');
    } finally {
      setAttachUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAiSuggest = async () => {
    if (!selectedContact || messages.length === 0) {
      toast.error('No conversation selected or no messages to analyze');
      return;
    }
    setAiSuggesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-auto-reply', {
        body: {
          contact_name: selectedContact.contact_name,
          phone_number: selectedContact.phone_number,
          recent_messages: messages.slice(-10).map(m => ({
            content: m.content,
            direction: m.direction,
          })),
          context_type: 'general',
        },
      });

      if (error) {
        const msg = (error as { message?: string }).message || '';
        if (isAiNotConfiguredError(msg)) {
          toast.warning('AI reply requires configuration in Integration Settings');
        } else {
          toast.error(msg || 'Failed to get AI suggestion');
        }
        return;
      }

      if (data?.error) {
        if (isAiNotConfiguredError(String(data.error))) {
          toast.warning('AI reply requires configuration in Integration Settings');
        } else {
          toast.error(String(data.error));
        }
        return;
      }

      if (data?.suggested_reply) {
        setNewMessage(data.suggested_reply);
        toast.success('AI suggestion ready — review and send!');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to get AI suggestion';
      if (isAiNotConfiguredError(msg)) {
        toast.warning('AI reply requires configuration in Integration Settings');
      } else {
        toast.error(msg);
      }
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleOpenNewChat = () => {
    if (selectedBranch === 'all') {
      toast.warning('Please select a specific branch before starting a new chat');
      return;
    }
    setNewChatPhone('');
    setNewChatName('');
    setNewChatOpen(true);
  };

  const handleStartNewChat = () => {
    const phone = newChatPhone.trim();
    if (!phone) {
      toast.error('Phone number is required');
      return;
    }
    const contact: ChatContact = {
      phone_number: phone,
      contact_name: newChatName.trim() || null,
      member_id: null,
      last_message: '',
      last_message_time: new Date().toISOString(),
      unread_count: 0,
    };
    setSelectedContact(contact);
    setNewChatOpen(false);
    setNewChatPhone('');
    setNewChatName('');
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'read': return <CheckCheck className="h-3.5 w-3.5 text-sky-400" />;
      case 'delivered': return <CheckCheck className="h-3.5 w-3.5 text-white/50" />;
      case 'sent': return <Check className="h-3.5 w-3.5 text-white/50" />;
      default: return <Clock className="h-3.5 w-3.5 text-white/40" />;
    }
  };

  // Auto-read: mark as read when selecting a contact
  const handleSelectContact = async (contact: ChatContact) => {
    setSelectedContact(contact);
    if (contact.is_unread && selectedBranch && selectedBranch !== 'all') {
      // Normalize phone to match both +91xxx and 91xxx formats
      const normalized = normalizePhone(contact.phone_number);
      await supabase.from('whatsapp_chat_settings')
        .update({ is_unread: false })
        .eq('branch_id', selectedBranch)
        .or(`phone_number.eq.${contact.phone_number},phone_number.eq.${normalized},phone_number.eq.+${normalized}`);
      queryClient.invalidateQueries({ queryKey: ['whatsapp-chat-settings'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-unread-count'] });
    }
  };

  // Clear chat with database deletion
  const handleClearChat = async () => {
    if (!selectedContact || !selectedBranch || selectedBranch === 'all') return;
    const { error } = await supabase
      .from('whatsapp_messages')
      .delete()
      .eq('phone_number', selectedContact.phone_number)
      .eq('branch_id', selectedBranch);
    if (error) {
      toast.error('Failed to delete chat: ' + error.message);
    } else {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-messages'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      setSelectedContact(null);
      toast.success('Chat history permanently deleted');
    }
    setClearChatConfirmOpen(false);
  };

  // Group messages by date
  const groupedMessages: { date: string; msgs: Message[] }[] = [];
  messages.forEach((msg) => {
    const dateKey = format(new Date(msg.created_at), 'yyyy-MM-dd');
    const lastGroup = groupedMessages[groupedMessages.length - 1];
    if (lastGroup && lastGroup.date === dateKey) {
      lastGroup.msgs.push(msg);
    } else {
      groupedMessages.push({ date: dateKey, msgs: [msg] });
    }
  });

  const isBranchUnselected = selectedBranch === 'all';

  // Triage tab counts
  const unreadCount = enrichedContacts.filter(c => c.is_unread).length;
  const needsHumanCount = enrichedContacts.filter(c => c.bot_active === false).length;
  const myChatsCount = enrichedContacts.filter(c => {
    const s = settingsMap.get(c.phone_number) || settingsMap.get(normalizePhone(c.phone_number));
    return s?.assigned_to === user?.id;
  }).length;
  const igCount = enrichedContacts.filter(c => c.platform === 'instagram').length;
  const fbCount = enrichedContacts.filter(c => c.platform === 'messenger').length;

  // Compute prefill for "Convert to Lead" — pulls last 3 inbound messages as context.
  const leadPrefill = useMemo(() => {
    if (!selectedContact) return undefined;
    const phone = selectedContact.phone_number.startsWith('+')
      ? selectedContact.phone_number
      : `+${selectedContact.phone_number}`;
    const lastInbound = (messages || [])
      .filter((m: any) => m.direction === 'inbound' && m.content)
      .slice(-3)
      .map((m: any) => `• ${m.content}`)
      .join('\n');
    const platform = selectedContact.platform || 'whatsapp';
    return {
      full_name: selectedContact.contact_name || '',
      phone,
      source: platform === 'instagram' ? 'instagram' : platform === 'messenger' ? 'facebook' : 'whatsapp_api',
      preferred_contact_channel: platform === 'whatsapp' ? 'whatsapp' : 'phone',
      notes: lastInbound
        ? `Captured from ${platform} chat. Recent messages:\n${lastInbound}`
        : `Captured from ${platform} chat.`,
    };
  }, [selectedContact, messages]);

  // Aggregate stats for the right-side context panel.
  const contactStats = useMemo(() => {
    if (!selectedContact) return null;
    const total = messages.length;
    const inbound = messages.filter((m: any) => m.direction === 'inbound').length;
    const outbound = total - inbound;
    const lastSeen = messages.length > 0 ? messages[messages.length - 1].created_at : null;
    return { total, inbound, outbound, lastSeen };
  }, [messages, selectedContact]);


  return (
    <AppLayout>
      <div className="h-[calc(100vh-5rem)] p-4">
        <div className="h-full rounded-2xl border border-border/50 shadow-xl overflow-hidden flex bg-card">

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          <div className="w-[340px] border-r border-border/50 flex flex-col bg-card">
            {/* Sidebar Header */}
            <div className="p-4 border-b border-border/30">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-primary/10">
                    <MessageSquare className="h-4 w-4 text-primary" />
                  </div>
                  Chats
                </h2>
                <div className="flex items-center gap-1">
                  <Badge variant="secondary" className="rounded-full text-xs">{contacts.length}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-xl text-emerald-600 hover:bg-emerald-500/10"
                    onClick={handleOpenNewChat}
                    title="Start new chat"
                    data-testid="button-new-chat"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 rounded-xl bg-muted/50 border-0 focus-visible:ring-1"
                  data-testid="input-search-contacts"
                />
              </div>
              {/* Triage Tabs */}
              <div className="flex gap-1 flex-wrap">
                {([
                  { key: 'all' as ChatFilter, label: 'All', count: contacts.length },
                  { key: 'my_chats' as ChatFilter, label: 'Mine', count: myChatsCount },
                  { key: 'unread' as ChatFilter, label: 'Unread', count: unreadCount },
                  { key: 'needs_human' as ChatFilter, label: 'Human', count: needsHumanCount },
                ]).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setChatFilter(tab.key)}
                    className={`flex-1 text-xs font-medium px-2 py-1.5 rounded-lg transition-colors ${
                      chatFilter === tab.key
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span className={`ml-1 text-[10px] ${chatFilter === tab.key ? 'opacity-80' : ''}`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {/* Platform filter badges — always visible */}
              <div className="flex gap-1 mt-1.5">
                {[
                  { key: 'whatsapp' as ChatFilter, icon: <MessageSquare className="h-3 w-3" />, label: 'WhatsApp', color: 'text-emerald-500', activeBg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30' },
                  { key: 'instagram' as ChatFilter, icon: <Instagram className="h-3 w-3" />, label: 'Instagram', color: 'text-pink-500', activeBg: 'bg-pink-500/15 text-pink-700 dark:text-pink-400 ring-1 ring-pink-500/30' },
                  { key: 'messenger' as ChatFilter, icon: <Facebook className="h-3 w-3" />, label: 'Messenger', color: 'text-blue-500', activeBg: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 ring-1 ring-blue-500/30' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setChatFilter(prev => prev === tab.key ? 'all' : tab.key)}
                    className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-all ${
                      chatFilter === tab.key
                        ? tab.activeBg
                        : 'text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    <span className={chatFilter === tab.key ? '' : tab.color}>{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Contact List */}
            <ScrollArea className="flex-1">
              {filteredContacts.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">
                    {chatFilter === 'all' ? 'No conversations yet' : `No ${chatFilter === 'unread' ? 'unread' : 'human-needed'} chats`}
                  </p>
                  {chatFilter === 'all' && (
                    <p className="text-xs mt-1 text-muted-foreground/60">
                      Use the + button to start a new chat
                    </p>
                  )}
                </div>
              ) : (
                filteredContacts.map((contact: ChatContact) => (
                  <div
                    key={contact.phone_number}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all hover:bg-muted/50 ${
                      selectedContact?.phone_number === contact.phone_number
                        ? 'bg-primary/5 border-l-2 border-l-primary'
                        : 'border-l-2 border-l-transparent'
                    }`}
                    onClick={() => handleSelectContact(contact)}
                    data-testid={`contact-item-${contact.phone_number}`}
                  >
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      <Avatar className="h-11 w-11 ring-2 ring-background">
                        {contact.contact_avatar_url && (
                          <AvatarImage src={contact.contact_avatar_url} alt={contact.contact_name || 'avatar'} />
                        )}
                        <AvatarFallback className={`font-bold text-sm ${
                          contact.platform === 'instagram'
                            ? 'bg-gradient-to-br from-pink-100 to-purple-100 text-pink-700'
                            : contact.platform === 'messenger'
                            ? 'bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-700'
                            : 'bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700'
                        }`}>
                          {(contact.contact_name?.[0]?.toUpperCase()) ||
                           (contact.platform === 'instagram' ? <Instagram className="h-5 w-5" /> :
                            contact.platform === 'messenger' ? <Facebook className="h-5 w-5" /> :
                            <User className="h-5 w-5" />)}
                        </AvatarFallback>
                      </Avatar>
                      {/* Platform badge — always shown */}
                      <span className={`absolute -bottom-0.5 -right-0.5 rounded-full p-0.5 ${
                        contact.platform === 'instagram'
                          ? 'bg-pink-500'
                          : contact.platform === 'messenger'
                          ? 'bg-blue-500'
                          : 'bg-emerald-500'
                      }`}>
                        <PlatformIcon platform={contact.platform} className="h-3 w-3 !text-white" />
                      </span>
                      {/* Visual indicators */}
                      {contact.is_unread && (
                        <span className="absolute -top-0.5 -left-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-background" />
                      )}
                      {contact.bot_active === false && !contact.is_unread && (
                        <span className="absolute -top-0.5 -left-0.5">
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-sm text-foreground truncate">
                            {displayLabel(contact)}
                          </span>
                          <Badge variant="outline" className={`text-[9px] h-4 px-1 flex-shrink-0 rounded-md font-medium ${
                            contact.platform === 'instagram'
                              ? 'border-pink-300 text-pink-600 bg-pink-50 dark:bg-pink-500/10 dark:border-pink-500/30'
                              : contact.platform === 'messenger'
                              ? 'border-blue-300 text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/30'
                              : 'border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30'
                          }`}>
                            {contact.platform === 'instagram' ? 'IG' : contact.platform === 'messenger' ? 'FB' : 'WA'}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-muted-foreground flex-shrink-0 ml-2">
                          {formatContactTime(contact.last_message_time)}
                        </span>
                      </div>
                      <p className="text-[13px] text-muted-foreground line-clamp-1 mt-0.5 leading-snug">{contact.last_message}</p>
                    </div>

                    {contact.unread_count > 0 && (
                      <Badge className="rounded-full h-5 min-w-[20px] flex items-center justify-center bg-emerald-500 text-white text-[10px] p-0">
                        {contact.unread_count}
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </ScrollArea>
          </div>

          {/* ── Chat Area ────────────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedContact ? (
              <>
                {/* Chat Header */}
                <div className={`px-5 py-3 border-b flex items-center justify-between bg-card flex-shrink-0 ${
                  selectedContact.platform === 'instagram' 
                    ? 'border-b-pink-500/30' 
                    : selectedContact.platform === 'messenger'
                    ? 'border-b-blue-500/30'
                    : 'border-b-border/30'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="h-10 w-10">
                        {selectedContact.contact_avatar_url && (
                          <AvatarImage src={selectedContact.contact_avatar_url} alt={selectedContact.contact_name || 'avatar'} />
                        )}
                        <AvatarFallback className={`font-bold ${
                          selectedContact.platform === 'instagram'
                            ? 'bg-gradient-to-br from-pink-100 to-purple-100 text-pink-700'
                            : selectedContact.platform === 'messenger'
                            ? 'bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-700'
                            : 'bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700'
                        }`}>
                          {(selectedContact.contact_name?.[0]?.toUpperCase()) ||
                           (selectedContact.platform === 'instagram' ? <Instagram className="h-5 w-5" /> :
                            selectedContact.platform === 'messenger' ? <Facebook className="h-5 w-5" /> :
                            <User className="h-5 w-5" />)}
                        </AvatarFallback>
                      </Avatar>
                      {selectedContact.platform && selectedContact.platform !== 'whatsapp' && (
                        <span className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
                          <PlatformIcon platform={selectedContact.platform} className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <PlatformIcon platform={selectedContact.platform} className="h-4 w-4" />
                        <h3 className="font-semibold text-foreground text-sm break-words [overflow-wrap:anywhere]">
                          {displayLabel(selectedContact)}
                        </h3>
                        {(() => {
                          const src = (selectedContact as any).identity_source as string | undefined;
                          if (!src || src === 'unknown') return (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 ml-1 border-amber-300 bg-amber-50 text-amber-700">Unknown</Badge>
                          );
                          if (src === 'member') return (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 ml-1 border-emerald-300 bg-emerald-50 text-emerald-700">Member</Badge>
                          );
                          if (src === 'lead') return (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 ml-1 border-violet-300 bg-violet-50 text-violet-700">Lead</Badge>
                          );
                          return (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 ml-1 border-blue-300 bg-blue-50 text-blue-700">Contact</Badge>
                          );
                        })()}
                        <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ml-1 ${
                          selectedContact.platform === 'instagram'
                            ? 'border-pink-300 text-pink-600 bg-pink-50 dark:bg-pink-500/10'
                            : selectedContact.platform === 'messenger'
                            ? 'border-blue-300 text-blue-600 bg-blue-50 dark:bg-blue-500/10'
                            : 'border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10'
                        }`}>
                          {selectedContact.platform === 'instagram' ? 'Instagram' : selectedContact.platform === 'messenger' ? 'Messenger' : 'WhatsApp'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {formatPhoneDisplay(selectedContact.phone_number)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Convert to Lead button removed — use the prominent CTA in the right sidebar instead. */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">AI Bot</span>
                      <Switch
                        checked={botActive}
                        onCheckedChange={async (checked) => {
                          setBotActive(checked);
                          if (selectedContact && selectedBranch && selectedBranch !== 'all') {
                            await supabase.from('whatsapp_chat_settings').upsert(
                              {
                                branch_id: selectedBranch,
                                phone_number: selectedContact.phone_number,
                                bot_active: checked,
                                ...(!checked ? { paused_at: new Date().toISOString() } : { paused_at: null }),
                              },
                              { onConflict: 'branch_id,phone_number' }
                            );
                            toast.success(checked ? 'AI Bot enabled' : 'AI Bot paused for this contact');
                          }
                        }}
                        className="scale-75"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-xl hidden xl:inline-flex"
                      onClick={() => setContextPanelOpen(v => !v)}
                      title={contextPanelOpen ? 'Hide details' : 'Show details'}
                    >
                      {contextPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-xl">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {selectedContact.member_id && (
                          <DropdownMenuItem onClick={() => navigate(`/members`)}>
                            <Eye className="h-4 w-4 mr-2" /> View Profile
                          </DropdownMenuItem>
                        )}
                        {((selectedContact as any).identity_source === 'unknown' || (selectedContact as any).identity_source === undefined) && (
                          <DropdownMenuItem onClick={() => {
                            setSaveContactForm({
                              full_name: selectedContact.contact_name || '',
                              category: 'general', company: '', notes: '',
                            });
                            setSaveContactOpen(true);
                          }}>
                            <BookUser className="h-4 w-4 mr-2 text-indigo-600" /> Save as Contact
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => setClearChatConfirmOpen(true)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Clear Chat
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setTransferStaffOpen(true)}
                        >
                          <UserPlus className="h-4 w-4 mr-2" /> Transfer to Staff
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" disabled>
                          <Ban className="h-4 w-4 mr-2" /> Block Contact
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Branch-not-selected inline notice */}
                {isBranchUnselected && (
                  <div className="flex items-center gap-2.5 px-5 py-2.5 bg-yellow-500/10 border-b border-yellow-500/20 text-sm text-yellow-700 dark:text-yellow-400">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>
                      Please select a specific branch from the branch selector to send messages.
                    </span>
                  </div>
                )}

                {/* Multi-device agent presence */}
                <AgentPresenceBar viewing={viewingOthers} typing={typingOthers} />
                {lastPeerReplyAt && (Date.now() - new Date(lastPeerReplyAt).getTime() < 8000) && (
                  <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 text-xs text-blue-800">
                    Another agent just replied to this conversation.
                  </div>
                )}

                <div className="flex-1 min-h-0">
                  <div
                    ref={messagesContainerRef}
                    className="h-full overflow-y-auto p-4 space-y-1"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                    }}
                  >
                    {groupedMessages.length === 0 && (
                      <div className="flex items-center justify-center py-16 text-muted-foreground">
                        <div className="text-center">
                          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">No messages yet. Send the first one!</p>
                        </div>
                      </div>
                    )}
                    {groupedMessages.map((group) => (
                      <div key={group.date}>
                        {/* Date divider */}
                        <div className="flex items-center justify-center my-4">
                          <div className="px-3 py-1 rounded-lg bg-muted/80 text-xs text-muted-foreground font-medium shadow-sm">
                            {formatChatDate(group.msgs[0].created_at)}
                          </div>
                        </div>
                        {group.msgs.map((msg: Message) => {
                          // Detect AI Lead Captured marker
                          const leadCapturedMatch = msg.content?.match(/\[AI_LEAD_CAPTURED:([a-f0-9-]+)\]/);
                          if (leadCapturedMatch) {
                            const leadId = leadCapturedMatch[1];
                            return (
                              <div key={msg.id} className="flex justify-center my-4">
                                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-5 py-3 text-center shadow-lg shadow-emerald-500/5 animate-pulse-once">
                                  <div className="flex items-center gap-2 justify-center mb-1">
                                    <Sparkles className="h-4 w-4 text-emerald-500" />
                                    <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">AI Successfully Captured Lead</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mb-2">The AI collected all required information and created a lead in your CRM.</p>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5 text-xs rounded-lg border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                                    onClick={() => navigate('/leads')}
                                  >
                                    <UserPlus className="h-3.5 w-3.5" />
                                    View Lead
                                  </Button>
                                </div>
                              </div>
                            );
                          }

                          // Internal note rendering
                          if (msg.is_internal_note) {
                            return (
                              <div key={msg.id} className="flex justify-end mb-1">
                                <div className="max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm bg-amber-500/10 border border-amber-500/20 rounded-br-md">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Eye className="h-3 w-3 text-amber-600" />
                                    <span className="text-[10px] font-semibold text-amber-600">Staff Only Note</span>
                                  </div>
                                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{msg.content}</p>
                                  <div className="flex items-center justify-end gap-1 mt-1 text-amber-500/60">
                                    <span className="text-[10px]">{format(new Date(msg.created_at), 'HH:mm')}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={msg.id}
                              className={`flex mb-1 ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                              data-testid={`message-${msg.id}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm break-words overflow-hidden ${
                                  msg.direction === 'outbound'
                                    ? selectedContact.platform === 'instagram'
                                      ? 'bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-br-md'
                                      : selectedContact.platform === 'messenger'
                                      ? 'bg-blue-500 text-white rounded-br-md'
                                      : 'bg-emerald-600 text-white rounded-br-md'
                                    : 'bg-card border border-border/50 text-foreground rounded-bl-md'
                                }`}
                              >
                                {msg.message_type === 'image' && msg.media_url && (
                                  <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="block mb-2 -mx-1">
                                    <img
                                      src={msg.media_url}
                                      alt={msg.content || 'Photo'}
                                      className="rounded-lg max-h-64 w-auto object-cover border border-black/5"
                                      loading="lazy"
                                    />
                                  </a>
                                )}
                                {msg.message_type === 'document' && msg.media_url && (
                                  <a
                                    href={msg.media_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`mb-2 -mx-1 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                                      msg.direction === 'outbound'
                                        ? 'bg-white/15 hover:bg-white/25 text-white'
                                        : 'bg-muted/60 hover:bg-muted text-foreground'
                                    }`}
                                  >
                                    <div className={`h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0 ${
                                      msg.direction === 'outbound' ? 'bg-white/20' : 'bg-rose-500/10 text-rose-600'
                                    }`}>
                                      <FileText className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs font-semibold truncate">
                                        {decodeURIComponent(msg.media_url.split('/').pop() || 'document.pdf')}
                                      </div>
                                      <div className={`text-[10px] ${msg.direction === 'outbound' ? 'text-white/70' : 'text-muted-foreground'}`}>
                                        Tap to open · PDF
                                      </div>
                                    </div>
                                  </a>
                                )}
                                {msg.message_type === 'template' && (
                                  <div className={`flex items-center gap-1 mb-1 text-[10px] ${msg.direction === 'outbound' ? 'text-white/50' : 'text-muted-foreground'}`}>
                                    <FileText className="h-3 w-3" /> Template
                                  </div>
                                )}
                                {!['text','image','template','document'].includes(msg.message_type) && (
                                  <div className={`flex items-center gap-1 mb-1 text-[10px] ${msg.direction === 'outbound' ? 'text-white/50' : 'text-muted-foreground'}`}>
                                    <Paperclip className="h-3 w-3" /> {msg.message_type}
                                  </div>
                                )}
                                {msg.content && (
                                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [word-break:break-word] [overflow-wrap:anywhere] w-full">{msg.content}</p>
                                )}
                                <div
                                  className={`flex items-center justify-end gap-1 mt-1 ${
                                    msg.direction === 'outbound' ? 'text-white/60' : 'text-muted-foreground'
                                  }`}
                                >
                                  <span className="text-[10px]">{format(new Date(msg.created_at), 'HH:mm')}</span>
                                  {msg.direction === 'outbound' && getStatusIcon(msg.status)}
                                </div>
                              </div>
                              {/* AI Thought Banner */}
                              {msg.direction === 'outbound' && (() => {
                                const toolLogsForMsg = getToolLogsForMessage(msg.created_at);
                                if (toolLogsForMsg.length === 0) return null;
                                return (
                                  <div className="mt-1 space-y-0.5">
                                    {toolLogsForMsg.map((log: any) => (
                                      <div
                                        key={log.id}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] max-w-[85%] ml-auto ${
                                          log.status === 'success'
                                            ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                                            : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                        }`}
                                      >
                                        {log.status === 'success' ? (
                                          <Sparkles className="h-3 w-3 flex-shrink-0" />
                                        ) : (
                                          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                                        )}
                                        <span>
                                          AI used <span className="font-mono font-semibold">{log.tool_name}</span>
                                          {' — '}
                                          {log.status === 'success' ? 'Success' : 'Failed'}
                                          {log.execution_time_ms ? ` (${log.execution_time_ms}ms)` : ''}
                                        </span>
                                        {log.status === 'error' && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-4 px-1.5 text-[10px] text-amber-600 hover:text-amber-700 ml-auto"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigate(`/whatsapp-chat?phone=${encodeURIComponent(selectedContact?.phone_number || '')}`);
                                              setNewMessage(`Re: ${log.tool_name} — ${log.error_message || 'Error'}. How can I help?`);
                                            }}
                                          >
                                            Handle
                                          </Button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Message Input */}
                <div className="px-4 py-3 border-t border-border/30 bg-card flex-shrink-0">
                  {/* Whisper Mode Banner */}
                  {whisperMode && (
                    <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                      <Eye className="h-3.5 w-3.5" />
                      <span className="font-medium">Internal Note Mode</span> — This message will NOT be sent to the customer
                      <Button variant="ghost" size="sm" className="ml-auto h-5 px-1.5 text-[10px]" onClick={() => setWhisperMode(false)}>Exit</Button>
                    </div>
                  )}
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*,application/pdf,.doc,.docx"
                    onChange={handleAttachment}
                  />
                  {/* Slash command popover */}
                  {slashMenuOpen && (
                    <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg p-1">
                      {slashTemplates
                        .filter((t: any) => !slashFilter || t.name.toLowerCase().includes(slashFilter.toLowerCase()))
                        .slice(0, 8)
                        .map((t: any) => (
                          <button
                            key={t.id}
                            className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted/80 flex items-center gap-2"
                            onClick={() => {
                              setNewMessage(t.content);
                              setSlashMenuOpen(false);
                              setSlashFilter('');
                            }}
                          >
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{t.name}</span>
                          </button>
                        ))}
                      {slashTemplates.filter((t: any) => !slashFilter || t.name.toLowerCase().includes(slashFilter.toLowerCase())).length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">No templates found</p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-xl text-muted-foreground hover:text-foreground flex-shrink-0"
                          title="Emoji picker"
                        >
                          <Smile className="h-5 w-5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent side="top" align="start" className="w-auto p-0 border-0">
                        <Picker data={data} onEmojiSelect={handleEmojiSelect} theme="light" previewPosition="none" skinTonePosition="none" />
                      </PopoverContent>
                    </Popover>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-xl text-muted-foreground hover:text-foreground flex-shrink-0"
                      title="Attach file"
                      disabled={attachUploading || isBranchUnselected}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {attachUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-xl text-violet-500 hover:text-violet-600 hover:bg-violet-500/10 flex-shrink-0"
                      onClick={handleAiSuggest}
                      disabled={aiSuggesting || messages.length === 0}
                      title="AI Suggest Reply"
                      data-testid="button-ai-suggest"
                    >
                      {aiSuggesting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                    </Button>
                    {/* Whisper toggle */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`rounded-xl flex-shrink-0 ${whisperMode ? 'text-amber-500 bg-amber-500/10' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setWhisperMode(!whisperMode)}
                      title="Internal Note (Whisper Mode)"
                    >
                      <Eye className="h-5 w-5" />
                    </Button>
                    <Input
                      placeholder={isBranchUnselected ? 'Select a branch to send messages…' : whisperMode ? 'Write an internal note…' : 'Type a message or / for templates…'}
                      value={newMessage}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewMessage(val);
                        if (val.trim().length > 0) setTyping(true); else setTyping(false);
                        if (val === '/') {
                          setSlashMenuOpen(true);
                          setSlashFilter('');
                        } else if (val.startsWith('/')) {
                          setSlashMenuOpen(true);
                          setSlashFilter(val.slice(1));
                        } else {
                          setSlashMenuOpen(false);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setSlashMenuOpen(false);
                        if (e.key === 'Enter' && !e.shiftKey && !slashMenuOpen) handleSend();
                      }}
                      disabled={isBranchUnselected}
                      className={`flex-1 rounded-xl border-0 focus-visible:ring-1 disabled:opacity-60 ${whisperMode ? 'bg-amber-500/5 ring-1 ring-amber-500/20' : 'bg-muted/50'}`}
                      data-testid="input-new-message"
                    />
                    <Button
                      onClick={handleSend}
                      disabled={!newMessage.trim() || sendMessage.isPending || isBranchUnselected}
                      size="icon"
                      className={`rounded-xl text-white flex-shrink-0 ${
                        selectedContact?.platform === 'instagram'
                          ? 'bg-pink-500 hover:bg-pink-600'
                          : selectedContact?.platform === 'messenger'
                          ? 'bg-blue-500 hover:bg-blue-600'
                          : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                      data-testid="button-send-message"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              /* Empty state */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto flex items-center justify-center gap-3 mb-4">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                      <MessageSquare className="h-7 w-7 text-emerald-500" />
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-pink-500/10 flex items-center justify-center">
                      <Instagram className="h-7 w-7 text-pink-500" />
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                      <Facebook className="h-7 w-7 text-blue-500" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Unified Inbox</h3>
                  <p className="text-sm text-muted-foreground max-w-xs mb-4">
                    All your WhatsApp, Instagram and Messenger conversations in one place. Select a chat or start a new one.
                  </p>
                  {!isBranchUnselected && (
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={handleOpenNewChat}
                      data-testid="button-start-new-chat-empty"
                    >
                      <Plus className="h-4 w-4" /> New Chat
                    </Button>
                  )}
                  {isBranchUnselected && (
                    <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 rounded-lg px-3 py-2 max-w-xs mx-auto">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      Select a specific branch from the selector above to send messages
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Context Panel (desktop only, when contact selected & opened) ─── */}
          {selectedContact && contextPanelOpen && (
            <div className="hidden xl:flex w-[300px] border-l border-border/50 flex-col bg-card overflow-y-auto">
              <div className="p-5 space-y-5">
                {/* Profile card */}
                <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-500/10 dark:to-teal-500/10 p-5 shadow-sm shadow-emerald-200/40 text-center">
                  <Avatar className="h-16 w-16 mx-auto mb-3 ring-2 ring-emerald-500/30">
                    {selectedContact.contact_avatar_url && (
                      <AvatarImage src={selectedContact.contact_avatar_url} alt={selectedContact.contact_name || 'avatar'} />
                    )}
                    <AvatarFallback className="bg-emerald-500 text-white text-xl font-bold">
                      {(selectedContact.contact_name || selectedContact.phone_number)?.[0]?.toUpperCase() || <User className="h-6 w-6" />}
                    </AvatarFallback>
                  </Avatar>
                  <h3 className="font-semibold text-foreground text-base break-words">
                    {displayLabel(selectedContact)}
                  </h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedContact.phone_number);
                      toast.success('Phone copied');
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mt-1"
                  >
                    <Phone className="h-3 w-3" />
                    {selectedContact.phone_number}
                  </button>
                  <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                    {selectedContact.member_id ? (
                      <Badge className="bg-emerald-500 text-white">Member</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">Lead</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {selectedContact.platform === 'instagram' ? 'Instagram' : selectedContact.platform === 'messenger' ? 'Messenger' : 'WhatsApp'}
                    </Badge>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="space-y-2">
                  {!selectedContact.member_id && (
                    <Button
                      variant="default"
                      size="sm"
                      className="w-full rounded-xl gap-2 bg-violet-600 hover:bg-violet-700"
                      onClick={() => setConvertLeadOpen(true)}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Convert to Lead
                    </Button>
                  )}
                  {selectedContact.member_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full rounded-xl gap-2"
                      onClick={() => navigate('/members')}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View Member Profile
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full rounded-xl gap-2"
                    onClick={() => setTransferStaffOpen(true)}
                  >
                    <Users className="h-3.5 w-3.5" />
                    Assign to Staff
                  </Button>
                </div>

                {/* Member context (membership + last attendance) */}
                {selectedContact.member_id && (
                  <ContactMemberContext
                    memberId={selectedContact.member_id}
                    onInsert={(text) => setNewMessage(prev => (prev ? prev + '\n' : '') + text)}
                  />
                )}

                {/* Stats */}
                {contactStats && (
                  <div className="rounded-2xl bg-muted/40 p-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Conversation</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-bold text-foreground">{contactStats.total}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Total</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-emerald-600">{contactStats.inbound}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">In</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-blue-600">{contactStats.outbound}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Out</p>
                      </div>
                    </div>
                    {contactStats.lastSeen && (
                      <p className="text-[11px] text-muted-foreground mt-3 text-center">
                        Last activity {format(new Date(contactStats.lastSeen), 'dd MMM, HH:mm')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── New Chat Drawer ────────────────────────────────────────────────── */}
      <ResponsiveSheet open={newChatOpen} onOpenChange={setNewChatOpen} width="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10">
              <MessageSquare className="h-4 w-4 text-emerald-500" />
            </div>
            New Chat
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Enter a phone number to start a new WhatsApp conversation.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <div className="space-y-4 py-4 flex-1">
          <div className="space-y-2">
            <Label htmlFor="new-chat-phone">Phone Number *</Label>
            <Input
              id="new-chat-phone"
              placeholder="+91 98765 43210"
              value={newChatPhone}
              onChange={(e) => setNewChatPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStartNewChat()}
              data-testid="input-new-chat-phone"
            />
            <p className="text-xs text-muted-foreground">
              Include country code (e.g. +91 for India)
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-chat-name">Contact Name (optional)</Label>
            <Input
              id="new-chat-name"
              placeholder="e.g. John Doe"
              value={newChatName}
              onChange={(e) => setNewChatName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStartNewChat()}
              data-testid="input-new-chat-name"
            />
          </div>
        </div>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => setNewChatOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleStartNewChat}
            disabled={!newChatPhone.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid="button-start-chat"
          >
            Open Chat
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheet>

      {/* ── Clear Chat Confirmation Dialog (destructive — kept as Dialog) ──── */}
      <Dialog open={clearChatConfirmOpen} onOpenChange={setClearChatConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Chat History
            </DialogTitle>
            <DialogDescription>
              This permanently removes the chat history from your CRM database. <strong>The recipient will still see all messages on their {selectedContact?.platform === 'instagram' ? 'Instagram' : selectedContact?.platform === 'messenger' ? 'Messenger' : 'WhatsApp'}</strong> — Meta does not allow apps to delete messages from a user's phone. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClearChatConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearChat}>
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer to Staff Sheet */}
      <ResponsiveSheet open={transferStaffOpen} onOpenChange={setTransferStaffOpen} width="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Transfer to Staff
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Assign this conversation to a staff member.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <ScrollArea className="max-h-[60dvh] sm:max-h-[70vh] mt-4">
          <div className="space-y-1 pr-2">
            {staffList.map((staff: any) => (
              <button
                key={staff.id}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/80 transition-colors text-left"
                onClick={async () => {
                  if (!selectedContact || !selectedBranch || selectedBranch === 'all') return;
                  // Use atomic set_handoff RPC: pauses bot, assigns staff, mirrors lead/member, notifies in-app
                  const { error: rpcErr } = await supabase.rpc('set_handoff', {
                    _phone: selectedContact.phone_number,
                    _reason: 'Manual assignment from chat',
                    _branch_id: selectedBranch,
                    _assigned_to: staff.id,
                  });
                  if (rpcErr) {
                    toast.error(rpcErr.message);
                    return;
                  }
                  // Fire personal-WhatsApp ping (in-app notification is also queued by the function)
                  supabase.functions.invoke('notify-staff-handoff', {
                    body: {
                      staff_user_id: staff.id,
                      member_phone: selectedContact.phone_number,
                      reason: 'Manual assignment from chat',
                      branch_id: selectedBranch,
                    },
                  }).catch(() => {/* best-effort */});
                  setBotActive(false);
                  queryClient.invalidateQueries({ queryKey: ['whatsapp-chat-settings'] });
                  setTransferStaffOpen(false);
                  toast.success(`Chat assigned to ${staff.full_name}`);
                }}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {staff.full_name?.[0]?.toUpperCase() || '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{staff.full_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{staff.role}</p>
                </div>
              </button>
            ))}
            {staffList.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Loading staff...</p>
            )}
          </div>
        </ScrollArea>
      </ResponsiveSheet>

      {/* Convert to Lead Drawer */}
      <AddLeadDrawer
        open={convertLeadOpen}
        onOpenChange={setConvertLeadOpen}
        defaultBranchId={selectedBranch !== 'all' ? selectedBranch : undefined}
        prefill={leadPrefill}
      />

      {/* Save as Contact drawer (for unknown numbers) */}
      <ResponsiveSheet open={saveContactOpen} onOpenChange={setSaveContactOpen}>
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Save as Contact</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Add this number to your Contact Book so future chats show the name.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <div className="space-y-4 mt-2">
          <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono">{selectedContact ? formatPhoneDisplay(selectedContact.phone_number) : ''}</span>
          </div>
          <div className="space-y-2">
            <Label>Full name *</Label>
            <Input
              value={saveContactForm.full_name}
              onChange={(e) => setSaveContactForm({ ...saveContactForm, full_name: e.target.value })}
              placeholder="e.g. Ravi Kumar"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={saveContactForm.category}
                onValueChange={(v) => setSaveContactForm({ ...saveContactForm, category: v })}
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
              <Label>Company</Label>
              <Input
                value={saveContactForm.company}
                onChange={(e) => setSaveContactForm({ ...saveContactForm, company: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={saveContactForm.notes}
              onChange={(e) => setSaveContactForm({ ...saveContactForm, notes: e.target.value })}
              placeholder="Anything worth remembering"
            />
          </div>
        </div>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => setSaveContactOpen(false)}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!selectedContact) return;
              if (!saveContactForm.full_name.trim()) {
                toast.error('Name is required');
                return;
              }
              if (!selectedBranch || selectedBranch === 'all') {
                toast.error('Pick a specific branch first');
                return;
              }
              try {
                await upsertContact({
                  branch_id: selectedBranch,
                  phone: selectedContact.phone_number,
                  full_name: saveContactForm.full_name.trim(),
                  category: saveContactForm.category,
                  company: saveContactForm.company || null,
                  notes: saveContactForm.notes || null,
                });
                toast.success('Contact saved');
                setSaveContactOpen(false);
                queryClient.invalidateQueries({ queryKey: ['chat-identities'] });
              } catch (e: any) {
                toast.error(e.message || 'Failed to save contact');
              }
            }}
          >
            Save Contact
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheet>
    </AppLayout>
  );
}
