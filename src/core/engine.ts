import { Rng } from './rng';
import {
  ALERT_ABSOLUTE_FLOOR,
  ALERT_PROFIT_MULTIPLE,
  COMMODITIES,
  COMMODITY_IDS,
  FORAGE_PER_HORSE_DAILY,
  FREIGHT_PER_WEIGHT_PER_LI,
  MAIL_INCOME_PER_TOWN,
  MAIL_INCOME_JITTER,
  MAX_ALERTS,
  PLAYER_INITIAL_CASH,
  STATION_DAILY_COST_PER_HORSE,
  TOWN_MONEY_FLOOR,
} from './constants';
import {
  executeBuy,
  executeSell,
  freightCost,
  maxQtyForBudget,
  maxSellableQty,
  quoteSell,
  routeUnitMargin,
  stockCap,
  unitPrice,
} from './market';
import type {
  Alert,
  CaravanRuntime,
  MerchantDayStat,
  SilverLedger,
} from './types';
import type { CommodityId } from './constants';
import { generateWorld, type GeneratedWorld } from './worldgen';

export const SUBSTEPS_PER_DAY = 8;
const ROUTE_ENTRY_CAP = 60;
const LOW_CASH_TRIGGER = 120_000;

export interface ExploitRound {
  round: number;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  qty: number;
  profit: number;
}

export interface ExploitReport {
  fromTown: number;
  toTown: number;
  commodity: CommodityId;
  rounds: ExploitRound[];
  initialSpreadPct: number;
  finalSpreadPct: number;
  totalProfit: number;
}

export class EconomyEngine {
  readonly world: GeneratedWorld;
  day = 1;
  substep = 0;
  readonly alerts: Alert[] = [];
  ledger: SilverLedger;
  /** 全服流通白银历史(每日一个点) */
  readonly supplyHistory: Array<{ day: number; supply: number; injected: number; sunk: number }> = [];

  private readonly rng: Rng;
  private readonly roadIndex = new Map<number, number>();
  private readonly dayStats = new Map<string, MerchantDayStat>();
  private taxCollected = 0;
  private freightCollected = 0;
  private injectedToday = 0;
  private sunkToday = 0;

  constructor(seed: number, caravanCount: number) {
    this.world = generateWorld(seed, caravanCount);
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.world.roads.forEach((r, i) => this.roadIndex.set(this.roadKey(r.a, r.b), i));
    this.ledger = this.computeLedger(0, 0);
    this.resetDayStats();
  }

  // ———————————————————— 时间推进 ————————————————————

  /** 推进 1/8 个游戏日;每满 8 段触发一次每日供需结算 */
  step(): { settled: boolean; newAlerts: Alert[] } {
    for (const c of this.world.caravans) this.moveCaravan(c);
    this.substep++;
    if (this.substep >= SUBSTEPS_PER_DAY) {
      const newAlerts = this.settleDay();
      this.substep = 0;
      return { settled: true, newAlerts };
    }
    return { settled: false, newAlerts: [] };
  }

  private moveCaravan(c: CaravanRuntime): void {
    const speed = 150 + ((c.def.id * 53) % 90); // 150~239 里/日,确定性
    if (c.roadIndex >= 0) {
      const road = this.world.roads[c.roadIndex];
      c.progress += speed / SUBSTEPS_PER_DAY / road.distance;
      c.todayDistance += speed / SUBSTEPS_PER_DAY;
      if (c.progress >= 1) {
        c.progress = 0;
        c.roadIndex = -1;
        c.fromTown = c.toTown;
        this.onArriveAtTown(c);
      }
      return;
    }
    // 停驻城镇:NPC 自动经营,玩家商队等待手动指令
    if (c.def.owner !== 'player') this.npcTradeAndDepart(c);
  }

  // ———————————————————— NPC 商队 AI ————————————————————

  private onArriveAtTown(c: CaravanRuntime): void {
    const town = this.world.runtimes[c.toTown];
    // 1. 有利可图就卸货;现金紧张时割肉回笼,避免卡死
    for (let ci = 0; ci < COMMODITY_IDS.length; ci++) {
      const qty = c.cargo[ci];
      if (qty <= 0) continue;
      const quote = quoteSell(town, ci, qty);
      const basisValue = c.costBasis[ci] * qty;
      if (quote.total >= basisValue * 0.98 || c.cash < LOW_CASH_TRIGGER) {
        this.sellCargo(c, ci, qty);
      }
    }
    if (c.def.owner !== 'player') this.npcTradeAndDepart(c);
  }

  private npcTradeAndDepart(c: CaravanRuntime): void {
    const townId = c.fromTown;
    const town = this.world.runtimes[townId];
    const neighbors = this.world.neighbors[townId];

    // 2. 扫描邻接路线,找扣除运费后单位净利最高的商品
    let best: { neighbor: number; ci: number; margin: number } | null = null;
    const usedCap = c.cargo.reduce((a, b) => a + b, 0);
    const spareCap = c.def.capacity - usedCap;
    if (spareCap > 1) {
      const probeQty = Math.min(80, spareCap);
      for (const neighbor of neighbors) {
        const road = this.world.roads[this.roadIndexOf(townId, neighbor)];
        for (let ci = 0; ci < COMMODITY_IDS.length; ci++) {
          const margin = routeUnitMargin(town, this.world.runtimes[neighbor], ci, probeQty);
          if (!isFinite(margin)) continue;
          const freightPerUnit =
            COMMODITIES[ci].weight * road.distance * FREIGHT_PER_WEIGHT_PER_LI;
          const net = margin - freightPerUnit;
          // 至少 2% 的净利才出手,过滤噪音交易
          if (net > unitPrice(town, ci) * 0.02 && (!best || net > best.margin)) {
            best = { neighbor, ci, margin: net };
          }
        }
      }
    }

    if (best) {
      const ci = best.ci;
      const road = this.world.roads[this.roadIndexOf(townId, best.neighbor)];
      // 预估满载新货的运费,从买货预算中预留,避免买完付不起运费
      const existingFreight = this.totalFreight(c, best.neighbor);
      const newLotFreight =
        Math.min(spareCap, COMMODITIES[ci].weight * spareCap) * road.distance * FREIGHT_PER_WEIGHT_PER_LI;
      const buyBudget = Math.max(0, c.cash - existingFreight - newLotFreight);
      const budgetQty = maxQtyForBudget(town, ci, buyBudget);
      const qty = Math.min(spareCap, budgetQty, town.stock[ci] * 0.25);
      if (qty >= 1) {
        const result = executeBuy(town, ci, qty, c.cash);
        if (result.ok) {
          c.cash -= result.cash;
          this.taxCollected += result.tax;
          this.addCargo(c, ci, result.qty, result.cash / result.qty);
        }
      }
    }

    // 3. 出发(无利可图也空车流转,保持路网流量)
    const target = best ? best.neighbor : neighbors[this.rng.int(0, neighbors.length)];
    this.depart(c, target);
  }

  // ———————————————————— 玩家交易接口 ————————————————————

  private player(): CaravanRuntime {
    return this.world.caravans[0];
  }

  playerTown(): number {
    return this.player().fromTown;
  }

  playerBuy(ci: number, qty: number): { ok: boolean; reason?: string } {
    const c = this.player();
    if (c.roadIndex >= 0) return { ok: false, reason: '商队在途中,无法交易' };
    const usedCap = c.cargo.reduce((a, b) => a + b, 0);
    if (usedCap + qty > c.def.capacity) return { ok: false, reason: '超出载货上限' };
    const town = this.world.runtimes[c.fromTown];
    const result = executeBuy(town, ci, qty, c.cash);
    if (!result.ok) return { ok: false, reason: result.reason };
    c.cash -= result.cash;
    this.taxCollected += result.tax;
    this.addCargo(c, ci, result.qty, result.cash / result.qty);
    return { ok: true };
  }

  playerSell(ci: number, qty: number): { ok: boolean; reason?: string } {
    const c = this.player();
    if (c.roadIndex >= 0) return { ok: false, reason: '商队在途中,无法交易' };
    if (c.cargo[ci] < qty) return { ok: false, reason: '载货不足' };
    const ok = this.sellCargo(c, ci, qty);
    return ok ? { ok: true } : { ok: false, reason: '城镇仓满,无法卖出' };
  }

  playerDispatch(townId: number): { ok: boolean; reason?: string } {
    const c = this.player();
    if (c.roadIndex >= 0) return { ok: false, reason: '商队已在途中' };
    if (!this.world.neighbors[c.fromTown].includes(townId))
      return { ok: false, reason: '目标城镇不在相邻驿路上' };
    const freight = this.totalFreight(c, townId);
    if (c.cash < freight) return { ok: false, reason: '运费不足' };
    this.depart(c, townId);
    return { ok: true };
  }

  // ———————————————————— 成交与运输 ————————————————————

  private addCargo(c: CaravanRuntime, ci: number, qty: number, unitCost: number): void {
    const oldQty = c.cargo[ci];
    const newQty = oldQty + qty;
    c.costBasis[ci] = (c.costBasis[ci] * oldQty + unitCost * qty) / newQty;
    c.cargo[ci] = newQty;
    c.loadedTown[ci] = c.fromTown;
  }

  /** 统一卖出路径:执行成交、入账现金、关税回收、损益与路线统计 */
  private sellCargo(c: CaravanRuntime, ci: number, qty: number): boolean {
    const town = this.world.runtimes[c.fromTown];
    const result = executeSell(town, ci, qty);
    if (!result.ok) return false;
    c.cash += -result.cash;
    this.taxCollected += result.tax;
    const profit = -result.cash - c.costBasis[ci] * result.qty;
    c.cargo[ci] -= result.qty;
    if (c.cargo[ci] < 0.001) {
      c.cargo[ci] = 0;
      c.costBasis[ci] = 0;
      c.loadedTown[ci] = -1;
    }
    c.todayProfit += profit;
    c.lifetimeProfit += profit;
    c.todayDeals++;
    this.recordRoute(c, ci, result.qty, profit);
    return true;
  }

  private recordRoute(c: CaravanRuntime, ci: number, qty: number, profit: number): void {
    let stat = this.dayStats.get(c.def.owner);
    if (!stat) {
      stat = { owner: c.def.owner, label: c.def.owner === 'player' ? '玩家商号' : c.def.owner, tradeProfit: 0, deals: 0, distance: 0, route: [] };
      this.dayStats.set(c.def.owner, stat);
    }
    stat.tradeProfit += profit;
    stat.deals++;
    if (stat.route.length < ROUTE_ENTRY_CAP) {
      stat.route.push({ from: c.loadedTown[ci], to: c.fromTown, commodity: COMMODITY_IDS[ci], qty, profit });
    }
  }

  private totalFreight(c: CaravanRuntime, targetTown: number): number {
    const road = this.world.roads[this.roadIndexOf(c.fromTown, targetTown)];
    let fee = 0;
    for (let ci = 0; ci < COMMODITY_IDS.length; ci++) {
      fee += freightCost(ci, c.cargo[ci], road.distance);
    }
    return fee;
  }

  private depart(c: CaravanRuntime, targetTown: number): void {
    const roadIdx = this.roadIndexOf(c.fromTown, targetTown);
    let freight = this.totalFreight(c, targetTown);
    // 硬保护:现金不足以支付运费时减免,保证商队不会因资金断裂卡死
    if (freight > c.cash) freight = 0;
    if (freight > 0) {
      // 运费摊入每单位持仓成本,卖出时自然体现为净利下降
      const totalUnits = c.cargo.reduce((a, b) => a + b, 0);
      if (totalUnits > 0) {
        for (let ci = 0; ci < COMMODITY_IDS.length; ci++) {
          if (c.cargo[ci] > 0) c.costBasis[ci] += freight / totalUnits;
        }
      }
      c.cash -= freight;
      this.freightCollected += freight;
    }
    c.roadIndex = roadIdx;
    c.toTown = targetTown;
    c.progress = 0;
  }

  // ———————————————————— 每日供需结算 ————————————————————

  private settleDay(): Alert[] {
    const towns = this.world.runtimes;
    // 1. 实体产出与消耗(含驿站马匹吃草料)
    for (const rt of towns) {
      const def = this.world.towns[rt.id];
      for (let ci = 0; ci < COMMODITY_IDS.length; ci++) {
        let flow = rt.netFlow[ci];
        if (COMMODITY_IDS[ci] === 'forage') flow -= def.horses * FORAGE_PER_HORSE_DAILY;
        const cap = stockCap(rt, ci);
        const next = rt.stock[ci] + flow;
        if (next < 0) {
          if (flow < 0) rt.shortageDays[ci]++;
          rt.stock[ci] = 0;
        } else if (next > cap) {
          rt.stock[ci] = cap; // 超出仓储的产出浪费掉
        } else {
          rt.stock[ci] = next;
          if (rt.stock[ci] > rt.target[ci] * 0.15) rt.shortageDays[ci] = Math.max(0, rt.shortageDays[ci] - 1);
        }
      }

      // 2. 公文酬劳:白银投放至城镇,玩家驿站分走三成(城镇→玩家转移,不额外增发)
      const mail =
        MAIL_INCOME_PER_TOWN *
        def.tier *
        (1 + this.rng.range(-MAIL_INCOME_JITTER, MAIL_INCOME_JITTER));
      rt.money += mail;
      this.injectedToday += mail;
      const playerShare = mail * 0.3;
      rt.money -= playerShare;
      this.player().cash += playerShare;

      // 3. 驿站养护:白银回收
      const upkeep = def.horses * STATION_DAILY_COST_PER_HORSE;
      rt.money -= upkeep;
      this.sunkToday += upkeep;

      // 4. 城镇银库兜底(官银投放)
      if (rt.money < TOWN_MONEY_FLOOR) {
        const topup = TOWN_MONEY_FLOOR - rt.money;
        rt.money = TOWN_MONEY_FLOOR;
        this.injectedToday += topup;
      }
    }

    this.sunkToday += this.taxCollected + this.freightCollected;

    // 5. 报警:单日利润 > 全服均值 × 10 且过绝对门槛
    const newAlerts = this.buildAlerts();

    // 6. 账本与历史
    this.ledger = this.computeLedger(this.injectedToday, this.sunkToday);
    this.supplyHistory.push({
      day: this.day,
      supply: this.ledger.totalSupply,
      injected: this.injectedToday,
      sunk: this.sunkToday,
    });
    if (this.supplyHistory.length > 120) this.supplyHistory.shift();

    // 7. 归零当日计数
    for (const c of this.world.caravans) {
      c.todayProfit = 0;
      c.todayDeals = 0;
      c.todayDistance = 0;
    }
    for (const rt of towns) {
      rt.lastVolume = COMMODITY_IDS.map(() => 0);
    }
    this.taxCollected = 0;
    this.freightCollected = 0;
    this.injectedToday = 0;
    this.sunkToday = 0;
    this.resetDayStats();
    this.day++;
    return newAlerts;
  }

  private buildAlerts(): Alert[] {
    const stats = [...this.dayStats.values()].filter((s) => s.deals > 0);
    if (stats.length < 2) return [];
    // 全服基准:用全部商号的均值展示;但判定单个商号时,排除其自身,
    // 避免异常值抬高均值线(风控口径)
    const total = stats.reduce((a, s) => a + s.tradeProfit, 0);
    const overallMean = total / stats.length;
    const flagged: Alert[] = [];
    for (const s of stats) {
      const peerMean = (total - s.tradeProfit) / (stats.length - 1);
      if (s.tradeProfit >= ALERT_ABSOLUTE_FLOOR && s.tradeProfit > peerMean * ALERT_PROFIT_MULTIPLE) {
        flagged.push({
          day: this.day,
          owner: s.owner,
          label: s.label,
          profit: s.tradeProfit,
          average: overallMean,
          multiple: peerMean !== 0 ? s.tradeProfit / peerMean : Infinity,
          route: [...s.route],
        });
      }
    }
    if (flagged.length > 0) {
      this.alerts.unshift(...flagged);
      if (this.alerts.length > MAX_ALERTS) this.alerts.length = MAX_ALERTS;
    }
    return flagged;
  }

  // ———————————————————— 刷钱复现(自愈演示) ————————————————————

  /**
   * 用一笔独立游资在相邻两镇间连续倒卖同一种商品,
   * 不占用商队、不影响商队位置,验证价差会被库存曲线快速吃掉。
   */
  runExploitDemo(commodityCi = 0, rounds = 12): ExploitReport {
    let bestPair: { from: number; to: number; diff: number } | null = null;
    for (const road of this.world.roads) {
      const pa = unitPrice(this.world.runtimes[road.a], commodityCi);
      const pb = unitPrice(this.world.runtimes[road.b], commodityCi);
      const diff = Math.abs(pa - pb) / Math.min(pa, pb);
      if (!bestPair || diff > bestPair.diff) bestPair = { from: pa < pb ? road.a : road.b, to: pa < pb ? road.b : road.a, diff };
    }
    if (!bestPair) throw new Error('world has no roads');

    const report: ExploitReport = {
      fromTown: bestPair.from,
      toTown: bestPair.to,
      commodity: COMMODITY_IDS[commodityCi],
      rounds: [],
      initialSpreadPct: bestPair.diff * 100,
      finalSpreadPct: 0,
      totalProfit: 0,
    };
    let cash = PLAYER_INITIAL_CASH;
    const TRADE_LOT = 80; // 单笔 80 单位:小批量刷差价的真实手法
    for (let round = 1; round <= rounds; round++) {
      const from = this.world.runtimes[bestPair.from];
      const to = this.world.runtimes[bestPair.to];
      // 先记录成交前价格,真实反映本轮开仓时的价差
      const buyPrice = unitPrice(from, commodityCi);
      const sellPrice = unitPrice(to, commodityCi);
      const spreadBefore = ((sellPrice - buyPrice) / buyPrice) * 100;
      // 价差已反转/收敛到运费带宽内,套利窗口关闭
      if (spreadBefore < 0.03) break;
      // 单笔不超过卖方库存的 15%,抑制滑点
      const qty = Math.min(
        TRADE_LOT,
        maxQtyForBudget(from, commodityCi, cash * 0.5),
        maxSellableQty(to, commodityCi),
        from.stock[commodityCi] * 0.15,
      );
      if (qty < 1) break;
      const buy = executeBuy(from, commodityCi, qty, cash);
      if (!buy.ok) break;
      cash -= buy.cash;
      const sell = executeSell(to, commodityCi, buy.qty);
      if (!sell.ok) break;
      // 按真实驿路里程扣除运费(演示用独立游资,不进入正式账本)
      const road = this.world.roads[this.roadIndexOf(bestPair.from, bestPair.to)];
      const freight = freightCost(commodityCi, buy.qty, road.distance);
      cash += -sell.cash - freight;
      const profit = -sell.cash - buy.cash - freight;
      report.totalProfit += profit;
      report.rounds.push({
        round,
        buyPrice,
        sellPrice,
        spreadPct: spreadBefore,
        qty: buy.qty,
        profit,
      });
    }
    const finalFrom = unitPrice(this.world.runtimes[bestPair.from], commodityCi);
    const finalTo = unitPrice(this.world.runtimes[bestPair.to], commodityCi);
    report.finalSpreadPct = (Math.abs(finalTo - finalFrom) / Math.min(finalFrom, finalTo)) * 100;
    return report;
  }

  // ———————————————————— 测试钩子(正常模拟路径不调用) ————————————————————

  /** 直接调整某商号的当日贸易统计,用于报警阈值的确定性测试 */
  __debugSetDayStat(owner: string, tradeProfit: number, deals = 1): void {
    const stat = this.dayStats.get(owner);
    if (stat) {
      stat.tradeProfit = tradeProfit;
      stat.deals = deals;
      if (stat.route.length === 0 && deals > 0) {
        stat.route.push({ from: 0, to: 1, commodity: COMMODITY_IDS[0], qty: 10, profit: tradeProfit });
      }
    }
  }

  /** 立即执行一次日结并返回新报警,跳过剩余子步等待 */
  __debugSettleNow(): Alert[] {
    this.substep = SUBSTEPS_PER_DAY - 1;
    return this.step().newAlerts;
  }

  // ———————————————————— 快照与账本 ————————————————————

  private computeLedger(injected: number, sunk: number): SilverLedger {
    let townReserve = 0;
    for (const rt of this.world.runtimes) townReserve += rt.money;
    let merchantCash = 0;
    for (const c of this.world.caravans) merchantCash += c.cash;
    return {
      totalSupply: townReserve + merchantCash,
      townReserve,
      merchantCash,
      injected,
      sunk,
    };
  }

  private resetDayStats(): void {
    this.dayStats.clear();
    for (const c of this.world.caravans) {
      if (!this.dayStats.has(c.def.owner)) {
        this.dayStats.set(c.def.owner, {
          owner: c.def.owner,
          label: c.def.owner === 'player' ? '玩家商号' : c.def.owner,
          tradeProfit: 0,
          deals: 0,
          distance: 0,
          route: [],
        });
      }
    }
  }

  private roadKey(a: number, b: number): number {
    return a < b ? a * 1000 + b : b * 1000 + a;
  }

  private roadIndexOf(a: number, b: number): number {
    const idx = this.roadIndex.get(this.roadKey(a, b));
    if (idx === undefined) throw new Error(`no road between ${a} and ${b}`);
    return idx;
  }
}
