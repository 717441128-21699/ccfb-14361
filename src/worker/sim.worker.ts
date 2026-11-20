/// <reference lib="webworker" />
import { EconomyEngine } from '../core/engine';
import { buildSnapshot, type Snapshot, type WorkerRequest, type WorkerResponse } from '../core/protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const TICK_MS = 50; // 20 ticks/s
const SUBSTEPS_PER_DAY = 8;
const SNAPSHOT_EVERY_MS = 100; // 界面刷新 10fps,模拟本身不受节流影响

let engine: EconomyEngine | null = null;
let running = false;
let speed = 4; // 游戏日/秒
let timer: ReturnType<typeof setInterval> | null = null;
let lastDayMs = 0; // 最近一个完整游戏日的纯计算耗时(不含子步间等待)
let dayComputeMs = 0;
let lastSnapshotAt = 0;

function post(msg: WorkerResponse): void {
  ctx.postMessage(msg);
}

function sendSnapshot(force = false): void {
  if (!engine) return;
  const now = performance.now();
  if (!force && now - lastSnapshotAt < SNAPSHOT_EVERY_MS) return;
  lastSnapshotAt = now;
  const snapshot: Snapshot = buildSnapshot(engine, lastDayMs);
  post({ type: 'snapshot', snapshot });
}

function advanceOnce(): void {
  if (!engine) return;
  // 只累计 CPU 计算时间;子步之间的调度等待不计入,这才是"每日经济结算"的真实成本
  if (engine.substep === 0) dayComputeMs = 0;
  const t0 = performance.now();
  const result = engine.step();
  dayComputeMs += performance.now() - t0;
  if (result.settled) {
    lastDayMs = dayComputeMs;
    post({ type: 'settled', day: engine.day, alerts: result.newAlerts, settleMs: lastDayMs });
  }
}

function tick(): void {
  if (!engine || !running) return;
  const substepsNeeded = Math.max(1, Math.round((speed * SUBSTEPS_PER_DAY * TICK_MS) / 1000));
  for (let i = 0; i < substepsNeeded; i++) advanceOnce();
  sendSnapshot();
}

function start(): void {
  if (timer !== null) return;
  timer = setInterval(tick, TICK_MS);
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
    case 'reset': {
      engine = new EconomyEngine(msg.seed, msg.caravanCount);
      lastDayMs = 0;
      running = true;
      start();
      sendSnapshot(true);
      break;
    }
    case 'setSpeed':
      speed = msg.speed;
      break;
    case 'pause':
      running = false;
      break;
    case 'resume':
      running = true;
      break;
    case 'stepOnce': {
      if (!engine) break;
      running = false;
      advanceOnce();
      sendSnapshot(true);
      break;
    }
    case 'playerBuy': {
      if (!engine) break;
      post({ type: 'actionResult', ...engine.playerBuy(msg.ci, msg.qty) });
      sendSnapshot(true);
      break;
    }
    case 'playerSell': {
      if (!engine) break;
      post({ type: 'actionResult', ...engine.playerSell(msg.ci, msg.qty) });
      sendSnapshot(true);
      break;
    }
    case 'playerDispatch': {
      if (!engine) break;
      post({ type: 'actionResult', ...engine.playerDispatch(msg.townId) });
      sendSnapshot(true);
      break;
    }
    case 'exploitDemo': {
      if (!engine) break;
      post({ type: 'exploitReport', report: engine.runExploitDemo(msg.ci, msg.rounds) });
      sendSnapshot(true);
      break;
    }
  }
};
