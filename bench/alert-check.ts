/**
 * 报警链路验证:
 *  A. 正常日结不报警(NPC 利润均在正常区间)
 *  B. 测试钩子注入玩家暴利 → 触发 10 倍阈值报警,且路线数据完整可在地图还原
 *  C. 低于绝对门槛不报警(防低基数误报)
 */
import { EconomyEngine } from '../src/core/engine';
import { ALERT_ABSOLUTE_FLOOR, formatMoney } from '../src/core/constants';

let failures = 0;
const check = (name: string, cond: boolean, detail = ''): void => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name} ${detail}`);
  if (!cond) failures++;
};

const engine = new EconomyEngine(7, 1000);
engine.step(); // 推进一个子步,保证日结链路可用

// —— A. 先做一次普通日结:不应有报警 ——
const normalAlerts = engine.__debugSettleNow();
check('普通游戏日不产生报警', normalAlerts.length === 0, `实际 ${normalAlerts.length} 条`);

// —— B. 注入玩家暴利:均值约 20 万,玩家 500 万(25 倍,且过绝对门槛)——
engine.step();
engine.__debugSetDayStat('player', 5_000_000, 6);
for (const owner of ['万通号', '恒顺昌', '裕德隆', '广聚源', '同兴公', '义盛和', '瑞蚨祥', '日升昌']) {
  engine.__debugSetDayStat(owner, 200_000, 4);
}
const alerts = engine.__debugSettleNow();
check('暴利场景触发且仅触发 1 条报警', alerts.length === 1, `实际 ${alerts.length} 条`);
const a = alerts[0];
if (a) {
  check('报警对象为玩家商号', a.owner === 'player');
  check('倍数超过 10 倍红线', a.multiple >= 10, `${a.multiple.toFixed(1)}x`);
  check('利润过绝对门槛', a.profit >= ALERT_ABSOLUTE_FLOOR, formatMoney(a.profit));
  check('路线数据完整(含起讫城镇与商品)', a.route.length > 0 && a.route.every((r) => r.from >= 0 && r.to >= 0 && r.commodity));
  check('报警已入引擎历史', engine.alerts.includes(a));
  console.log(`     详情: 第${a.day}日 利润${formatMoney(a.profit)} 均值${formatMoney(a.average)} ${a.multiple.toFixed(1)}倍 路线${a.route.length}段`);
}

// —— C. 低基数场景:均值 5 千、玩家 4 万(8 倍且不过绝对门槛)——
engine.step();
engine.__debugSetDayStat('player', 40_000, 2);
for (const owner of ['万通号', '恒顺昌', '裕德隆', '广聚源', '同兴公', '义盛和', '瑞蚨祥', '日升昌']) {
  engine.__debugSetDayStat(owner, 5_000, 1);
}
const quiet = engine.__debugSettleNow();
check('低基数场景不报警(绝对门槛保护)', quiet.length === 0, `实际 ${quiet.length} 条`);

if (failures > 0) process.exit(1);
console.log('\n🎉 报警链路全部通过');
