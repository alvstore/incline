import {
  Globe,
  Instagram,
  Facebook,
  Phone,
  MapPin,
  UserPlus,
  Search,
  Link,
  Bot,
  Mail,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';

type LeadSourceMeta = {
  label: string;
  icon: LucideIcon;
  iconClassName?: string;
};

const SOURCE_META: Record<string, LeadSourceMeta> = {
  website: { label: 'Website', icon: Globe, iconClassName: 'text-sky-600' },
  website_chatbot: { label: 'Website Chatbot', icon: MessageCircle, iconClassName: 'text-sky-600' },
  instagram: { label: 'Instagram', icon: Instagram, iconClassName: 'text-pink-600' },
  facebook: { label: 'Facebook', icon: Facebook, iconClassName: 'text-blue-600' },
  google: { label: 'Google', icon: Search, iconClassName: 'text-emerald-600' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, iconClassName: 'text-green-600' },
  whatsapp_api: { label: 'WhatsApp', icon: MessageCircle, iconClassName: 'text-green-600' },
  whatsapp_ai: { label: 'WhatsApp', icon: MessageCircle, iconClassName: 'text-green-600' },
  whatsapp_ad: { label: 'WhatsApp', icon: MessageCircle, iconClassName: 'text-green-600' },
  whatsapp_business: { label: 'WhatsApp', icon: MessageCircle, iconClassName: 'text-green-600' },
  meta_ad: { label: 'Meta Ads', icon: Facebook, iconClassName: 'text-blue-600' },
  referral: { label: 'Referral', icon: UserPlus, iconClassName: 'text-violet-600' },
  walk_in: { label: 'Walk-in', icon: MapPin, iconClassName: 'text-orange-600' },
  phone: { label: 'Phone', icon: Phone, iconClassName: 'text-amber-600' },
  email: { label: 'Email', icon: Mail, iconClassName: 'text-cyan-600' },
  api: { label: 'API', icon: Link, iconClassName: 'text-slate-600' },
  zapier: { label: 'Zapier', icon: Link, iconClassName: 'text-orange-500' },
  direct: { label: 'Direct', icon: Globe, iconClassName: 'text-slate-600' },
  embed: { label: 'Embed', icon: Link, iconClassName: 'text-indigo-600' },
  unknown: { label: 'Unknown', icon: Bot, iconClassName: 'text-slate-500' },
};

function normalizeSource(input?: string | null): string {
  if (!input) return 'direct';
  return input.trim().toLowerCase().replace(/\s+/g, '_');
}

export function getLeadSourceMeta(source?: string | null): LeadSourceMeta {
  const key = normalizeSource(source);
  return SOURCE_META[key] || {
    label: source ? source.replace(/[_-]/g, ' ') : SOURCE_META.direct.label,
    icon: SOURCE_META.unknown.icon,
    iconClassName: SOURCE_META.unknown.iconClassName,
  };
}

export function normalizeLeadSource(source?: string | null): string {
  return normalizeSource(source);
}