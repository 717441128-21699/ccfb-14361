/**
 * 经济不变量测试:
 *  1. 白银恒等式:每日 Δ流通总量 == 投放 - 回收(关税/运费/养护均退出流通)
 *  2. 库存始终落在 [0, 目标×2.2],价格恒正且有限
 *  3. 商队现金非负、载货不超上限
 *  4. NPC 商队确实在持续交易
 *  5. 倒卖自愈:连续套利后价差收敛
 */
import { EconomyEngine, SUBSTEPS_PER_DAY } from '../src/core/engine';
import { COMMODITY_IDS, STOCK_CAP_RATIO } from '../src/core/constants';
import { unitPrice } from '../src/core/market';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

const DAYS = 120;
const engine = new EconomyEngine(20261121, 1000);
let conservationErrors = 0;
let maxRelDrift = 0;
let dealsAcrossDays = 0;
let daysWithDeals = 0;

for (let d = 0; d < DAYS; d++) {
  const supplyBefore = engine.ledger.totalSupply;
  for (let s = 0; s < SUBSTEPS_PER_DAY; s++) {
    // 最后一个子步触发结算,在其执行前采样当日累计成交
    if (s === SUBSTEPS_PER_DAY - 1) {
      const dayDeals = engine.world.caravans.reduce((a, c) => a + c.todayDeals, 0);
      dealsAcrossDays += dayDeals;
      if (dayDeals > 0) daysWithDeals++;
    }
    engine.step();
  }
  const after = engine.ledger;
  const expected = supplyBefore + after.injected - after.sunk;
  const drift = Math.abs(after.totalSupply - expected);
  const rel = drift / Math.max(1, Math.abs(expected));
  maxRelDrift = Math.max(maxRelDrift, rel);
  if (rel > 1e-9) conservationErrors++;
}

console.log('════════════ 1. 白银恒等式 ════════════');
check(`120 个游戏日逐日对账全部闭合(最大相对偏差 ${maxRelDrift.toExponential(2)})`, conservationErrors === 0);

console.log('════════════ 2. 库存与价格边界 ════════════');
let badStock = 0;
let badPrice = 0;
for (const rt of engine.world.runtimes) {
  for (let ci = 0; ci < COMMODITY_IDS.length; ci++) {
    if (rt.stock[ci] < -1e-9 || rt.stock[ci] > rt.target[ci] * STOCK_CAP_RATIO + 1e-6) badStock++;
    const p = unitPrice(rt, ci);
    if (!isFinite(p) || p <= 0) badPrice++;
  }
}
check('全部城镇库存 ∈ [0, 目标×2.2]', badStock === 0, `违规 ${badStock} 处`);
check('全部价格恒正且有限', badPrice === 0, `违规 ${badPrice} 处`);

console.log('════════════ 3. 商队约束 ════════════');
let badCash = 0;
let badCap = 0;
for (const c of engine.world.caravans) {
  if (c.cash < -1e-6) badCash++;
  if (c.cargo.reduce((a, b) => a + b, 0) > c.def.capacity + 1e-6) badCap++;
}
check('商队现金非负', badCash === 0, `违规 ${badCash} 支`);
check('载货不超过商队容量', badCap === 0, `违规 ${badCap} 支`);

console.log('════════════ 4. 市场活跃度 ════════════');
const moving = engine.world.caravans.filter((c) => c.roadIndex >= 0).length;
check(`120 日累计成交 ${dealsAcrossDays} 笔,覆盖 ${daysWithDeals}/120 个游戏日`, dealsAcrossDays > 1000 && daysWithDeals >= 115);
check('路网有商队在途', moving > 100, `在途 ${moving} 支`);

console.log('════════════ 5. 倒卖自愈 ════════════');
const fresh = new EconomyEngine(20261121, 1000);
const report = fresh.runExploitDemo(0, 12);
check('首轮存在套利空间且盈利', report.rounds[0]?.profit > 0, `首轮净利 ${Math.round(report.rounds[0]?.profit ?? 0)}`);
const laterLoss = report.rounds.slice(1).some((r) => r.profit <= 0);
check('后续轮次利润归零或转亏', laterLoss);
const last = report.rounds[report.rounds.length - 1];
check('末次价差相对首次显著收敛(>80%)', last && last.spreadPct < report.rounds[0].spreadPct * 0.2,
  `首 ${report.rounds[0].spreadPct.toFixed(1)}% → 末 ${last?.spreadPct.toFixed(1)}%`);

console.log('');
if (failures === 0) {
  console.log('🎉 全部不变量通过');
} else {
  console.log(`💥 ${failures} 项检查失败`);
  process.exit(1);
}
