#!/usr/bin/env node
// Builds en/paulocerqueira.pdf and pt/paulocerqueira.pdf from src/cv.<lang>.html
// with headless Edge/Chrome via the DevTools Protocol. Zero npm dependencies (Node 22+).
//
//   node scripts/build.mjs            # PDFs only
//   node scripts/build.mjs --preview  # PDFs + preview/cv.<lang>.png (page 1, rendered with pdf.js from cdnjs)
//
// Browser: set BROWSER=/path/to/chrome to override auto-detection.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const langs = ['en', 'pt'];
const preview = process.argv.includes('--preview');

const candidates = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
].filter(Boolean);
const browserPath = candidates.find((p) => existsSync(p));
if (!browserPath) throw new Error('No Edge/Chrome found. Set BROWSER=/path/to/browser.');

const profile = mkdtempSync(join(tmpdir(), 'cv-build-'));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((ok, fail) => {
  let buf = '';
  const t = setTimeout(() => fail(new Error('Browser did not start')), 20000);
  browser.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(t); ok(m[1]); }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
let nextId = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, fail } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
  } else if (msg.method) listeners.forEach((l) => l(msg));
});
const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
  const id = ++nextId;
  pending.set(id, { ok, fail });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const waitFor = (method, sessionId) => new Promise((ok) => {
  const l = (m) => { if (m.method === method && m.sessionId === sessionId) { listeners.splice(listeners.indexOf(l), 1); ok(m.params); } };
  listeners.push(l);
});

async function openPage() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  return sessionId;
}
async function goto(sessionId, url) {
  const loaded = waitFor('Page.loadEventFired', sessionId);
  await send('Page.navigate', { url }, sessionId);
  await loaded;
}
const evaluate = async (sessionId, expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result.value;

try {
  const page = await openPage();
  for (const lang of langs) {
    const src = join(root, 'src', `cv.${lang}.html`);
    if (!existsSync(src)) throw new Error(`Missing ${src}`);
    await goto(page, pathToFileURL(src).href);
    await evaluate(page, 'document.fonts.ready.then(() => document.fonts.size)');
    const fontOk = await evaluate(page, 'document.fonts.check("10pt Geist")');
    const { data } = await send('Page.printToPDF', {
      preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false,
      generateTaggedPDF: true, generateDocumentOutline: false,
    }, page);
    const out = join(root, lang, 'paulocerqueira.pdf');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(data, 'base64'));
    const pages = (Buffer.from(data, 'base64').toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log(`${lang}: ${out} (${pages} page${pages === 1 ? '' : 's'}, Geist ${fontOk ? 'loaded' : 'MISSING'})`);

    if (preview) {
      const html = `<!doctype html><style>html,body{margin:0;overflow:hidden;background:#fff}</style><body><canvas id=c></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
window.done=(async()=>{const pdf=await pdfjsLib.getDocument({data:atob('${data}').split('').map(c=>c.charCodeAt(0))}).promise;
const p=await pdf.getPage(1);const v=p.getViewport({scale:2});const c=document.getElementById('c');c.width=v.width;c.height=v.height;
await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;return {w:v.width,h:v.height,n:pdf.numPages};})();
</script>`;
      const tmpHtml = join(profile, `preview-${lang}.html`);
      writeFileSync(tmpHtml, html);
      await goto(page, pathToFileURL(tmpHtml).href);
      const { w, h, n } = await evaluate(page, 'window.done');
      await send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(w), height: Math.ceil(h), deviceScaleFactor: 1, mobile: false }, page);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }, page);
      await send('Emulation.clearDeviceMetricsOverride', {}, page);
      const png = join(root, 'preview', `cv.${lang}.png`);
      mkdirSync(dirname(png), { recursive: true });
      writeFileSync(png, Buffer.from(shot.data, 'base64'));
      console.log(`${lang}: ${png} (page 1 of ${n}, per pdf.js)`);
    }
  }
} finally {
  ws.close();
  browser.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
