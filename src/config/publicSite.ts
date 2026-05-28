/**
 * Static configuration for the public marketing site.
 * The public site MUST NOT read from the backend — all branch / service
 * content lives here so pages render instantly and remain crawlable.
 */

export interface PublicBranch {
  slug: string;
  name: string;
  city: string;
  address: string;
  hours: string;
  phone?: string;
  mapUrl?: string;
  facilities: string[];
  classes: string[];
  pt: boolean;
  addOns: string[];
}

export const PUBLIC_BRANCHES: PublicBranch[] = [
  {
    slug: 'udaipur-flagship',
    name: 'The Incline — Udaipur Flagship',
    city: 'Udaipur',
    address: 'Udaipur, Rajasthan, India',
    hours: '05:00 – 23:00, all days',
    facilities: [
      'Panatta Strength Floor',
      'Functional Training Zone',
      'Cardio Suite',
      'Sauna',
      'Steam Room',
      'Ice Bath',
      'Recovery Lounge',
    ],
    classes: ['Yoga', 'HIIT', 'Strength & Conditioning', 'Mobility'],
    pt: true,
    addOns: ['1:1 Personal Training', 'Body Composition Scan', 'Recovery Day Pass'],
  },
];

export interface PublicFAQ {
  q: string;
  a: string;
}

export const PUBLIC_FAQS: PublicFAQ[] = [
  {
    q: 'Where is The Incline located?',
    a: 'Our flagship club is in Udaipur, Rajasthan. More locations are on the way.',
  },
  {
    q: 'What are your operating hours?',
    a: 'We are open every day from 5:00 AM to 11:00 PM.',
  },
  {
    q: 'Do you offer personal training?',
    a: 'Yes — certified coaches deliver 1:1 personal training across strength, conditioning, and mobility.',
  },
  {
    q: 'What recovery facilities are available?',
    a: 'Members enjoy access to a sauna, steam room, ice bath and a dedicated recovery lounge.',
  },
  {
    q: 'Can I tour the facility before joining?',
    a: 'Absolutely. Use the Register interest button to book a guided tour.',
  },
];
