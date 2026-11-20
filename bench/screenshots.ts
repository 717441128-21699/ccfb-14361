/** 截取四个页签的界面图,供视觉验收 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profileDir = join(tmpdir(), 'post-road-edge-shot');
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9335',
  `--user-data-dir=${profileDir}`, '--window-size=1600,1100', 'http://localhost:5173/',
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const t = (await (await fetch('http://127.0.0.1:9335/json/list')).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      const p = t.find((x) => x.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('no target');
}
const ws = new WebSocket(await wsUrl());
let id = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.id) pending.get(m.id)?.(m), pending.delete(m.id); };
await new Promise((r) => (ws.onopen = r));
const send = (method: string, params: Record<string, unknown> = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
};
const ev = async <T,>(expr: string): Promise<T> =>
  ((await send('Runtime.evaluate', { expression: expr, returnByValue: true })) as { result: { result: { value: T } } }).result.result.value;

await sleep(3500); // 等几个游戏日积累数据
await ev(`document.getElementById('btn-pause').click()`);
await sleep(300);

const tabs: Array<[string, string]> = [
  ['monitor', 'shots/01-monitor.png'],
  ['map', 'shots/02-map.png'],
  ['towns', 'shots/03-towns.png'],
  ['caravans', 'shots/04-caravans.png'],
];
mkdirSync('shots', { recursive: true });

for (const [tab, file] of tabs) {
  await ev(`document.querySelector('[data-tab="${tab}"]').click()`);
  await sleep(700);
  const shot = (await send('Page.captureScreenshot', { format: 'png' })) as { result?: { data?: string } };
  if (shot.result?.data) {
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('已保存', file);
  }
}
edge.kill();
process.exit(0);
