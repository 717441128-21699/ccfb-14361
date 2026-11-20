import type { CommodityId } from './constants';

export type TownTier = 1 | 2 | 3;
export type TownProfile = 'farm' | 'ranch' | 'craft' | 'market';

export interface TownDef {
  id: number;
  name: string;
  tier: TownTier;
  profile: TownProfile;
  x: number; // 程序生成的地图坐标(0~1000)
  y: number;
  horses: number; // 驿站养马数
}

export interface TownRuntime {
  id: number;
  /** 实际库存,按商品索引(与 COMMODITY_IDS 对齐) */
  stock: number[];
  /** 目标库存(供需基准),按商品索引 */
  target: number[];
  /** 每日净产出(正=产出,负=消耗),按商品索引 */
  netFlow: number[];
  /** 城镇银库(文) */
  money: number;
  /** 昨日各商品成交量(买+卖),按商品索引 */
  lastVolume: number[];
  /** 累计缺货天数,按商品索引 */
  shortageDays: number[];
}

export interface Road {
  a: number;
  b: number;
  /** 道路长度(里) */
  distance: number;
}

export interface CaravanDef {
  id: number;
  name: string;
  /** 所属商号;玩家商号为 'player' */
  owner: string;
  capacity: number;
  /** 颜色仅前端使用,sim 内也保留以便 worker 直传 */
  color: string;
}

export interface CaravanRuntime {
  id: number;
  def: CaravanDef;
  /** -1 表示停驻在某城镇,否则为道路索引 */
  roadIndex: number;
  fromTown: number;
  toTown: number;
  /** 0~1,道路行进进度 */
  progress: number;
  /** 当前载货,按商品索引 */
  cargo: number[];
  /** 每单位持仓成本(买价+关税+运费),按商品索引 */
  costBasis: number[];
  /** 当前载货的装车城镇,按商品索引(-1 表示无) */
  loadedTown: number[];
  cash: number;
  /** 累计贸易净利(文) */
  lifetimeProfit: number;
  /** 今日贸易净利(文),每日归零 */
  todayProfit: number;
  /** 今日完成的成交笔数 */
  todayDeals: number;
  /** 今日行驶里数 */
  todayDistance: number;
}

/** 玩家/商号单日统计(报警口径) */
export interface MerchantDayStat {
  owner: string;
  label: string;
  tradeProfit: number;
  deals: number;
  distance: number;
  /** 当日成交路线,用于地图还原 */
  route: Array<{ from: number; to: number; commodity: CommodityId; qty: number; profit: number }>;
}

export interface Alert {
  day: number;
  owner: string;
  label: string;
  profit: number;
  average: number;
  multiple: number;
  route: MerchantDayStat['route'];
}

export interface SilverLedger {
  /** 流通白银总量:城镇银库 + 所有商队/商号现金 */
  totalSupply: number;
  townReserve: number;
  merchantCash: number;
  /** 当日投放(公文酬劳 + 官银兜底) */
  injected: number;
  /** 当日回收(关税 + 运费 + 驿站养护) */
  sunk: number;
}
