/**
 * 无头浏览器冒烟测试(CD over CDP,零依赖):
 * 启动 Edge headless → 打开页面 → 等待 Worker 快照 → 校验四个页签渲染与控制台错误
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://localhost:5173/';
// 必须放在 Vite 工作区之外,否则文件监听器会因 Edge 锁定 cache.db(EBUSY)崩溃
const profileDir = join(tmpdir(), 'post-road-edge-profile');
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=9333',
  `--user-data-dir=${profileDir}`,
  '--window-size=1600,1000',
  URL,
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getPageWsUrl(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9333/json/list');
      const targets = (await res.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
      const pages = targets.filter((t) => t.type === 'page');
      console.log('CDP targets:', pages.map((p) => p.url).join(' | '));
      const page = pages.find((p) => p.url.includes(URL)) ?? pages[0];
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('CDP page target not available');
}

const wsUrl = await getPageWsUrl();
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map<number, (v: unknown) => void>();
const consoleErrors: string[] = [];
const consoleLogs: string[] = [];

ws.onmessage = (ev: MessageEvent) => {
  const msg = JSON.parse(ev.data as string);
  if (process.env.CDP_DEBUG && msg.id) console.log('CDP ←', msg.id, JSON.stringify(msg).slice(0, 200));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)!(msg);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown') {
    const text =
      msg.params?.exceptionDetails?.text ||
      msg.params?.args?.map((a: { value?: unknown; description?: string }) => a.value ?? a.description ?? '').join(' ') ||
      '';
    (msg.method === 'Runtime.exceptionThrown' ? consoleErrors : consoleLogs).push(text);
  }
};
await new Promise((r) => (ws.onopen = r));

function send(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: { message?: string } }> {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve as (v: unknown) => void));
}

await send('Page.enable');
await send('Runtime.enable');

// 等待主界面渲染(Worker 首帧快照到达后 #app 才有 topbar)
async function evalJs<T>(expression: string): Promise<T> {
  const r = (await send('Runtime.evaluate', { expression, returnByValue: true })) as {
    result?: { result?: { value?: T; type?: string } };
    error?: { message?: string };
  };
  if (r.error) throw new Error(`CDP eval failed: ${r.error.message}`);
  return r.result?.result?.value as T;
}

let rendered = false;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  if (await evalJs<boolean>(`!!document.querySelector('header.topbar')`)) {
    rendered = true;
    break;
  }
}

if (!rendered) {
  console.log('❌ 界面未渲染');
  console.log('location:', await evalJs<string>('location.href'));
  console.log('#app 子节点数:', await evalJs<number>('document.getElementById("app")?.childElementCount ?? -1'));
  console.log('#app 内容前 300 字:', await evalJs<string>('(document.getElementById("app")?.innerHTML ?? "").slice(0,300)'));
  console.log('body 子节点:', await evalJs<string>('Array.from(document.body.children).map(c=>c.tagName).join(",")'));
  console.log('Worker 可用:', await evalJs<boolean>('typeof Worker === "function"'));
  console.log('控制台日志:', consoleLogs.slice(0, 10));
  console.log('控制台错误:', consoleErrors);
  edge.kill();
  process.exit(1);
}
console.log('✅ Worker 首帧快照到达,主界面已渲染');

// 暂停模拟,避免 100ms 快照重建 DOM 干扰交互测试
await evalJs(`document.getElementById('btn-pause').click()`);
await sleep(300);

let failures = 0;
// 即时断言:在当前页签下立刻求值,不能攒到切页之后
async function assertNow(name: string, expr: string): Promise<void> {
  const ok = await evalJs<boolean>(expr);
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}`);
  if (!ok) failures++;
}

// 标签切换:点击后确认 active 态,未生效则重试(防御 DOM 重建间隙)
async function switchTab(tab: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await evalJs(`document.querySelector('[data-tab="${tab}"]').click()`);
    await sleep(120);
    if (await evalJs<boolean>(`document.querySelector('[data-tab="${tab}"].active') !== null`)) return;
  }
  throw new Error(`无法切换到页签 ${tab}`);
}

// —— 监控页(默认页签)——
await assertNow('监控页指标卡', `document.querySelectorAll('.metric').length >= 4`);
await assertNow('城镇监控表 30 行', `document.querySelectorAll('tbody tr').length >= 30`);
await assertNow('页签导航 4 个', `document.querySelectorAll('nav.tabs button').length === 4`);

// —— 地图页 ——
await switchTab('map');
await sleep(200);
await assertNow('地图 SVG 道路(≥30 条)', `document.querySelectorAll('svg line').length >= 30`);
await assertNow('地图城镇节点 30 个', `document.querySelectorAll('svg g circle').length >= 30`);
await assertNow('玩家商队标记', `!!document.querySelector('circle.player-marker')`);
await assertNow('千支商队在图上(圆点>900)', `document.querySelectorAll('svg circle').length > 900`);

// —— 驿站页 ——
await switchTab('towns');
await sleep(200);
await assertNow('驿站列表 30 行', `document.querySelectorAll('tbody tr').length >= 30`);
// 玩家商队在途时显示运输卡,驻扎时显示交易面板,二者必居其一
await assertNow('玩家面板(交易或运输状态)', `!!(document.getElementById('trade-panel') || document.querySelector('main').textContent.includes('运输中'))`);

// —— 商队页 ——
await switchTab('caravans');
await sleep(200);
await assertNow('商队汇总商号行(≥9)', `document.querySelectorAll('tbody tr').length >= 9`);

// —— 回监控页,验证刷钱复现按钮 ——
await switchTab('monitor');
await sleep(200);
await evalJs(`document.getElementById('btn-exploit').click()`);
await sleep(1200);
await assertNow('刷钱复现器产出逐轮日志', `!!document.querySelector('.exploit-log') && document.querySelector('.exploit-log').textContent.includes('净利')`);

const day = await evalJs<number>(`Number(document.querySelector('header.topbar b').textContent.replace(/[^0-9]/g,''))`);
console.log(`\n当前游戏日:第 ${day} 日(时间推进正常)`);

const realErrors = consoleErrors.filter((e) => e && !e.includes('favicon'));
if (realErrors.length) {
  console.log('❌ 控制台异常:', realErrors);
  failures++;
} else {
  console.log('✅ 控制台无未捕获异常');
}

edge.kill();
process.exit(failures ? 1 : 0);
