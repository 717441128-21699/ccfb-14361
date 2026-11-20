import { COMMODITIES, formatMoney, formatQty } from '../core/constants';
import type { CaravanSnapshot, Snapshot } from '../core/protocol';

export function renderCaravans(snap: Snapshot): string {
  const byOwner = new Map<string, { count: number; cash: number; profit: number; deals: number; cargo: number[] }>();
  for (const c of snap.caravans) {
    const agg = byOwner.get(c.owner) ?? { count: 0, cash: 0, profit: 0, deals: 0, cargo: COMMODITIES.map(() => 0) };
    agg.count++;
    agg.cash += c.cash;
    agg.profit += c.todayProfit;
    agg.deals += c.todayDeals;
    c.cargo.forEach((q, ci) => (agg.cargo[ci] += q));
    byOwner.set(c.owner, agg);
  }
  const ownerRows = [...byOwner.entries()]
    .sort((a, b) => b[1].profit - a[1].profit)
    .map(([owner, agg]) => {
      const label = owner === 'player' ? '玩家商号' : owner;
      return `<tr ${owner === 'player' ? 'style="background:#fbeee9"' : ''}>
        <td>${owner === 'player' ? '🚩 ' : ''}${label}</td>
        <td>${agg.count}</td>
        <td>${formatMoney(agg.cash)}</td>
        <td class="${agg.profit >= 0 ? 'good' : 'bad'}">${formatMoney(agg.profit)}</td>
        <td>${agg.deals}</td>
        ${agg.cargo.map((q) => `<td>${formatQty(q)}</td>`).join('')}
      </tr>`;
    })
    .join('');

  // 今日净利前 50 的商队明细
  const top = [...snap.caravans].sort((a, b) => b.todayProfit - a.todayProfit).slice(0, 50);
  const detailRows = top.map((c: CaravanSnapshot) => {
    const location =
      c.roadIndex >= 0
        ? `途中 → ${snap.towns[c.toTown].name}(${(c.progress * 100).toFixed(0)}%)`
        : snap.towns[c.fromTown].name;
    return `<tr ${c.isPlayer ? 'style="background:#fbeee9"' : ''}>
      <td>${c.isPlayer ? '🚩 ' : ''}${c.name}</td>
      <td>${location}</td>
      <td>${formatMoney(c.cash)}</td>
      <td class="${c.todayProfit >= 0 ? 'good' : 'bad'}">${formatMoney(c.todayProfit)}</td>
      <td>${formatMoney(c.lifetimeProfit)}</td>
      <td>${c.todayDeals}</td>
      <td>${c.cargo.some((q) => q > 0) ? c.cargo.map((q, ci) => (q > 0 ? `${COMMODITIES[ci].name}${formatQty(q)}` : '')).filter(Boolean).join('、') : '空车'}</td>
    </tr>`;
  }).join('');

  const moving = snap.caravans.filter((c) => c.roadIndex >= 0).length;

  return `
  <div class="grid cols-4" style="margin-bottom:14px">
    <div class="card metric"><span class="k">商队总数</span><span class="v">${snap.caravanCount}</span></div>
    <div class="card metric"><span class="k">在途商队</span><span class="v">${moving}</span><span class="sub">占比 ${((moving / snap.caravanCount) * 100).toFixed(0)}%</span></div>
    <div class="card metric"><span class="k">商号数量</span><span class="v">${byOwner.size}</span><span class="sub">玩家 1 + NPC ${byOwner.size - 1}</span></div>
    <div class="card metric"><span class="k">玩家今日净利</span><span class="v ${snap.caravans[0].todayProfit >= 0 ? 'good' : 'bad'}">${formatMoney(snap.caravans[0].todayProfit)}</span></div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h2>商号汇总(报警统计口径)</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>商号</th><th>商队</th><th>现银</th><th>今日贸易净利</th><th>成交笔数</th>${COMMODITIES.map((c) => `<th>在途${c.name}</th>`).join('')}</tr></thead>
      <tbody>${ownerRows}</tbody>
    </table></div>
  </div>

  <div class="card">
    <h2>今日净利榜 TOP 50 / 共 ${snap.caravanCount} 支</h2>
    <div class="table-wrap" style="max-height:460px"><table>
      <thead><tr><th>商队</th><th>位置</th><th>现银</th><th>今日净利</th><th>累计净利</th><th>成交</th><th>载货</th></tr></thead>
      <tbody>${detailRows}</tbody>
    </table></div>
  </div>`;
}
