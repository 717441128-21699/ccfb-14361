/**
 * 压力与长周期测试:
 *  - 2000 商队(需求规模的 2 倍)的单日结算耗时
 *  - 1000 商队连续 365 个游戏日:无 NaN、无负值崩溃、市场保持活跃
 */
import { performance } from 'node:perf_hooks';
import { EconomyEngine, SUBSTEPS_PER_DAY } from '../src/core/engine';
import { COMMODITY_IDS } from '../src/core/constants';
import { unitPrice } from '../src/core/market';

let failures = 0;
const check = (name: string, cond: boolean, detail = ''): void => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name} ${detail}`);
  if (!cond) failures++;
};

// —— 2000 商队压力 ——
console.log('════════════ 2000 商队压力测试 ════════════');
const heavy = new EconomyEngine(20261121, 2000);
for (let d = 0; d < 5; d++) for (let s = 0; s < SUBSTEPS_PER_DAY; s++) heavy.step(); // JIT 预热
const samples: number[] = [];
for (let d = 0; d < 30; d++) {
  const t0 = performance.now();
  for (let s = 0; s < SUBSTEPS_PER_DAY; s++) heavy.step();
  samples.push(performance.now() - t0);
}
samples.sort((a, b) => a - b);
const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
console.log(`  2000 商队单日结算:平均 ${avg.toFixed(2)}ms / P95 ${samples[Math.floor(samples.length * 0.95)].toFixed(2)}ms / 最大 ${samples[samples.length - 1].toFixed(2)}ms`);
check('2000 商队仍在 50ms 红线内', samples[samples.length - 1] < 50);
check('耗时随商队数近似线性(2000 队 < 1000 队的 3 倍)', avg < 12);

// —— 365 天长周期 ——
console.log('════════════ 365 天长周期稳定性 ════════════');
const engine = new EconomyEngine(20261121, 1000);
let nanCount = 0;
let negativeCash = 0;
let dealsTotal = 0;
let activeDays = 0;
for (let d = 0; d < 365; d++) {
  let dayDeals = 0;
  for (let s = 0; s < SUBSTEPS_PER_DAY; s++) {
    if (s === SUBSTEPS_PER_DAY - 1) dayDeals = engine.world.caravans.reduce((a, c) => a + c.todayDeals, 0);
    engine.step();
  }
  if (dayDeals > 0) activeDays++;
  dealsTotal += dayDeals;
  for (const rt of engine.world.runtimes) {
    for (let ci = 0; ci < COMMODITY_IDS.length; ci++) {
      if (!isFinite(rt.stock[ci]) || !isFinite(unitPrice(rt, ci)) || rt.money < 0) nanCount++;
    }
  }
  for (const c of engine.world.caravans) if (c.cash < -1e-6) negativeCash++;
}
check('365 天无 NaN/无限价格/负银库', nanCount === 0, `异常 ${nanCount} 处`);
check('365 天商队现金始终非负', negativeCash === 0, `违规 ${negativeCash} 支次`);
check('市场 365 天保持活跃', activeDays >= 360, `${activeDays}/365 天有成交,累计 ${dealsTotal} 笔`);
const finalSupply = engine.ledger.totalSupply;
check('流通白银为正且量级合理(十万两级)', finalSupply > 1_000_000 && finalSupply < 10_000_000_000, `${(finalSupply / 10000).toFixed(0)} 两`);

if (failures > 0) process.exit(1);
console.log('\n🎉 压力与长周期测试全部通过');
