import { Rng } from './rng';
import {
  BOT_MERCHANT_COUNT,
  CARAVAN_CAP_MAX,
  CARAVAN_CAP_MIN,
  COMMODITY_IDS,
  DEFAULT_CARAVAN_COUNT,
  PLAYER_INITIAL_CASH,
  TOWN_COUNT,
} from './constants';
import type {
  CaravanDef,
  CaravanRuntime,
  Road,
  TownDef,
  TownProfile,
  TownRuntime,
} from './types';

const TOWN_PREFIX = ['青', '白', '云', '龙', '凤', '雁', '凉', '甘', '肃', '安', '定', '怀', '通', '临', '沙', '金', '玉', '铁', '桥', '驿'];
const TOWN_SUFFIX = ['州', '关', '城', '镇', '驿', '渡', '堡', '口'];
const PROFILES: TownProfile[] = ['farm', 'ranch', 'craft', 'market'];
export const PROFILE_LABEL: Record<TownProfile, string> = {
  farm: '粮产区',
  ranch: '牧场',
  craft: '织工坊',
  market: '商埠',
};

const BOT_HOUSES = ['万通号', '恒顺昌', '裕德隆', '广聚源', '同兴公', '义盛和', '瑞蚨祥', '日升昌'];
const CARAVAN_COLORS = ['#d97757', '#7aa6c2', '#8fbc8f', '#c9a227', '#a78bca', '#5fb3b3'];

/** 城镇产出/消耗画像:净流量相对目标库存的日比例 */
const PROFILE_FLOW: Record<TownProfile, number[]> = {
  // 顺序对齐 COMMODITY_IDS: forage, grain, horses, goods
  farm:   [-0.05,  0.22, -0.03, -0.10],
  ranch:  [ 0.18, -0.06,  0.10, -0.10],
  craft:  [-0.08, -0.10, -0.04,  0.20],
  market: [-0.02, -0.02, -0.02,  0.04],
};

const TARGET_BASE = [900, 700, 60, 260]; // 各商品目标库存基准(tier 2 城镇)

export interface GeneratedWorld {
  towns: TownDef[];
  runtimes: TownRuntime[];
  roads: Road[];
  /** 邻接表:townId -> 相邻城镇 id(按距离) */
  neighbors: number[][];
  caravans: CaravanRuntime[];
  caravanDefs: CaravanDef[];
  seed: number;
}

function dist2d(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** 蓝噪声式撒点:最小间距拒绝采样,保证城镇在地图上铺开 */
function scatterTowns(rng: Rng, count: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const minDist = 150;
  let attempts = 0;
  while (points.length < count && attempts < 6000) {
    attempts++;
    const x = rng.range(60, 940);
    const y = rng.range(60, 640);
    if (points.every((p) => dist2d(p.x, p.y, x, y) >= minDist)) {
      points.push({ x, y });
    }
  }
  // 兜底:若拒绝采样耗尽(极小概率),放宽间距补齐
  while (points.length < count) {
    points.push({ x: rng.range(60, 940), y: rng.range(60, 640) });
  }
  return points;
}

/** 道路网:每镇连最近的 2~3 个城镇,再随机补几条长途干道,保证全连通 */
function buildRoads(rng: Rng, towns: TownDef[]): Road[] {
  const roads: Road[] = [];
  const seen = new Set<string>();
  const addRoad = (a: number, b: number): void => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    const ta = towns[a];
    const tb = towns[b];
    roads.push({ a, b, distance: Math.round(dist2d(ta.x, ta.y, tb.x, tb.y) * 1.1) });
  };

  towns.forEach((t, i) => {
    const nearest = towns
      .filter((o) => o.id !== i)
      .map((o) => ({ id: o.id, d: dist2d(t.x, t.y, o.x, o.y) }))
      .sort((a, b) => a.d - b.d);
    const linkCount = 2 + (rng.next() < 0.45 ? 1 : 0);
    for (let k = 0; k < linkCount; k++) addRoad(i, nearest[k].id);
  });

  // 长途干道:随机挑跨度大的点对,打通区域
  for (let n = 0; n < 6; n++) {
    const a = rng.int(0, towns.length);
    const far = towns
      .map((o, id) => ({ id, d: dist2d(towns[a].x, towns[a].y, o.x, o.y) }))
      .filter((o) => o.id !== a)
      .sort((x, y) => y.d - x.d);
    addRoad(a, far[rng.int(0, 3)].id);
  }
  return roads;
};

function buildNeighbors(townCount: number, roads: Road[]): number[][] {
  const neighbors: number[][] = Array.from({ length: townCount }, () => []);
  for (const r of roads) {
    neighbors[r.a].push(r.b);
    neighbors[r.b].push(r.a);
  }
  for (const list of neighbors) list.sort((a, b) => a - b);
  return neighbors;
}

export function generateWorld(seed: number, caravanCount = DEFAULT_CARAVAN_COUNT): GeneratedWorld {
  const rng = new Rng(seed);
  const points = scatterTowns(rng, TOWN_COUNT);

  const towns: TownDef[] = points.map((p, i) => {
    const roll = rng.next();
    const tier: TownDef['tier'] = roll < 0.2 ? 3 : roll < 0.55 ? 2 : 1;
    const profile = rng.weighted(PROFILES, [0.34, 0.26, 0.26, 0.14]);
    return {
      id: i,
      name: rng.pick(TOWN_PREFIX) + rng.pick(TOWN_PREFIX) + rng.pick(TOWN_SUFFIX),
      tier,
      profile,
      x: Math.round(p.x),
      y: Math.round(p.y),
      horses: tier * 12 + rng.int(0, 10),
    };
  });

  const runtimes: TownRuntime[] = towns.map((t) => {
    const tierScale = t.tier === 3 ? 1.8 : t.tier === 2 ? 1.1 : 0.7;
    const target = COMMODITY_IDS.map((_, ci) => Math.round(TARGET_BASE[ci] * tierScale * rng.range(0.85, 1.15)));
    const netFlow = PROFILE_FLOW[t.profile].map((ratio, ci) => Math.round(target[ci] * ratio));
    return {
      id: t.id,
      stock: target.map((v) => Math.round(v * rng.range(0.7, 1.25))),
      target,
      netFlow,
      money: 8_000_000 * tierScale,
      lastVolume: COMMODITY_IDS.map(() => 0),
      shortageDays: COMMODITY_IDS.map(() => 0),
    };
  });

  const roads = buildRoads(rng, towns);
  const neighbors = buildNeighbors(towns.length, roads);

  // —— 商队:1 个玩家商号 + 8 个 NPC 大商号,共 caravanCount 支 ——
  const caravanDefs: CaravanDef[] = [];
  const caravans: CaravanRuntime[] = [];
  const owners = ['player', ...BOT_HOUSES.slice(0, BOT_MERCHANT_COUNT)];
  for (let i = 0; i < caravanCount; i++) {
    const owner = i === 0 ? 'player' : owners[1 + ((i - 1) % BOT_MERCHANT_COUNT)];
    const def: CaravanDef = {
      id: i,
      name: `${owner === 'player' ? '玩家' : owner}商队 ${String(i + 1).padStart(4, '0')}`,
      owner,
      capacity: rng.int(CARAVAN_CAP_MIN, CARAVAN_CAP_MAX + 1),
      color: owner === 'player' ? '#ff5d5d' : CARAVAN_COLORS[i % CARAVAN_COLORS.length],
    };
    caravanDefs.push(def);
    const home = rng.int(0, towns.length);
    caravans.push({
      id: i,
      def,
      roadIndex: -1,
      fromTown: home,
      toTown: home,
      progress: 0,
      cargo: COMMODITY_IDS.map(() => 0),
      costBasis: COMMODITY_IDS.map(() => 0),
      loadedTown: COMMODITY_IDS.map(() => -1),
      cash: owner === 'player' ? PLAYER_INITIAL_CASH : rng.range(300_000, 900_000),
      lifetimeProfit: 0,
      todayProfit: 0,
      todayDeals: 0,
      todayDistance: 0,
    });
  }

  return { towns, runtimes, roads, neighbors, caravans, caravanDefs, seed };
}
