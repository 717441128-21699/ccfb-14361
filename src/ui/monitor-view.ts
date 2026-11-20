import { COMMODITIES, formatMoney } from '../core/constants';
import type { Alert, Snapshot, TownSnapshot } from '../core/protocol';

function pricePill(price: number, base: number): string {
  const diff = (price - base) / base;
  if (Math.abs(diff) < 0.03) return `<span class="pill">平价</span>`;
  return diff > 0
    ? `<span class="pill up">▲ ${(diff * 100).toFixed(1)}%</span>`
    : `<span class="pill down">▼ ${(diff * 100).toFixed(1)}%</span>`;
}

function stockBar(t: TownSnapshot, ci: number): string {
  const ratio = t.stock[ci] / t.target[ci];
  const cls = ratio < 0.4 ? 'low' : ratio > 1.3 ? 'high' : '';
  return `<div class="bar ${cls}" style="width:90px"><i style="width:${Math.min(100, ratio * 60).toFixed(0)}%"></i></div>`;
}

export function renderMonitor(snap: Snapshot, selectedAlert: Alert | null): string {
  const { ledger, supplyHistory, alerts } = snap;

  const supplyCurve = renderSupplyCurve(supplyHistory);

  const townRows = snap.towns
    .map((t) => {
      const priceCells = COMMODITIES.map(
        (c, ci) =>
          `<td>${Math.round(t.prices[ci]).toLocaleString()} ${pricePill(t.prices[ci], c.basePrice)}</td>`,
      ).join('');
      const stockCells = COMMODITIES.map((_, ci) => {
        const shortage = t.shortage[ci] > 0 ? ` <span class="pill down">缺${t.shortage[ci]}日</span>` : '';
        return `<td><div class="flex-between">${stockBar(t, ci)}<span class="muted">${t.stock[ci].toFixed(0)}/${t.target[ci]}</span></div>${shortage}</td>`;
      }).join('');
      return `<tr>
        <td><span class="tier-dot tier-${t.tier}"></span>${t.name}</td>
        <td>${formatMoney(t.money)}</td>
        ${priceCells}
        ${stockCells}
      </tr>`;
    })
    .join('');

  const alertCards = alerts.length
    ? alerts
        .map((a, idx) => {
          const active = selectedAlert === a;
          return `<div class="alert-item ${active ? 'selected' : ''}" data-alert-idx="${idx}" style="${active ? 'outline:2px solid var(--bad)' : ''}">
            <div class="head">
              <span>🚨 第 ${a.day} 日 · ${a.label}</span>
              <span>${formatMoney(a.profit)}</span>
            </div>
            <div class="meta">
              全服均值 ${formatMoney(a.average)} · 超出 <b>${a.multiple.toFixed(1)} 倍</b>(红线 10 倍)·
              路线 ${a.route.length} 段 · 点击在地图上还原
            </div>
          </div>`;
        })
        .join('')
    : `<p class="muted">暂无报警。单日贸易利润超过全服均值 10 倍且高于 30 万文的商号会出现在这里。</p>`;

  return `
    <div class="grid cols-4" style="margin-bottom:14px">
      <div class="card metric"><span class="k">流通白银总量</span><span class="v">${formatMoney(ledger.totalSupply)}</span>
        <span class="sub">城镇银库 ${formatMoney(ledger.townReserve)} · 商号现银 ${formatMoney(ledger.merchantCash)}</span></div>
      <div class="card metric"><span class="k">当日投放(公文/官银)</span><span class="v good">${formatMoney(ledger.injected)}</span></div>
      <div class="card metric"><span class="k">当日回收(税/运费/养护)</span><span class="v bad">${formatMoney(ledger.sunk)}</span></div>
      <div class="card metric"><span class="k">单日结算耗时</span><span class="v ${snap.settleMs > 50 ? 'bad' : 'good'}">${snap.settleMs.toFixed(2)} ms</span>
        <span class="sub">红线 50ms · ${snap.caravanCount} 商队 / 30 城镇 · Worker 线程</span></div>
    </div>

    <div class="grid cols-2" style="margin-bottom:14px">
      <div class="card">
        <h2>流通白银与投放/回收(近 ${supplyHistory.length} 日)</h2>
        ${supplyCurve}
      </div>
      <div class="card">
        <h2>异常利润报警(> 全服均值 × 10)</h2>
        <div class="scroll-y">${alertCards}</div>
      </div>
    </div>

    <div class="card">
      <h2>城镇价格与库存监控(30 城镇 × 4 商品)</h2>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>城镇</th><th>银库</th>
            ${COMMODITIES.map((c) => `<th>${c.name}价(文)</th>`).join('')}
            ${COMMODITIES.map((c) => `<th>${c.name}库存/目标</th>`).join('')}
          </tr></thead>
          <tbody>${townRows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderSupplyCurve(history: Snapshot['supplyHistory']): string {
  if (history.length < 2) return `<p class="muted">数据累积中,至少需要 2 个游戏日。</p>`;
  const w = 520;
  const h = 220;
  const pad = 44;
  const supplies = history.map((p) => p.supply);
  const min = Math.min(...supplies) * 0.999;
  const max = Math.max(...supplies) * 1.001;
  const x = (i: number): number => pad + (i / (history.length - 1)) * (w - pad * 2);
  const y = (v: number): number => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const path = history.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.supply).toFixed(1)}`).join(' ');
  const maxInj = Math.max(1, ...history.map((p) => Math.max(p.injected, p.sunk)));
  const bars = history
    .map((p, i) => {
      const bh1 = ((p.injected / maxInj) * 40).toFixed(1);
      const bh2 = ((p.sunk / maxInj) * 40).toFixed(1);
      return `<rect x="${(x(i) - 2).toFixed(1)}" y="${(h - pad - Number(bh1)).toFixed(1)}" width="2" height="${bh1}" fill="#3f7d4e" opacity="0.7"/>
        <rect x="${(x(i) + 1).toFixed(1)}" y="${(h - pad - Number(bh2)).toFixed(1)}" width="2" height="${bh2}" fill="#b03a2e" opacity="0.7"/>`;
    })
    .join('');
  const last = supplies[supplies.length - 1];
  const first = supplies[0];
  const deltaPct = (((last - first) / first) * 100).toFixed(2);
  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto">
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#d8ccb5"/>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="#d8ccb5"/>
      ${bars}
      <path d="${path}" stroke="#9c4a2f" stroke-width="2.2" fill="none"/>
      <text x="${pad}" y="16" font-size="11" fill="#6f6353">总量 ${formatMoney(max)}</text>
      <text x="${pad}" y="${h - 8}" font-size="11" fill="#6f6353">第 ${history[0].day} 日 → 第 ${history[history.length - 1].day} 日 · 累计变化 ${deltaPct}%</text>
    </svg>
    <div class="legend"><span><i style="background:#3f7d4e"></i>日投放</span><span><i style="background:#b03a2e"></i>日回收</span><span><i style="background:#9c4a2f"></i>流通总量</span></div>`;
}
