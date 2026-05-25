// CMS Service for managing website content and theme
// Migrated from localStorage to database (organization_settings.website_theme)

import { supabase } from '@/integrations/supabase/client';

export interface ThemeSettings {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImage: string;
  logoUrl: string;
  gymName: string;
  gymTagline: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  socialLinks: {
    instagram?: string;
    facebook?: string;
    twitter?: string;
    youtube?: string;
  };
  features: Array<{
    title: string;
    description: string;
    icon: string;
  }>;
  testimonials: Array<{
    name: string;
    quote: string;
    image?: string;
  }>;
  pricingPlans: Array<{
    name: string;
    price: number;
    duration: string;
    features: string[];
    isPopular?: boolean;
  }>;
}

const DEFAULT_THEME: ThemeSettings = {
  primaryColor: '#1e293b',
  accentColor: '#f97316',
  backgroundColor: '#0f172a',
  textColor: '#f8fafc',
  fontFamily: 'Inter',
  heroTitle: 'TRANSFORM YOUR BODY',
  heroSubtitle: 'Incline Fitness - Where Champions Are Made',
  heroImage: '/gym-hero.jpg',
  logoUrl: '/logo.png',
  gymName: 'Incline Fitness',
  gymTagline: 'Elevate Your Potential',
  contactEmail: 'info@theinclinelife.com',
  contactPhone: '+91 98765 43210',
  address: '123 Fitness Street, Mumbai, India',
  socialLinks: {
    instagram: 'https://instagram.com/inclinefitness',
    facebook: 'https://facebook.com/inclinefitness',
    twitter: 'https://twitter.com/inclinefitness',
    youtube: 'https://youtube.com/inclinefitness',
  },
  features: [
    { title: 'Premium Equipment', description: 'State-of-the-art fitness machines and free weights', icon: 'dumbbell' },
    { title: 'Expert Trainers', description: 'Certified personal trainers to guide your journey', icon: 'users' },
    { title: 'Group Classes', description: 'Yoga, HIIT, Zumba, and more group sessions', icon: 'activity' },
    { title: '24/7 Access', description: 'Train anytime with round-the-clock gym access', icon: 'clock' },
  ],
  testimonials: [
    { name: 'Rahul S.', quote: 'Lost 20kg in 6 months. The trainers here are incredibly supportive!' },
    { name: 'Priya M.', quote: 'Best gym in the city. Clean, well-equipped, and great community.' },
    { name: 'Amit K.', quote: 'The personal training program completely transformed my fitness journey.' },
  ],
  pricingPlans: [
    { name: 'Monthly', price: 2999, duration: '1 Month', features: ['Full gym access', 'Locker facility', 'Basic fitness assessment'] },
    { name: 'Quarterly', price: 7999, duration: '3 Months', features: ['Full gym access', 'Locker facility', 'Fitness assessment', '2 PT sessions'], isPopular: true },
    { name: 'Annual', price: 24999, duration: '12 Months', features: ['Full gym access', 'Premium locker', 'Monthly assessment', '12 PT sessions', 'Diet consultation'] },
  ],
};

export const cmsService = {
  // Synchronous fallback for initial render (reads localStorage cache)
  getTheme(): ThemeSettings {
    try {
      const stored = localStorage.getItem('incline_cms_theme');
      if (stored) {
        return { ...DEFAULT_THEME, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Error loading theme:', e);
    }
    return DEFAULT_THEME;
  },

  // Async version that reads from database
  async getThemeAsync(): Promise<ThemeSettings> {
    try {
      const { data } = await supabase
        .from('organization_settings')
        .select('website_theme')
        .limit(1)
        .maybeSingle();
      
      if (data?.website_theme && Object.keys(data.website_theme as object).length > 0) {
        const theme = { ...DEFAULT_THEME, ...(data.website_theme as Record<string, any>) };
        // Cache in localStorage for fast initial loads
        localStorage.setItem('incline_cms_theme', JSON.stringify(theme));
        return theme;
      }
    } catch (e) {
      console.error('Error loading theme from DB:', e);
    }
    return this.getTheme(); // Fall back to localStorage/defaults
  },

  async saveTheme(theme: Partial<ThemeSettings>) {
    try {
      const current = await this.getThemeAsync();
      const updated = { ...current, ...theme };
      
      // Save to database
      const { data: existing } = await supabase
        .from('organization_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('organization_settings')
          .update({ website_theme: updated as any })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('organization_settings')
          .insert({ name: 'Default', website_theme: updated as any } as any);
      }

      // Also cache in localStorage
      localStorage.setItem('incline_cms_theme', JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.error('Error saving theme:', e);
      // Fallback to localStorage only
      const current = this.getTheme();
      const updated = { ...current, ...theme };
      localStorage.setItem('incline_cms_theme', JSON.stringify(updated));
      return updated;
    }
  },

  resetTheme() {
    localStorage.removeItem('incline_cms_theme');
    return DEFAULT_THEME;
  },

  getDefaultTheme(): ThemeSettings {
    return DEFAULT_THEME;
  },
};
