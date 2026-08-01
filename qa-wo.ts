import { writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).HTMLCanvasElement = dom.window.HTMLCanvasElement;
(globalThis as any).Image = dom.window.Image;
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };
(globalThis as any).fetch = async () => ({ ok: false } as any);
const { buildPlanPdf } = await import('./src/utils/pdfBlob');
const brand = { companyName:'Incline', tagline:'Rise. Reflect. Repeat.', legalName:'The Incline Life by Incline', website:'theincline.in', supportEmail:'hello@theincline.in', logoUrl:null, branch:{ name:'Incline — Udaipur', phone:'+91 98876 01200', email:'hello@theincline.in' } };
const mkDay = (day:string, focus:string) => ({ day, focus, warmup:'5 min treadmill brisk walk (incline 3) • Arm circles 15 each way • Band pull-aparts x20 • Cat-cow x10 slow controlled reps', cooldown:'5 min easy cycle • Chest doorway stretch 30s/side • Lat hang 30s • Box breathing 2 min', exercises:[
 { name:'Horizontal Chest Press', equipment:'Panatta Plate-Loaded Chest Press', sets:4, reps:'8-10', rest:'90s', weight:'40kg', form_tips:['Keep shoulder blades retracted and pinned to the pad throughout the set.','Lower under control for 3 seconds, then drive up explosively without locking elbows harshly.','Exhale on the press, inhale on the way down.'] },
 { name:'Incline Dumbbell Press', equipment:'Adjustable bench 30°', sets:3, reps:12, rest:'75s', notes:'Elbows tucked ~45 degrees. Do not let the dumbbells clash at the top — stop just short.' },
 { name:'Cable Fly', equipment:'Dual Cable Crossover', sets:3, reps:15, rest:'45s' },
 { name:'Triceps Rope Pushdown', equipment:'Cable Stack', sets:3, reps:12, rest:'45s', weight:'25kg', form_tips:'Lock elbows at your ribs; only forearms move.' },
]});
const workout = { name:'FAT LOSS PROGRAM', type:'workout' as const, member_name:'Aarav Sharma', member_code:'INC-26-0042', trainer_name:'Coach Riya', goal:'Fat Loss', data:{ weeks:[{ week:1, days:[ mkDay('Monday','Chest & Triceps'), mkDay('Tuesday','Back & Biceps'), { day:'Wednesday', focus:'Rest', exercises:[] }, mkDay('Thursday','Legs'), mkDay('Friday','Shoulders & Core') ]}] }, notes:'Progress load by 2.5kg once all sets hit the top of the rep range.' };
const blob: Blob = await buildPlanPdf(workout as any, brand as any);
writeFileSync('/tmp/qa-workout.pdf', Buffer.from(await blob.arrayBuffer()));
console.log('ok');
