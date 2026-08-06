import { writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLCanvasElement = dom.window.HTMLCanvasElement;
(globalThis as any).Image = dom.window.Image;
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
(globalThis as any).fetch = async () => ({ ok: false } as any);
const { buildPlanPdf } = await import('/dev-server/src/utils/pdfBlob');
const mk = (day: string) => ({ day,
  breakfast: { meal: 'Oats + Milk + Banana', time: '8:30–9:00 AM', quantity: '1 bowl', calories: 420, protein: 18, carbs: 63, fats: 10 },
  snack1: { meal: 'Paneer Cubes', time: '11:00 AM', quantity: '100g', calories: 260, protein: 18, carbs: 4, fats: 20 },
  lunch: { meal: 'Soya Chunk Curry with 2 Roti', time: '1:30 PM', quantity: '1 bowl + 2 roti', calories: 470, protein: 32, carbs: 54, fats: 12 },
  snack2: { meal: 'Sprouts Salad', time: '5:00 PM', quantity: '1 bowl', calories: 180, protein: 12, carbs: 24, fats: 4 },
  dinner: { meal: 'Paneer + Roti', time: '8:00 PM', quantity: '100g paneer + 2 roti', calories: 560, protein: 34, carbs: 40, fats: 22 },
});
const data = { name: 'Priyanka Lohar - High Protein Lactation Support & Weight Loss', type: 'weight_loss',
  meals: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(mk) };
const blob = await buildPlanPdf({ name: data.name, type: 'diet', member_name: 'Priyanka Lohar', trainer_name: 'Coach', data } as any,
  { companyName: 'Incline', tagline: 'Rise. Reflect. Repeat.', legalName: 'The Incline Life by Incline', website: 'theincline.in', supportEmail: 'hello@theincline.in', logoUrl: null, branch: { name: 'Incline', phone: '', email: '' } } as any);
writeFileSync('/tmp/real.pdf', Buffer.from(await blob.arrayBuffer()));
console.log('bytes', (await blob.arrayBuffer()).byteLength);
