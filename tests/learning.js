/* 学习引擎算法校验：BKT 数值、FSRS 排期、掌握度分级、事件重算 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const L = window.Learning;
    const out = {};

    // 1. BKT 单调性与教科书一致性
    let p = L.BKT.P_INIT;
    const seq = [];
    seq.push(p);
    p = L.bktUpdate(p, false); seq.push(p);   // 答错
    p = L.bktUpdate(p, true);  seq.push(p);   // 答对
    p = L.bktUpdate(p, true);  seq.push(p);   // 答对
    out.bkt = seq.map(x => Number(x.toFixed(4)));

    // 2. 答对涨、答错跌，但答错不会归零（transit 兜底）
    out.wrongNotZero = L.bktUpdate(0.8, false) > 0.1;
    out.rightRises = L.bktUpdate(0.5, true) > 0.5;
    out.wrongFalls = L.bktUpdate(0.5, false) < 0.5;
    out.capped = L.bktUpdate(0.999, true) <= 0.999;

    // 3. 多次答对后趋近上限
    let q = 0.2;
    for (let i = 0; i < 20; i++) q = L.bktUpdate(q, true);
    out.after20Right = Number(q.toFixed(4));

    // 4. FSRS 稳定性
    out.sAgain = L.nextStability(1.0, 5, 'again');   // 0.5
    out.sGood = L.nextStability(1.0, 5, 'good');     // 2.0
    out.sHard = L.nextStability(1.0, 5, 'hard');     // 1.2
    out.sEasy = L.nextStability(1.0, 5, 'easy');     // 3.0
    out.sHardD = L.nextStability(1.0, 10, 'good');   // 难度高涨得慢
    out.sEasyD = L.nextStability(1.0, 1, 'good');    // 难度低涨得快
    out.sFloor = L.nextStability(0.5, 5, 'again');   // 下限 0.5

    // 5. 难度夹在 1~10
    let d = 5;
    for (let i = 0; i < 20; i++) d = L.nextDifficulty(d, 'again');
    out.dMax = d;
    d = 5;
    for (let i = 0; i < 20; i++) d = L.nextDifficulty(d, 'good');
    out.dMin = d;

    // 6. 保持率：到期那天恰好 0.9
    const now = Date.now();
    const S = 4;
    out.retAtDue = Number(L.retention(S, now - 4 * 86400000, now).toFixed(4));
    out.retAtHalf = Number(L.retention(S, now - 2 * 86400000, now).toFixed(4));
    out.retAtZero = L.retention(S, now, now);

    // 7. 掌握度分级
    out.levels = [0.95, 0.7, 0.4, 0.1].map(x => L.levelOf(x));
    out.unknownLevel = L.levelOf(null);

    // 8. 事件重算：三条证据才给分
    const ev1 = [{ kind: 'attempt', point: '密码', correct: true, at: now - 86400000 }];
    const m1 = L.masteryOf({ events: ev1 }, now);
    out.oneEventScore = m1.byPoint['密码'].score;   // null

    const ev2 = ev1.concat([{ kind: 'attempt', point: '密码', correct: true, at: now - 2 * 86400000 }]);
    const m2 = L.masteryOf({ events: ev2 }, now);
    out.twoEventsScore = m2.byPoint['密码'].score != null;
    out.twoEventsP = Number(m2.byPoint['密码'].p.toFixed(3));

    // 9. 多条错误序列 → 复盘差异
    const evMix = [
      { kind: 'attempt', point: '访客', correct: false, at: now - 5 * 86400000 },
      { kind: 'attempt', point: '访客', correct: true, at: now - 4 * 86400000 },
      { kind: 'attempt', point: '访客', correct: true, at: now - 3 * 86400000 }
    ];
    const m4 = L.masteryOf({ events: evMix }, now);
    out.mixP = Number(m4.byPoint['访客'].p.toFixed(3));
    out.mixStreak = m4.byPoint['访客'].streak;
    out.mixGraduated = m4.byPoint['访客'].graduated;

    // 10. 到期判定
    const evOld = [{ kind: 'attempt', point: '旧', correct: true, at: now - 30 * 86400000 }];
    const m5 = L.masteryOf({ events: evOld }, now);
    out.overdue = m5.byPoint['旧'].overdue;
    out.retentionDecayed = m5.byPoint['旧'].retention < 0.5;

    // 11. nextAction 优先级
    out.nextEmpty = L.nextAction({ events: [] }, now).type;
    out.nextReview = L.nextAction({ events: evOld }, now).type;

    // 12. 无知识点时归入「综合考核」
    const mNoPoint = L.masteryOf({ events: [{ kind: 'attempt', point: '', correct: true, at: now }] }, now);
    out.fallbackPoint = Object.keys(mNoPoint.byPoint)[0];

    // 13. 事件只追加
    const rec = { events: [] };
    L.appendEvents(rec, L.eventsFromAttempt([
      { q: { id: 'q1', point: 'A', score: 5 }, ok: true, earned: 5 },
      { q: { id: 'q2', point: 'A', score: 5 }, ok: false, earned: 0 }
    ], now));
    out.appended = rec.events.length;
    out.appendOk = rec.events[0].point === 'A' && rec.events[1].correct === false;

    return out;
  });

  console.log(JSON.stringify(r, null, 1));

  const checks = [
    ['BKT 序列与教科书一致', r.bkt[1] > 0.15 && r.bkt[1] < 0.2 && r.bkt[2] > 0.5 && r.bkt[3] > 0.8, r.bkt.join(' → ')],
    ['答错不会归零', r.wrongNotZero],
    ['答对使掌握度上升', r.rightRises],
    ['答错使掌握度下降', r.wrongFalls],
    ['掌握度有上限', r.capped],
    ['连续答对趋近上限', r.after20Right > 0.95, String(r.after20Right)],
    ['答错稳定性减半', r.sAgain === 0.5, String(r.sAgain)],
    ['正常答对稳定性翻倍', r.sGood === 2, String(r.sGood)],
    ['答错难度更高涨得慢', r.sHardD < r.sGood, `${r.sHardD} < ${r.sGood}`],
    ['难度低涨得更快', r.sEasyD > r.sGood, `${r.sEasyD} > ${r.sGood}`],
    ['稳定性有下限', r.sFloor === 0.5, String(r.sFloor)],
    ['难度上限 10', r.dMax === 10, String(r.dMax)],
    ['难度下限 1', r.dMin === 1, String(r.dMin)],
    ['到期日保持率恰好 0.9', Math.abs(r.retAtDue - 0.9) < 0.001, String(r.retAtDue)],
    ['半程保持率高于 0.9', r.retAtHalf > 0.9, String(r.retAtHalf)],
    ['刚复习保持率 1.0', Math.abs(r.retAtZero - 1) < 0.001],
    ['掌握度分级正确', r.levels.join(',') === 'strong,medium,weak,none', r.levels.join(',')],
    ['无数据显示数据不足', r.unknownLevel === 'unknown'],
    ['单条证据不给分', r.oneEventScore === null, String(r.oneEventScore)],
    ['两条证据即给分', r.twoEventsScore === true, 'p=' + r.twoEventsP],
    ['错→对对 掌握度回升', r.mixP > 0.5 && r.mixP < 0.95, String(r.mixP)],
    ['连对 2 次错题毕业', r.mixGraduated === true],
    ['30 天前的记录判定到期', r.overdue === true],
    ['遗忘使保持率衰减', r.retentionDecayed === true],
    ['无记录建议先学', r.nextEmpty === 'learn', r.nextEmpty],
    ['有到期记录建议复习', r.nextReview === 'review', r.nextReview],
    ['无知识点归入综合考核', r.fallbackPoint === '综合考核', r.fallbackPoint],
    ['事件转写正确', r.appended === 2 && r.appendOk]
  ];

  let bad = 0;
  console.log('');
  checks.forEach(([n, ok, extra]) => {
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + n + (extra ? '  ' + extra : ''));
  });
  console.log(`\n通过 ${checks.length - bad} 项，失败 ${bad} 项`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
