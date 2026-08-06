import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
try { Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true }); } catch {}
(globalThis as any).HTMLCanvasElement = dom.window.HTMLCanvasElement;
(globalThis as any).Image = dom.window.Image;
(globalThis as any).FileReader = dom.window.FileReader;
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
const { buildPlanPdf } = await import('/dev-server/src/utils/pdfBlob');
const p = JSON.parse(readFileSync('/tmp/plan.json','utf8'));
const blob = await buildPlanPdf({
  name: p.plan_name, type: p.plan_type, description: p.description,
  member_name: 'Mohit Gurjar', trainer_name: undefined,
  branch_id: p.branch_id, data: p.plan_data,
});
writeFileSync('/tmp/plan.pdf', Buffer.from(await blob.arrayBuffer()));
console.log('pdf bytes', (await blob.arrayBuffer()).byteLength);
