/** 玩家交易端到端:在浏览器里实际买入/派发,验证现金扣减与持仓变化 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profileDir = join(tmpdir(), 'post-road-edge-trade');
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9336',
  `--user-data-dir=${profileDir}`, 'http://localhost:5173/',
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const t = (await (await fetch('http://127.0.0.1:9336/json/list')).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
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

let failures = 0;
const check = (name: string, cond: boolean, detail = ''): void => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name} ${detail}`);
  if (!cond) failures++;
};

await sleep(3000);
await ev(`document.getElementById('btn-pause').click()`);
await sleep(300);
await ev(`document.querySelector('[data-tab="towns"]').click()`);
await sleep(400);

// 若玩家在途,单步推进到抵达
for (let i = 0; i < 12 && (await ev<boolean>(`!document.getElementById('trade-panel')`)); i++) {
  await ev(`document.getElementById('btn-step').click()`);
  await sleep(300);
}
const hasPanel = await ev<boolean>(`!!document.getElementById('trade-panel')`);
check('玩家商队已驻扎并显示交易面板', hasPanel);

const cashBefore = await ev<number>(`Number(document.querySelector('#trade-panel b').textContent.replace(/[^0-9.-]/g,''))`);
await ev(`(document.getElementById('qty-0')||{}).value = '50'`);
await ev(`document.querySelector('[data-action="buy"][data-ci="0"]').click()`);
await sleep(500);
const cashAfter = await ev<number>(`Number(document.querySelector('#trade-panel b').textContent.replace(/[^0-9.-]/g,''))`);
check('买入后现金减少(关税+货款已扣)', cashAfter < cashBefore, `${cashBefore.toFixed(0)} → ${cashAfter.toFixed(0)}`);
const holdingText = await ev<string>(`document.querySelector('#trade-panel .trade-row').textContent`);
check('持仓数量更新为 50', holdingText.includes('50'), holdingText.replace(/\s+/g, ' ').slice(0, 80));

// 派发到相邻城镇
const dispatchBtn = await ev<boolean>(`!!document.querySelector('[data-dispatch]')`);
check('存在可派发的相邻驿路按钮', dispatchBtn);
if (dispatchBtn) {
  await ev(`document.querySelector('[data-dispatch]').click()`);
  await sleep(400);
  const inTransit = await ev<boolean>(`document.querySelector('main').textContent.includes('运输中')`);
  check('派发后进入运输状态', inTransit);
}

edge.kill();
process.exit(failures ? 1 : 0);
