import './ui/styles.css';
import { DEFAULT_CARAVAN_COUNT } from './core/constants';
import type { Alert } from './core/types';
import type { ExploitReport } from './core/engine';
import type { Snapshot } from './core/protocol';
import { SimClient } from './ui/sim-client';
import { MapView } from './ui/map-view';
import { renderMonitor } from './ui/monitor-view';
import { renderTowns } from './ui/town-view';
import { renderCaravans } from './ui/caravan-view';
import { renderTradePanel } from './ui/trade-panel';
import { formatMoney } from './core/constants';

type Tab = 'monitor' | 'map' | 'towns' | 'caravans';

class App {
  private readonly client = new SimClient();
  private snap: Snapshot | null = null;
  private tab: Tab = 'monitor';
  private seed = 20261121;
  private caravanCount = DEFAULT_CARAVAN_COUNT;
  private speed = 4;
  private paused = false;
  private showCaravans = true;
  private selectedTown: number | null = null;
  private selectedAlert: Alert | null = null;
  private exploitReport: ExploitReport | null = null;

  constructor() {
    this.client.onSnapshot((s) => {
      this.snap = s;
      this.render();
    });
    this.client.onActionResult((ok, reason) => this.toast(ok ? '操作成功' : `操作失败:${reason ?? '未知原因'}`, ok));
    this.client.onExploitReport((r) => {
      this.exploitReport = r;
      this.render();
    });
    this.client.onSettled((day, ms, alertCount) => {
      if (alertCount > 0) this.toast(`第 ${day} 日结算完成,新增 ${alertCount} 条异常利润报警(耗时 ${ms.toFixed(2)}ms)`, false);
    });
    this.installWindowHooks();
    this.client.send({ type: 'init', seed: this.seed, caravanCount: this.caravanCount });
  }

  private installWindowHooks(): void {
    window.__selectTown = (id: number | null) => {
      this.selectedTown = id;
      if (id !== null) this.tab = 'towns';
      this.render();
    };
    window.__focusTownOnMap = (id: number) => {
      this.selectedTown = id;
      this.tab = 'map';
      this.render();
    };
    window.__scrollTrade = () => {
      document.getElementById('trade-panel')?.scrollIntoView({ behavior: 'smooth' });
    };
  }

  private toast(text: string, ok: boolean): void {
    const el = document.createElement('div');
    el.className = `toast ${ok ? '' : 'bad'}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  private render(): void {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      ${this.renderTopbar()}
      ${this.renderTabs()}
      <main>${this.snap ? this.renderBody() : '<p>经济引擎启动中…</p>'}</main>
    `;
    this.bindEvents();
  }

  private renderTopbar(): string {
    return `<header class="topbar">
      <h1>驿路通商 · 动态经济沙盘</h1>
      <div class="ctl">
        <label>速度(日/秒)</label>
        <input id="speed-input" type="number" min="1" max="30" value="${this.speed}" />
      </div>
      <div class="ctl">
        <button id="btn-pause">${this.paused ? '▶ 继续' : '⏸ 暂停'}</button>
        <button id="btn-step">单步</button>
      </div>
      <div class="ctl">
        <label>商队数</label>
        <input id="caravan-input" type="number" min="50" max="2000" step="50" value="${this.caravanCount}" />
        <label>种子</label>
        <input id="seed-input" type="number" value="${this.seed}" style="width:110px" />
        <button id="btn-reset" class="primary">重新生成世界</button>
      </div>
      ${this.snap ? `<div class="ctl" style="margin-left:auto"><b style="font-size:16px">第 ${this.snap.day} 日</b><span class="muted" style="color:#cbbfa6">结算 ${this.snap.settleMs.toFixed(2)}ms</span></div>` : ''}
    </header>`;
  }

  private renderTabs(): string {
    const tabs: Array<[Tab, string]> = [
      ['monitor', '经济监控'],
      ['map', '驿路地图'],
      ['towns', '驿站'],
      ['caravans', '商队'],
    ];
    return `<nav class="tabs">${tabs
      .map(([id, label]) => `<button class="${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`)
      .join('')}</nav>`;
  }

  private renderBody(): string {
    switch (this.tab) {
      case 'monitor':
        return `${renderMonitor(this.snap!, this.selectedAlert)}${this.renderExploit()}`;
      case 'map':
        return this.renderMapTab();
      case 'towns':
        return `<div style="display:grid;grid-template-columns:1fr 380px;gap:14px;align-items:start" class="town-layout">
          <div>${renderTowns(this.snap!, this.selectedTown)}</div>
          <div>${renderTradePanel(this.snap!)}</div>
        </div>`;
      case 'caravans':
        return renderCaravans(this.snap!);
    }
  }

  private renderMapTab(): string {
    const map = new MapView({
      showCaravans: this.showCaravans,
      alertRoute: this.selectedAlert,
      onSelectTown: (id) => window.__selectTown(id),
      selectedTown: this.selectedTown,
    });
    const alertInfo = this.selectedAlert
      ? `<div class="card" style="margin-top:12px">
          <div class="flex-between">
            <h2>报警路线还原 · 第 ${this.selectedAlert.day} 日 ${this.selectedAlert.label}</h2>
            <button id="btn-clear-alert">清除路线</button>
          </div>
          <p class="muted">单日利润 ${formatMoney(this.selectedAlert.profit)},全服均值 ${formatMoney(this.selectedAlert.average)},超出 ${this.selectedAlert.multiple.toFixed(1)} 倍。红色虚线为当日买卖路段。</p>
        </div>`
      : '';
    return `
      <div class="card">
        <div class="flex-between">
          <h2>驿路地图(30 城镇程序生成 · 种子 ${this.seed})</h2>
          <label class="muted"><input type="checkbox" id="toggle-caravans" ${this.showCaravans ? 'checked' : ''}/> 显示 ${this.snap!.caravanCount} 支商队</label>
        </div>
        ${map.render(this.snap!)}
        ${this.snap!.alerts.length ? `<p class="muted" style="margin-top:8px">有 ${this.snap!.alerts.length} 条未处理报警,到「经济监控」页点击报警卡片即可在此画出买卖路线。</p>` : ''}
      </div>
      ${alertInfo}`;
  }

  private renderExploit(): string {
    const r = this.exploitReport;
    const log = r
      ? r.rounds
          .map(
            (x) =>
              `第${String(x.round).padStart(2)}轮 买价${Math.round(x.buyPrice)} 卖价${Math.round(x.sellPrice)} 价差${x.spreadPct.toFixed(1)}% 数量${x.qty.toFixed(0)} 净利${Math.round(x.profit)}文`,
          )
          .join('\n')
      : '';
    return `<div class="card" style="margin-top:14px">
      <h2>刷钱复现器:两镇连续倒卖,观察市场自愈</h2>
      <p class="muted">用一笔独立游资在全图价差最大的相邻城镇间连续小批量倒卖(含真实关税与运费),不影响商队状态。指数库存曲线会让买价上涨、卖价下跌,数轮内套利窗口关闭。</p>
      <p>
        <button id="btn-exploit" class="primary">开始复现(草料 ×12 轮)</button>
      </p>
      ${r ? `<div class="exploit-log">路线: ${this.snap!.towns[r.fromTown].name} → ${this.snap!.towns[r.toTown].name}
开仓前价差 ${r.initialSpreadPct.toFixed(1)}%,共完成 ${r.rounds.length} 轮,累计净利 ${formatMoney(r.totalProfit)}
${log}</div>` : ''}
    </div>`;
  }

  private bindEvents(): void {
    document.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) =>
      el.addEventListener('click', () => {
        this.tab = el.dataset.tab as Tab;
        this.render();
      }),
    );

    document.getElementById('speed-input')?.addEventListener('change', (e) => {
      this.speed = Number((e.target as HTMLInputElement).value) || 4;
      this.client.send({ type: 'setSpeed', speed: this.speed });
    });
    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.paused = !this.paused;
      this.client.send({ type: this.paused ? 'pause' : 'resume' });
      this.render();
    });
    document.getElementById('btn-step')?.addEventListener('click', () => {
      this.paused = true;
      this.client.send({ type: 'stepOnce' });
    });
    document.getElementById('btn-reset')?.addEventListener('click', () => {
      this.caravanCount = Number((document.getElementById('caravan-input') as HTMLInputElement).value) || DEFAULT_CARAVAN_COUNT;
      this.seed = Number((document.getElementById('seed-input') as HTMLInputElement).value) || 1;
      this.selectedAlert = null;
      this.selectedTown = null;
      this.exploitReport = null;
      this.client.send({ type: 'reset', seed: this.seed, caravanCount: this.caravanCount });
    });
    document.getElementById('toggle-caravans')?.addEventListener('change', (e) => {
      this.showCaravans = (e.target as HTMLInputElement).checked;
      this.render();
    });
    document.getElementById('btn-clear-alert')?.addEventListener('click', () => {
      this.selectedAlert = null;
      this.render();
    });
    document.getElementById('btn-exploit')?.addEventListener('click', () => {
      this.client.send({ type: 'exploitDemo', ci: 0, rounds: 12 });
    });

    // 报警卡片点击 → 地图画路线
    document.querySelectorAll<HTMLElement>('[data-alert-idx]').forEach((el) =>
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.alertIdx);
        this.selectedAlert = this.snap!.alerts[idx];
        this.tab = 'map';
        this.render();
      }),
    );

    // 交易按钮(事件委托)
    document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const ci = Number(btn.dataset.ci);
        const qty = Number((document.getElementById(`qty-${ci}`) as HTMLInputElement).value) || 0;
        if (qty <= 0) return this.toast('请输入有效数量', false);
        this.client.send({ type: btn.dataset.action === 'buy' ? 'playerBuy' : 'playerSell', ci, qty });
      }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-dispatch]').forEach((btn) =>
      btn.addEventListener('click', () =>
        this.client.send({ type: 'playerDispatch', townId: Number(btn.dataset.dispatch) }),
      ),
    );
  }
}

declare global {
  interface Window {
    __selectTown: (id: number | null) => void;
    __focusTownOnMap: (id: number) => void;
    __scrollTrade: () => void;
  }
}

new App();
