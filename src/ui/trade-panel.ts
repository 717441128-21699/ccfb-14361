import { COMMODITIES, formatMoney, formatQty } from '../core/constants';
import type { Snapshot } from '../core/protocol';

export function renderTradePanel(snap: Snapshot): string {
  const p = snap.player;
  const town = snap.towns[p.townId];
  const usedCap = p.cargo.reduce((a, b) => a + b, 0);

  if (p.onRoad) {
    const dest = snap.towns[p.toTown];
    return `<div class="card">
      <h2>玩家商队 · 运输中</h2>
      <p>正在前往 <b>${dest.name}</b>,行程 ${(p.progress * 100).toFixed(0)}%。到达后即可交易。</p>
      <div class="bar"><i style="width:${(p.progress * 100).toFixed(0)}%"></i></div>
    </div>`;
  }

  const rows = COMMODITIES.map((c, ci) => {
    const price = town.prices[ci];
    const basis = p.costBasis[ci];
    const holding = p.cargo[ci];
    const pl = holding > 0 ? ((price - basis) / basis) * 100 : 0;
    return `<div class="trade-row">
      <span class="name">${c.name}</span>
      <span class="muted">现价 ${Math.round(price).toLocaleString()} 文</span>
      <span class="muted">持仓 ${formatQty(holding)}${holding > 0 ? ` · 成本 ${Math.round(basis)}` : ''}</span>
      ${holding > 0 ? `<span class="pill ${pl >= 0 ? 'up' : 'down'}">浮动 ${pl >= 0 ? '+' : ''}${pl.toFixed(1)}%</span>` : ''}
      <span style="flex:1"></span>
      <input class="qty" id="qty-${ci}" type="number" min="1" value="20" />
      <button data-action="buy" data-ci="${ci}">买入(含税2%)</button>
      <button data-action="sell" data-ci="${ci}" ${holding <= 0 ? 'disabled' : ''}>卖出</button>
    </div>`;
  }).join('');

  const neighborButtons = snap.neighbors[p.townId]
    .map((id) => {
      const n = snap.towns[id];
      const road = snap.roads.find(
        (r) => (r.a === p.townId && r.b === id) || (r.b === p.townId && r.a === id),
      );
      return `<button data-dispatch="${id}">→ ${n.name}(${road?.distance ?? '?'}里)</button>`;
    })
    .join('');

  return `<div class="card" id="trade-panel">
    <h2>玩家商队 · 驻扎 ${town.name}</h2>
    <p class="muted">现银 <b style="color:var(--ink)">${formatMoney(p.cash)}</b> · 载货 ${formatQty(usedCap)}/${p.capacity} · 关税 2% 买卖双向收取,运费按重量×里程,卖出时计入损益</p>
    ${rows}
    <h3>派发商队(只能走相邻驿路)</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${neighborButtons}</div>
  </div>`;
}
