import { COMMODITIES } from '../core/constants';
import type { Alert, Snapshot, TownSnapshot } from '../core/protocol';
import { PROFILE_LABEL } from '../core/worldgen';

const W = 1000;
const H = 700;

export interface MapViewOptions {
  showCaravans: boolean;
  alertRoute: Alert | null;
  onSelectTown: (id: number) => void;
  selectedTown: number | null;
}

export class MapView {
  constructor(private readonly opts: MapViewOptions) {}

  render(snap: Snapshot): string {
    const { towns, caravans } = snap;
    const roads = this.roadsFromSnapshot(snap);
    const alertPairs = this.alertPairs();

    const roadSvg = roads
      .map((r) => {
        const a = towns[r.a];
        const b = towns[r.b];
        const highlighted = this.roadInAlert(r.a, r.b);
        return `<line class="road-line" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${
          highlighted ? 'stroke="#d23b3b" stroke-width="3" stroke-dasharray="7 6"' : ''
        } />`;
      })
      .join('');

    const alertSvg = this.opts.alertRoute
      ? this.opts.alertRoute.route
          .map((leg) => {
            if (leg.from < 0) return '';
            const a = towns[leg.from];
            const b = towns[leg.to];
            const midX = (a.x + b.x) / 2 + 14;
            const midY = (a.y + b.y) / 2 - 10;
            return `<line class="alert-route" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>
              <text x="${midX}" y="${midY}" font-size="11" fill="#b03a2e">${COMMODITIES.find((c) => c.id === leg.commodity)?.name ?? ''} ${leg.qty.toFixed(0)}</text>`;
          })
          .join('')
      : '';

    const caravanSvg = this.opts.showCaravans
      ? caravans
          .filter((c) => !c.isPlayer)
          .map(
            (c) =>
              `<circle class="caravan-dot" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.2" fill="${c.color}" opacity="0.75"/>`,
          )
          .join('')
      : '';

    const player = caravans.find((c) => c.isPlayer)!;
    const playerSvg = `
      <circle class="player-marker" cx="${player.x}" cy="${player.y}" r="7" stroke="#fff" stroke-width="2"/>
      <text x="${player.x + 10}" y="${player.y + 4}" font-size="12" fill="#b03a2e" font-weight="700">玩家商队</text>`;

    const townSvg = towns
      .map((t) => this.townNode(t))
      .join('');

    return `
      <div class="map-wrap">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="驿路地图">
          ${roadSvg}
          ${alertSvg}
          ${caravanSvg}
          ${townSvg}
          ${playerSvg}
        </svg>
      </div>
      <div class="legend">
        <span><i style="background:var(--accent)"></i>上等城镇</span>
        <span><i style="background:#6b8e6b"></i>中等城镇</span>
        <span><i style="background:#9c8a6d"></i>下等城镇</span>
        <span><i style="background:var(--player)"></i>玩家商队</span>
        <span><i style="background:#7aa6c2"></i>NPC 商队(可开关)</span>
        ${alertPairs.size > 0 ? '<span><i style="background:var(--bad)"></i>报警买卖路线</span>' : ''}
      </div>`;
  }

  private townNode(t: TownSnapshot): string {
    const r = 6 + t.tier * 2.5;
    const fill = t.tier === 3 ? 'var(--accent)' : t.tier === 2 ? '#6b8e6b' : '#9c8a6d';
    const selected = this.opts.selectedTown === t.id;
    // 按 id 交替错位,缓解相邻城镇的标签重叠
    const labelDy = t.id % 2 === 0 ? -(r + 5) : r + 16;
    const profileDy = t.id % 2 === 0 ? -(r + 18) : r + 28;
    return `
      <g onclick="window.__selectTown(${t.id})" style="cursor:pointer">
        ${selected ? `<circle cx="${t.x}" cy="${t.y}" r="${r + 5}" fill="none" stroke="#b03a2e" stroke-width="2"/>` : ''}
        <circle class="town-circle" cx="${t.x}" cy="${t.y}" r="${r}" fill="${fill}"/>
        <text class="town-label" x="${t.x}" y="${t.y + labelDy}" text-anchor="middle" style="font-weight:600;paint-order:stroke;stroke:#ece3d0;stroke-width:3px">${t.name}</text>
        <text class="town-label" x="${t.x}" y="${t.y + profileDy}" text-anchor="middle" style="font-size:10px;fill:#6f6353;paint-order:stroke;stroke:#ece3d0;stroke-width:3px">${PROFILE_LABEL[t.profile as keyof typeof PROFILE_LABEL] ?? t.profile}</text>
      </g>`;
  }

  private roadsFromSnapshot(snap: Snapshot): Array<{ a: number; b: number }> {
    return snap.roads;
  }

  private alertPairs(): Set<string> {
    const s = new Set<string>();
    this.opts.alertRoute?.route.forEach((leg) => {
      if (leg.from < 0) return;
      s.add(leg.from < leg.to ? `${leg.from}-${leg.to}` : `${leg.to}-${leg.from}`);
    });
    return s;
  }

  private roadInAlert(a: number, b: number): boolean {
    return this.alertPairs().has(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
}
