import {
  COMMODITIES,
  FREIGHT_PER_WEIGHT_PER_LI,
  MIN_STOCK_RATIO,
  STOCK_CAP_RATIO,
  TRANSACTION_TAX,
} from './constants';
import type { TownRuntime } from './types';

/**
 * 动态定价核心:
 *   unitPrice(s) = basePrice * exp(k * (target - s) / target)
 * 库存低于目标 → 涨价;高于目标 → 跌价。
 * 大单按曲线积分成交,天然带滑点:买得越多单价越贵,砸盘卖出越便宜。
 */
export function unitPrice(rt: TownRuntime, ci: number): number {
  const def = COMMODITIES[ci];
  const t = rt.target[ci];
  return def.basePrice * Math.exp((def.elasticity * (t - rt.stock[ci])) / t);
}

/** 库存上限/下限 */
export function stockCap(rt: TownRuntime, ci: number): number {
  return rt.target[ci] * STOCK_CAP_RATIO;
}
function stockFloor(rt: TownRuntime, ci: number): number {
  return rt.target[ci] * MIN_STOCK_RATIO;
}

export interface Quote {
  /** 成交价合计(税前) */
  amount: number;
  /** 关税 */
  tax: number;
  /** 实际收付(含税) */
  total: number;
  /** 成交均价 */
  avgPrice: number;
}

/** 报价:从城镇买入 qty(城镇库存减少) */
export function quoteBuy(rt: TownRuntime, ci: number, qty: number): Quote {
  if (qty <= 0) return { amount: 0, tax: 0, total: 0, avgPrice: 0 };
  const def = COMMODITIES[ci];
  const t = rt.target[ci];
  const s = rt.stock[ci];
  const end = Math.max(stockFloor(rt, ci), s - qty);
  const realQty = s - end;
  // 积分:cost = (T/k) * (p(end) - p(start))
  const amount = (t / def.elasticity) * (unitPriceAt(def, t, end) - unitPriceAt(def, t, s));
  const tax = amount * TRANSACTION_TAX;
  return { amount, tax, total: amount + tax, avgPrice: amount / realQty };
}

/** 报价:向城镇卖出 qty(城镇库存增加) */
export function quoteSell(rt: TownRuntime, ci: number, qty: number): Quote {
  if (qty <= 0) return { amount: 0, tax: 0, total: 0, avgPrice: 0 };
  const def = COMMODITIES[ci];
  const t = rt.target[ci];
  const s = rt.stock[ci];
  const cap = stockCap(rt, ci);
  const end = Math.min(cap, s + qty);
  const realQty = end - s;
  if (realQty <= 0) return { amount: 0, tax: 0, total: 0, avgPrice: 0 };
  // 积分:revenue = (T/k) * (p(start) - p(end))
  const amount = (t / def.elasticity) * (unitPriceAt(def, t, s) - unitPriceAt(def, t, end));
  const tax = amount * TRANSACTION_TAX;
  return { amount, tax, total: amount - tax, avgPrice: amount / realQty };
}

function unitPriceAt(
  def: { basePrice: number; elasticity: number },
  target: number,
  stock: number,
): number {
  return def.basePrice * Math.exp((def.elasticity * (target - stock)) / target);
}

/** 在预算内可买的最大数量(反解积分公式) */
export function maxQtyForBudget(rt: TownRuntime, ci: number, budget: number): number {
  if (budget <= 0) return 0;
  const def = COMMODITIES[ci];
  const t = rt.target[ci];
  const s = rt.stock[ci];
  const floor = stockFloor(rt, ci);
  // 含税预算 → 税前金额
  const amountCap = budget / (1 + TRANSACTION_TAX);
  const pStart = unitPriceAt(def, t, s);
  // exp(k*q/T) = 1 + amount*k/(T*p(start))
  const q = (t / def.elasticity) * Math.log(1 + (amountCap * def.elasticity) / (t * pStart));
  return Math.max(0, Math.min(q, s - floor));
}

/** 卖方向城镇最多能卖出多少(受库存上限约束) */
export function maxSellableQty(rt: TownRuntime, ci: number): number {
  return Math.max(0, stockCap(rt, ci) - rt.stock[ci]);
}

/** 运费(文):按重量与里程 */
export function freightCost(ci: number, qty: number, distanceLi: number): number {
  const def = COMMODITIES[ci];
  return qty * def.weight * distanceLi * FREIGHT_PER_WEIGHT_PER_LI;
}

export interface TradeResult {
  ok: boolean;
  qty: number;
  cash: number; // 买方视角:正=支出,负=收入
  tax: number;
  avgPrice: number;
  reason?: string;
}

/** 执行买入:商队付现金(货款+关税),城镇只收货款,关税上缴退出流通 */
export function executeBuy(rt: TownRuntime, ci: number, qty: number, cash: number): TradeResult {
  const quote = quoteBuy(rt, ci, qty);
  if (quote.amount <= 0) return { ok: false, qty: 0, cash: 0, tax: 0, avgPrice: 0, reason: '城镇库存不足' };
  if (cash < quote.total) return { ok: false, qty: 0, cash: 0, tax: 0, avgPrice: 0, reason: '银两不足' };
  const realQty = Math.min(qty, rt.stock[ci] - stockFloor(rt, ci));
  rt.stock[ci] -= realQty;
  rt.money += quote.amount;
  rt.lastVolume[ci] += realQty;
  return { ok: true, qty: realQty, cash: quote.total, tax: quote.tax, avgPrice: quote.avgPrice };
}

/** 执行卖出:城镇付货款,商队实收扣关税后的金额,关税退出流通 */
export function executeSell(rt: TownRuntime, ci: number, qty: number): TradeResult {
  const quote = quoteSell(rt, ci, qty);
  if (quote.amount <= 0) return { ok: false, qty: 0, cash: 0, tax: 0, avgPrice: 0, reason: '城镇仓满' };
  const cap = stockCap(rt, ci);
  const realQty = Math.min(qty, cap - rt.stock[ci]);
  rt.stock[ci] += realQty;
  rt.money -= quote.amount;
  rt.lastVolume[ci] += realQty;
  return { ok: true, qty: realQty, cash: -quote.total, tax: quote.tax, avgPrice: quote.avgPrice };
}

/**
 * 路线毛利测算(不含运费):在 from 买 qty、到 to 卖出的净利。
 * 返回单位净利,供 NPC 商队比价。买/卖两端的滑点都计入。
 */
export function routeUnitMargin(
  from: TownRuntime,
  to: TownRuntime,
  ci: number,
  qty: number,
): number {
  if (qty <= 0) return -Infinity;
  const buy = quoteBuy(from, ci, qty);
  const sell = quoteSell(to, ci, qty);
  if (buy.amount <= 0 || sell.amount <= 0) return -Infinity;
  return (sell.total - buy.total) / qty;
}
