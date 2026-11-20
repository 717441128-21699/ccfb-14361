import type { ExploitReport } from '../core/engine';
import type { Snapshot, WorkerRequest, WorkerResponse } from '../core/protocol';

type Listener = (snapshot: Snapshot) => void;
type ActionListener = (ok: boolean, reason?: string) => void;
type ReportListener = (report: ExploitReport) => void;
type SettleListener = (day: number, settleMs: number, alertCount: number) => void;

/** 主线程侧 Worker 封装:自动重放最后一次 init */
export class SimClient {
  private worker: Worker;
  private listeners = new Set<Listener>();
  private actionListeners = new Set<ActionListener>();
  private reportListeners = new Set<ReportListener>();
  private settleListeners = new Set<SettleListener>();
  private _snapshot: Snapshot | null = null;

  constructor() {
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.handle(ev.data);
    this.worker.onerror = (e) => console.error('sim worker error', e);
  }

  get snapshot(): Snapshot | null {
    return this._snapshot;
  }

  private handle(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'snapshot':
        this._snapshot = msg.snapshot;
        this.listeners.forEach((fn) => fn(msg.snapshot));
        break;
      case 'actionResult':
        this.actionListeners.forEach((fn) => fn(msg.ok, msg.reason));
        break;
      case 'exploitReport':
        this.reportListeners.forEach((fn) => fn(msg.report));
        break;
      case 'settled':
        this.settleListeners.forEach((fn) => fn(msg.day, msg.settleMs, msg.alerts.length));
        break;
    }
  }

  send(msg: WorkerRequest): void {
    this.worker.postMessage(msg);
  }

  onSnapshot(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onActionResult(fn: ActionListener): () => void {
    this.actionListeners.add(fn);
    return () => this.actionListeners.delete(fn);
  }
  onExploitReport(fn: ReportListener): () => void {
    this.reportListeners.add(fn);
    return () => this.reportListeners.delete(fn);
  }
  onSettled(fn: SettleListener): () => void {
    this.settleListeners.add(fn);
    return () => this.settleListeners.delete(fn);
  }
}
