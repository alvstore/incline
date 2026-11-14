/** Single source of truth for the public business identity (NAP).
 *  index.html, public/ai.txt and public/llms-full.txt mirror these by hand
 *  (static files crawlers read); businessIdentity.test.ts keeps them aligned. */
export const BUSINESS_IDENTITY = {
  name: 'The Incline Life',
  legalName: 'The Incline Life by Incline',
  streetAddress: 'Plot 44-55, near Kheda Circle, Sector 14, Hiran Magri',
  locality: 'Udaipur',
  region: 'Rajasthan',
  postalCode: '313002',
  country: 'India',
  phone: '+91 82982 93003',
  email: 'info@theinclinelife.com',
  hours: 'Open 24 hours, 7 days',
} as const;

export const BUSINESS_ADDRESS = `${BUSINESS_IDENTITY.streetAddress}, ${BUSINESS_IDENTITY.locality}, ${BUSINESS_IDENTITY.region} ${BUSINESS_IDENTITY.postalCode}, ${BUSINESS_IDENTITY.country}`;

const PLACEHOLDERS = ['123 Fitness Street, Mumbai, India', '+91 98765 43210', 'Incline Fitness'];
/** Replaces legacy placeholder contact values saved in an old CMS theme. */
export const realOr = (value: string | undefined | null, fallback: string) =>
  !value || PLACEHOLDERS.includes(value.trim()) ? fallback : value;
