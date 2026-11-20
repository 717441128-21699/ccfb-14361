/**
 * 性能基准:30 城镇 × 1000 NPC 商队,完整游戏日(8 子步,含每日供需结算)耗时
 * 运行:npm run bench
 */
import { performance } from 'node:perf_hooks';
import { EconomyEngine, SUBSTEPS_PER_DAY } from '../src/core/engine';
import { DEFAULT_CARAVAN_COUNT } from '../src/core/constants';

const DAYS = 60;
const seed = 20261121;

const engine = new EconomyEngine(seed, DEFAULT_CARAVAN_COUNT);
const dayMs: number[] = [];

// 预热 5 天(V8 JIT)
for (let d = 0; d < 5; d++) {
  for (let s = 0; s < SUBSTEPS_PER_DAY; s++) engine.step();
}

for (let d = 0; d < DAYS; d++) {
  const t0 = performance.now();
  for (let s = 0; s < SUBSTEPS_PER_DAY; s++) engine.step();
  dayMs.push(performance.now() - t0);
}

dayMs.sort((a, b) => a - b);
const sum = dayMs.reduce((a, b) => a + b, 0);
const avg = sum / dayMs.length;
const p50 = dayMs[Math.floor(dayMs.length * 0.5)];
const p95 = dayMs[Math.floor(dayMs.length * 0.95)];
const max = dayMs[dayMs.length - 1];

// 经济健康度快照
const towns = engine.world.runtimes;

console.log('════════════ 经济结算性能基准 ════════════');
console.log(`城镇数: ${towns.length}  商队数: ${engine.world.caravans.length}  样本天数: ${DAYS}`);
console.log(`单日(8 子步)墙钟耗时`);
console.log(`  平均: ${avg.toFixed(2)} ms`);
console.log(`  P50 : ${p50.toFixed(2)} ms`);
console.log(`  P95 : ${p95.toFixed(2)} ms`);
console.log(`  最大: ${max.toFixed(2)} ms`);
console.log(`红线要求: 单日 < 50 ms   → ${max < 50 ? '✅ 达标' : '❌ 超标'}`);
console.log('');

// —— 刷钱自愈验证:连续倒卖,观察价差收敛 ——
const fresh = new EconomyEngine(seed, DEFAULT_CARAVAN_COUNT);
const report = fresh.runExploitDemo(0, 12);
console.log('════════════ 倒卖自愈验证(草料) ════════════');
console.log(`路线: ${fresh.world.towns[report.fromTown].name} → ${fresh.world.towns[report.toTown].name}`);
console.log(`开仓前价差: ${report.initialSpreadPct.toFixed(1)}%  →  第二轮开仓前: ${report.rounds[1]?.spreadPct.toFixed(1) ?? '-'}%(一轮套利后即反转)`);
for (const r of report.rounds) {
  console.log(
    `  第${String(r.round).padStart(2)}轮 买价${Math.round(r.buyPrice)} 卖价${Math.round(r.sellPrice)} ` +
      `价差${r.spreadPct.toFixed(1)}% 数量${r.qty.toFixed(0)} 净利${Math.round(r.profit)}文`,
  );
}
const firstProfit = report.rounds[0]?.profit ?? 0;
const lastProfit = report.rounds[report.rounds.length - 1]?.profit ?? 0;
console.log(`首轮净利 ${Math.round(firstProfit)}文 → 末轮净利 ${Math.round(lastProfit)}文,共 ${report.rounds.length} 轮`);
const profitableRounds = report.rounds.filter((r) => r.profit > 0).length;
const converged = report.rounds.length >= 2 && report.rounds[report.rounds.length - 1].spreadPct < report.rounds[0].spreadPct * 0.25;
console.log(`盈利轮次 ${profitableRounds}/${report.rounds.length}`);
console.log(converged ? '✅ 数轮内价差收敛到运费带宽,套利窗口关闭' : '⚠️ 收敛不明显');
