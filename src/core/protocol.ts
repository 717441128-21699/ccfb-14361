import { COMMODITY_IDS } from './constants';
import { unitPrice } from './market';
import { EconomyEngine, type ExploitReport } from './engine';
import type { Alert, SilverLedger, TownRuntime } from './types';

export type { Alert } from './types';

// —— Worker 消息协议 ——
export type WorkerRequest =
  | { type: 'init'; seed: number; caravanCount: number }
  | { type: 'setSpeed'; speed: number } // 每日结算次数/秒
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stepOnce' }
  | { type: 'reset'; seed: number; caravanCount: number }
  | { type: 'playerBuy'; ci: number; qty: number }
  | { type: 'playerSell'; ci: number; qty: number }
  | { type: 'playerDispatch'; townId: number }
  | { type: 'exploitDemo'; ci: number; rounds: number };

export interface TownSnapshot {
  id: number;
  name: string;
  tier: number;
  profile: string;
  x: number;
  y: number;
  horses: number;
  money: number;
  prices: number[];
  stock: number[];
  target: number[];
  netFlow: number[];
  volume: number[];
  shortage: number[];
}

export interface CaravanSnapshot {
  id: number;
  name: string;
  owner: string;
  color: string;
  fromTown: number;
  toTown: number;
  roadIndex: number;
  progress: number;
  x: number;
  y: number;
  cargo: number[];
  cash: number;
  todayProfit: number;
  lifetimeProfit: number;
  todayDeals: number;
  isPlayer: boolean;
}

export interface PlayerSnapshot {
  townId: number;
  cash: number;
  cargo: number[];
  costBasis: number[];
  capacity: number;
  onRoad: boolean;
  toTown: number;
  progress: number;
}

export interface Snapshot {
  day: number;
  substep: number;
  roads: Array<{ a: number; b: number; distance: number }>;
  neighbors: number[][];
  towns: TownSnapshot[];
  caravans: CaravanSnapshot[];
  player: PlayerSnapshot;
  ledger: SilverLedger;
  supplyHistory: EconomyEngine['supplyHistory'];
  alerts: Alert[];
  caravanCount: number;
  settleMs: number; // 最近一次完整游戏日(8 段)耗时
}

export type WorkerResponse =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'settled'; day: number; alerts: Alert[]; settleMs: number }
  | { type: 'actionResult'; ok: boolean; reason?: string }
  | { type: 'exploitReport'; report: ExploitReport };

export function buildSnapshot(engine: EconomyEngine, settleMs: number): Snapshot {
  const { towns, runtimes, roads, caravans } = engine.world;

  const townSnaps: TownSnapshot[] = towns.map((def) => {
    const rt: TownRuntime = runtimes[def.id];
    return {
      id: def.id,
      name: def.name,
      tier: def.tier,
      profile: def.profile,
      x: def.x,
      y: def.y,
      horses: def.horses,
      money: rt.money,
      prices: COMMODITY_IDS.map((_, ci) => unitPrice(rt, ci)),
      stock: [...rt.stock],
      target: [...rt.target],
      netFlow: [...rt.netFlow],
      volume: [...rt.lastVolume],
      shortage: [...rt.shortageDays],
    };
  });

  const caravanSnaps: CaravanSnapshot[] = caravans.map((c) => {
    let x: number;
    let y: number;
    if (c.roadIndex >= 0) {
      const road = roads[c.roadIndex];
      const a = towns[road.a];
      const b = towns[road.b];
      x = a.x + (b.x - a.x) * c.progress;
      y = a.y + (b.y - a.y) * c.progress;
    } else {
      x = towns[c.fromTown].x;
      y = towns[c.fromTown].y;
    }
    return {
      id: c.id,
      name: c.def.name,
      owner: c.def.owner,
      color: c.def.color,
      fromTown: c.fromTown,
      toTown: c.toTown,
      roadIndex: c.roadIndex,
      progress: c.progress,
      x,
      y,
      cargo: [...c.cargo],
      cash: c.cash,
      todayProfit: c.todayProfit,
      lifetimeProfit: c.lifetimeProfit,
      todayDeals: c.todayDeals,
      isPlayer: c.def.owner === 'player',
    };
  });

  const player = caravans[0];
  const playerSnap: PlayerSnapshot = {
    townId: player.fromTown,
    cash: player.cash,
    cargo: [...player.cargo],
    costBasis: [...player.costBasis],
    capacity: player.def.capacity,
    onRoad: player.roadIndex >= 0,
    toTown: player.toTown,
    progress: player.progress,
  };

  return {
    day: engine.day,
    substep: engine.substep,
    roads: engine.world.roads.map((r) => ({ ...r })),
    neighbors: engine.world.neighbors.map((n) => [...n]),
    towns: townSnaps,
    caravans: caravanSnaps,
    player: playerSnap,
    ledger: { ...engine.ledger },
    supplyHistory: [...engine.supplyHistory],
    alerts: [...engine.alerts],
    caravanCount: caravans.length,
    settleMs,
  };
}
