// 全局经济常量与商品定义
export type CommodityId = 'forage' | 'grain' | 'horses' | 'goods';

export interface CommodityDef {
  id: CommodityId;
  name: string;
  /** 全局基准价(文) */
  basePrice: number;
  /** 库存弹性系数 k:越大,同样的库存偏离造成的价格波动越剧烈 */
  elasticity: number;
  /** 每单位重量(石/匹),用于运费 */
  weight: number;
  /** 价格刻度(界面取整) */
  tick: number;
}

export const COMMODITIES: readonly CommodityDef[] = [
  { id: 'forage', name: '草料', basePrice: 200, elasticity: 0.8, weight: 1, tick: 5 },
  { id: 'grain', name: '粮米', basePrice: 600, elasticity: 1.0, weight: 2, tick: 10 },
  { id: 'horses', name: '马匹', basePrice: 12000, elasticity: 1.4, weight: 8, tick: 100 },
  { id: 'goods', name: '绸缎杂货', basePrice: 3000, elasticity: 1.1, weight: 3, tick: 50 },
];

export const COMMODITY_MAP: Readonly<Record<CommodityId, CommodityDef>> = Object.fromEntries(
  COMMODITIES.map((c) => [c.id, c]),
) as Record<CommodityId, CommodityDef>;

export const COMMODITY_IDS: readonly CommodityId[] = COMMODITIES.map((c) => c.id);

// —— 经济规则 ——
export const TRANSACTION_TAX = 0.02; // 关税 2%(买卖双向),白银回收
export const FREIGHT_PER_WEIGHT_PER_LI = 0.08; // 运费:文 / 重量单位 / 里
export const STOCK_CAP_RATIO = 2.2; // 库存上限 = 目标库存 × 2.2
export const MIN_STOCK_RATIO = 0.02; // 买入后保留的最低库存比例(防止买空)
export const TOWN_MONEY_FLOOR = 500_000; // 城镇银库兜底(文),低于则由官银补充(投放)

export const PLAYER_INITIAL_CASH = 200_000; // 玩家初始白银(文)
export const CARAVAN_CAP_MIN = 60;
export const CARAVAN_CAP_MAX = 240;

// 驿站经营
export const STATION_DAILY_COST_PER_HORSE = 240; // 每匹马每日草料+人工
export const MAIL_INCOME_PER_TOWN = 52_000; // 每城镇每日公文酬劳均值(白银投放)
export const MAIL_INCOME_JITTER = 0.25;
export const FORAGE_PER_HORSE_DAILY = 0.25; // 每匹马每日消耗草料(石)

// 报警规则
export const ALERT_PROFIT_MULTIPLE = 10; // 单日利润超过全服均值的倍数
export const ALERT_ABSOLUTE_FLOOR = 300_000; // 报警绝对门槛(文),避免低基数误报
export const MAX_ALERTS = 30;

export const TOWN_COUNT = 30;
export const DEFAULT_CARAVAN_COUNT = 1000;
export const BOT_MERCHANT_COUNT = 8; // 与玩家同口径参与报警的模拟商号

export function formatMoney(wen: number): string {
  const sign = wen < 0 ? '-' : '';
  const abs = Math.abs(wen);
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(2)} 两`;
  return `${sign}${Math.round(abs)} 文`;
}

export function formatQty(q: number): string {
  return q >= 100 ? q.toFixed(0) : q.toFixed(1);
}
