import { COMMODITIES, formatMoney, formatQty } from '../core/constants';
import type { Snapshot } from '../core/protocol';
import { PROFILE_LABEL } from '../core/worldgen';

const PROFILE_FLOW_LABEL: Record<string, string> = {
  farm: '粮产区:稳定产出粮米,消耗杂货与草料',
  ranch: '牧场:产出草料与马匹,外购粮米和绸缎',
  craft: '织工坊:产出绸缎杂货,粮草外购',
  market: '商埠:中转吞吐,各类商品小幅净流入',
};

export function renderTowns(snap: Snapshot, selectedId: number | null): string {
  if (selectedId === null) {
    const rows = snap.towns
      .map(
        (t) => `<tr onclick="window.__selectTown(${t.id})" style="cursor:pointer">
        <td><span class="tier-dot tier-${t.tier}"></span>${t.name}</td>
        <td>${PROFILE_LABEL[t.profile as keyof typeof PROFILE_LABEL] ?? t.profile}</td>
        <td>${t.tier} 等</td>
        <td>${t.horses}</td>
        <td>${formatMoney(t.money)}</td>
        <td>${t.netFlow.filter((f) => f > 0).length} 产 / ${t.netFlow.filter((f) => f < 0).length} 耗</td>
        <td>${t.shortage.reduce((a, b) => a + b, 0)} 商品日</td>
      </tr>`,
      )
      .join('');
    return `<div class="card">
      <h2>三十处驿站(点击查看详情与交易)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>驿站</th><th>类型</th><th>等级</th><th>养马</th><th>银库</th><th>日产出/消耗</th><th>累计缺货</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>`;
  }

  const t = snap.towns[selectedId];
  const neighborIds = snap.neighbors[selectedId];
  const neighbors = neighborIds.map((id) => {
    const n = snap.towns[id];
    const road = snap.roads.find(
      (r) => (r.a === selectedId && r.b === id) || (r.b === selectedId && r.a === id),
    );
    return { n, distance: road?.distance ?? 0 };
  });

  const rows = COMMODITIES.map((c, ci) => {
    const flow = t.netFlow[ci];
    const flowText =
      flow > 0 ? `<span class="pill up">日产 +${formatQty(flow)}</span>` : `<span class="pill down">日耗 ${formatQty(flow)}</span>`;
    return `<tr>
      <td>${c.name}</td>
      <td>${Math.round(t.prices[ci]).toLocaleString()} 文</td>
      <td>${formatQty(t.stock[ci])} / ${formatQty(t.target[ci])}</td>
      <td>${flowText}</td>
      <td>${formatQty(t.volume[ci])}</td>
      <td>${t.shortage[ci] > 0 ? `<span class="pill down">缺货 ${t.shortage[ci]} 日</span>` : '供应正常'}</td>
    </tr>`;
  }).join('');

  const neighborRows = neighbors
    .map(
      ({ n, distance }) => `<tr>
        <td>${n.name}</td><td>${distance} 里</td>
        ${COMMODITIES.map((_, ci) => {
          const here = t.prices[ci];
          const there = n.prices[ci];
          const diff = ((there - here) / here) * 100;
          const cls = Math.abs(diff) < 3 ? '' : diff > 0 ? 'up' : 'down';
          return `<td><span class="pill ${cls}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%</span></td>`;
        }).join('')}
      </tr>`,
    )
    .join('');

  return `
  <div class="grid cols-2">
    <div class="card">
      <div class="flex-between">
        <h2>${t.name} <span class="muted">${t.tier} 等驿站 · ${PROFILE_LABEL[t.profile as keyof typeof PROFILE_LABEL]}</span></h2>
        <button onclick="window.__selectTown(null)">返回列表</button>
      </div>
      <p class="muted">${PROFILE_FLOW_LABEL[t.profile] ?? ''} · 养马 ${t.horses} 匹,每日吃草料 ${(t.horses * 0.25).toFixed(1)} 石</p>
      <h3>商品供需</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>商品</th><th>现价</th><th>库存/目标</th><th>每日净流量</th><th>昨日成交</th><th>缺货</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <h3>银库</h3>
      <p>${formatMoney(t.money)} · 低于 50 万文时由官银兜底(白银投放)</p>
    </div>

    <div class="card">
      <h2>相邻驿路与价差(本地买入视角)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>相邻城镇</th><th>里程</th>${COMMODITIES.map((c) => `<th>${c.name}价差</th>`).join('')}</tr></thead>
        <tbody>${neighborRows}</tbody>
      </table></div>
      <p class="muted" style="margin-top:8px">价差为正=邻镇更贵,理论上可低买高卖;但关税 2%、运费与大单滑点会吃掉薄利,NPC 商队也在同步搬价。</p>
      <h3>快捷操作</h3>
      <p>
        <button onclick="window.__focusTownOnMap(${t.id})">在地图上定位</button>
        ${snap.player.townId === t.id && !snap.player.onRoad ? `<button class="primary" onclick="window.__scrollTrade()">在此交易</button>` : ''}
      </p>
    </div>
  </div>`;
}

export function townName(snap: Snapshot, id: number): string {
  return snap.towns[id]?.name ?? `城镇#${id}`;
}
