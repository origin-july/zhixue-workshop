/* 学员中心全流程：学习台 → 学习页 → 阅读 → 考试 → 成绩 → 掌握度 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/pdf|Failed to load/i.test(m.text())) errs.push('CON: ' + m.text().slice(0, 140)); });
  page.on('dialog', d => d.accept());

  const ok = [], bad = [];
  const check = (n, c, x) => (c ? ok : bad).push(n + (x ? ' — ' + x : ''));

  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  await page.fill('#loginUser', 'chensiyuan');
  await page.fill('#loginPass', 'train2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1300);

  /* ---------- 1. 学习台 ---------- */
  const h1 = await page.evaluate(() => ({
    hero: !!document.querySelector('.lw-hero'),
    hi: (document.querySelector('.lw-hi') || {}).textContent || '',
    focus: !!document.querySelector('.lw-focus'),
    focusTag: (document.querySelector('.lwf-tag') || {}).textContent || '',
    focusAct: (document.querySelector('.lwf-act') || {}).textContent || '',
    ring: !!document.querySelector('.lw-ring'),
    rows: document.querySelectorAll('.lw-row').length,
    masteryRows: document.querySelectorAll('.lw-mrow').length
  }));
  check('学习台有问候', h1.hero && h1.hi.length > 2, h1.hi);
  check('继续学习卡', h1.focus && !!h1.focusTag, h1.focusTag);
  check('给出下一步动作', h1.focusAct.indexOf('·') > 0, h1.focusAct);
  check('进度环渲染', h1.ring);
  check('培训列表', h1.rows >= 1, h1.rows + ' 个');
  check('掌握度面板', h1.masteryRows >= 3, h1.masteryRows + ' 个知识点');

  /* ---------- 2. 进入学习页 ---------- */
  await page.click('.lw-focus');
  await page.waitForTimeout(900);
  const c1 = await page.evaluate(() => ({
    nav: document.querySelectorAll('.lwcn-item').length,
    mats: document.querySelectorAll('.lwcn-item:not(.is-exam)').length,
    exam: document.querySelectorAll('.lwcn-item.is-exam').length,
    title: (document.querySelector('.lwc-title') || {}).textContent,
    content: !!document.querySelector('.lwm'),
    matTitle: (document.querySelector('.lwm-title') || {}).textContent,
    body: ((document.querySelector('.lmp-sheet') || {}).textContent || '').slice(0, 20)
  }));
  check('学习页三栏布局', c1.nav >= 2 && c1.content, c1.mats + ' 材料 + ' + c1.exam + ' 考核');
  check('默认落到材料小节', !!c1.matTitle, c1.matTitle);
  check('材料正文已渲染', c1.body.length > 10, c1.body);

  /* ---------- 3. 小节切换与进度 ---------- */
  const before = await page.evaluate(() => ({
    pct: (document.querySelector('.lwc-pct') || {}).textContent,
    done: document.querySelectorAll('.lwcn-item.is-done').length
  }));
  const unreadSec = page.locator('.lwcn-item:not(.is-done):not(.is-exam)').first();
  if (await unreadSec.count()) {
    await unreadSec.click();
    await page.waitForTimeout(600);
    await page.click('[data-read]');
    await page.waitForTimeout(700);
  }
  const after = await page.evaluate(() => ({
    pct: (document.querySelector('.lwc-pct') || {}).textContent,
    done: document.querySelectorAll('.lwcn-item.is-done').length,
    total: document.querySelectorAll('.lwcn-item').length
  }));
  const allRead = before.done === after.total;
  check('标记已读推进进度', allRead ? after.pct === '100%' : after.done > before.done,
    allRead ? '本来就全读完，进度 ' + after.pct : `${before.done} → ${after.done} 个`);

  /* ---------- 4. 考试 ---------- */
  await page.click('.lwcn-item.is-exam');
  await page.waitForTimeout(700);
  const e0 = await page.evaluate(() => ({
    card: !!document.querySelector('.lwe-card'),
    cells: document.querySelectorAll('.lwe-cell').length,
    start: !!document.querySelector('.lwe-start'),
    mastery: document.querySelectorAll('.lwe-mastery .lw-mrow').length
  }));
  check('考核小节有入口卡', e0.card && e0.cells === 4 && e0.start);
  check('已考过显示掌握度', e0.mastery === 0 || e0.mastery >= 3, e0.mastery + ' 行（首次为空）');

  await page.click('.lwe-start');
  await page.waitForTimeout(900);
  const e1 = await page.evaluate(() => ({
    strip: document.querySelectorAll('.lx-dot').length,
    clock: (document.querySelector('#lxClock') || {}).textContent,
    stem: (document.querySelector('.lx-stem') || {}).textContent,
    type: (document.querySelector('.lx-qtype') || {}).textContent,
    point: (document.querySelector('.lx-qpoint') || {}).textContent,
    foot: !!document.querySelector('.lx-foot'),
    submitAlways: !!document.querySelector('.lx-submit')
  }));
  check('题号导航条', e1.strip === 9, e1.strip + ' 格');
  check('倒计时启动', /^\d{2}:\d{2}$/.test(e1.clock), e1.clock);
  check('题型与知识点标注', !!e1.type && !!e1.point, e1.type + ' · ' + e1.point);
  check('交卷按钮常驻', e1.submitAlways);

  /* 标记待定 */
  await page.click('[data-flag]');
  await page.waitForTimeout(400);
  check('标记待定', await page.evaluate(() => document.querySelectorAll('.lx-dot.is-flag').length === 1));
  await page.click('[data-flag]');
  await page.waitForTimeout(300);

  /* 逐题答对 */
  const answers = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    return p.questions.map(q => ({ type: q.type, answer: q.answer }));
  });
  const order = ['single', 'multi', 'judge', 'blank', 'essay'];
  const sorted = answers.slice().sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (a.type === 'single' || a.type === 'multi') {
      const keys = Array.isArray(a.answer) ? a.answer : [a.answer];
      for (const k of keys) {
        const sel = `.lx-opt[data-opt="${k}"]`;
        if (await page.locator(sel).count()) { await page.locator(sel).click(); await page.waitForTimeout(110); }
      }
    } else if (a.type === 'judge') {
      await page.locator(`[data-judge="${a.answer}"]`).click();
      await page.waitForTimeout(110);
    } else if (a.type === 'blank') {
      await page.fill('#lxBlank', String(a.answer));
      await page.waitForTimeout(110);
    } else {
      await page.fill('#lxEssay', String(a.answer).replace(/\n/g, '，'));
      await page.waitForTimeout(110);
    }
    if (i < sorted.length - 1) { await page.click('[data-nav="next"]'); await page.waitForTimeout(200); }
  }

  const answeredCount = await page.evaluate(() => ({
    done: document.querySelectorAll('.lx-dot.is-done').length,
    prog: (document.querySelector('.lx-prog') || {}).textContent
  }));
  check('逐题作答记录', answeredCount.done === sorted.length, answeredCount.prog);

  /* 点题号跳回第 1 题 */
  await page.click('.lx-dot[data-jump="0"]');
  await page.waitForTimeout(400);
  check('题号可跳转', await page.evaluate(() =>
    /第 1 题/.test((document.querySelector('.lx-qno') || {}).textContent || '')));

  /* ---------- 5. 交卷 ---------- */
  await page.click('[data-submit]');
  await page.waitForSelector('.lr-hero', { timeout: 20000 });
  await page.waitForTimeout(800);

  const r1 = await page.evaluate(() => ({
    score: (document.querySelector('.lr-score') || {}).textContent.replace(/\s/g, ''),
    badge: (document.querySelector('.lr-badge') || {}).textContent,
    stats: [...document.querySelectorAll('.lr-stat b')].map(e => e.textContent),
    masteryRows: document.querySelectorAll('.lw-mrow').length,
    next: (document.querySelector('.lr-next-d') || {}).textContent,
    items: document.querySelectorAll('.lr-item').length,
    okItems: document.querySelectorAll('.lr-item.ok').length
  }));
  check('成绩页显示分数', !!r1.score, r1.score);
  check('全对通过', r1.badge.indexOf('通过') >= 0 && r1.badge.indexOf('未') < 0, r1.badge);
  check('成绩统计四项', r1.stats.length === 4, r1.stats.join(' / '));
  check('逐题回顾', r1.items === sorted.length && r1.okItems === sorted.length,
    `${r1.okItems}/${r1.items} 正确`);
  check('成绩页有掌握度', r1.masteryRows >= 3, r1.masteryRows + ' 个知识点');
  check('给出下一步建议', !!r1.next, (r1.next || '').slice(0, 30));

  /* ---------- 6. 掌握度是否真的上涨 ---------- */
  const mastery = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lw-mrow')];
    const avgTxt = (document.querySelector('.lw-avg') || {}).textContent || '';
    return {
      points: rows.length,
      strong: rows.filter(r => r.querySelector('.lw-mlv.lv-strong')).length,
      weak: rows.filter(r => r.querySelector('.lw-mlv.lv-weak, .lw-mlv.lv-none')).length,
      avg: avgTxt
    };
  });
  check('掌握度覆盖多个知识点', mastery.points >= 3, mastery.points + ' 个');
  check('答对后出现熟练知识点', mastery.strong >= 1,
    mastery.strong + ' 个熟练 · ' + mastery.avg);

  /* ---------- 7. 返回导航 ---------- */
  await page.click('[data-back-course]');
  await page.waitForTimeout(600);
  check('回到培训', await page.evaluate(() => !!document.querySelector('.lwc-top')));

  await page.click('[data-home]');
  await page.waitForTimeout(600);
  const home2 = await page.evaluate(() => ({
    home: !!document.querySelector('.lw-hero'),
    focusTag: (document.querySelector('.lwf-tag') || {}).textContent,
    rows: document.querySelectorAll('.lw-row').length,
    rowMeta: (document.querySelector('.lwr-meta') || {}).textContent
  }));
  check('回到学习台', home2.home);
  check('已完成后提示变化', home2.focusTag.indexOf('复习') >= 0, home2.focusTag);
  check('列表显示分数', (home2.rowMeta || '').indexOf('分') > 0, home2.rowMeta);

  /* ---------- 8. 错题路径 ---------- */
  await page.locator('.lw-row').first().click();
  await page.waitForTimeout(800);
  await page.click('.lwcn-item.is-exam');
  await page.waitForTimeout(600);
  await page.click('.lwe-start');
  await page.waitForTimeout(800);

  // 全部答错：单选选第一个非答案的，判断题反着选
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (a.type === 'single' || a.type === 'multi') {
      const wrong = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.lx-opt')][0];
        return btn ? btn.dataset.opt : null;
      });
      if (wrong) { await page.locator(`.lx-opt[data-opt="${wrong}"]`).click(); await page.waitForTimeout(100); }
      if (a.type === 'multi') {
        const b = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('.lx-opt')][1];
          return btn ? btn.dataset.opt : null;
        });
        if (b) { await page.locator(`.lx-opt[data-opt="${b}"]`).click(); await page.waitForTimeout(100); }
      }
    } else if (a.type === 'judge') {
      const wrong = a.answer === '正确' ? '错误' : '正确';
      await page.locator(`[data-judge="${wrong}"]`).click();
      await page.waitForTimeout(100);
    } else if (a.type === 'blank') {
      await page.fill('#lxBlank', '不知道');
      await page.waitForTimeout(100);
    } else {
      await page.fill('#lxEssay', '不会');
      await page.waitForTimeout(100);
    }
    if (i < sorted.length - 1) { await page.click('[data-nav="next"]'); await page.waitForTimeout(180); }
  }

  await page.click('[data-submit]');
  await page.waitForSelector('.lr-hero', { timeout: 20000 });
  await page.waitForTimeout(800);

  const r2 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lw-mrow')];
    return {
      score: (document.querySelector('.lr-score') || {}).textContent.replace(/\s/g, ''),
      badge: (document.querySelector('.lr-badge') || {}).textContent,
      noItems: document.querySelectorAll('.lr-item.no').length,
      weak: rows.filter(r => r.querySelector('.lw-mlv.lv-weak, .lw-mlv.lv-none')).length,
      due: rows.filter(r => r.querySelector('.lw-mdue') && r.querySelector('.lw-mdue').textContent.trim()).length,
      avg: (document.querySelector('.lw-avg') || {}).textContent
    };
  });
  check('答错后分数下降', r2.badge.indexOf('未') >= 0, r2.score + ' · ' + r2.badge);
  check('错题逐条标出', r2.noItems === sorted.length, r2.noItems + ' 题错');
  check('掌握度相应下降', r2.weak >= 1, r2.weak + ' 个待加强 · ' + r2.avg);
  // 答错后稳定性减半，复习时间排到 12 小时内，还没「到期」但会被列为弱项
  const advice = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    const ls = window.Student.current();
    const rec = p.records.find(x => x.pid === ls.personId);
    const act = window.Learning.nextAction(rec || {}, Date.now());
    return { type: act.type, title: act.title, next: (document.querySelector('.lr-next-d') || {}).textContent };
  });
  check('建议下一步去复习', advice.type === 'review' && (advice.next || '').length > 4,
    advice.title);
  check('真实作答写进记录', await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    const pid = window.Student.current().personId;
    const rec = p.records.find(r => r.pid === pid);
    return !!(rec && rec.events && rec.events.length > 9);
  }), '作答事件已追加');

  /* ---------- 9. 刷新后仍保持登录 ---------- */
  await page.reload();
  await page.waitForTimeout(1200);

  const stu = await page.evaluate(() => ({
    module: document.body.dataset.module,
    on: document.querySelector('#shellLearn').classList.contains('is-on'),
    nav: getComputedStyle(document.querySelector('#mainNav')).display,
    picker: !!document.querySelector('.pvp'),
    who: (document.querySelector('#lwName') || {}).textContent,
    rows: document.querySelectorAll('.lw-row').length
  }));
  check('学员只能进我的学习', stu.module === 'learn' && stu.on);
  check('学员看不到管理导航', stu.nav === 'none');
  check('学员端没有身份选择页', !stu.picker);
  check('学员看到自己的数据', stu.rows >= 1, stu.who + ' · ' + stu.rows + ' 个培训');

  /* 学员答题写入真实记录 */
  await page.locator('.lw-row').first().click();
  await page.waitForTimeout(800);
  await page.click('.lwcn-item.is-exam');
  await page.waitForTimeout(600);
  await page.click('.lwe-start');
  await page.waitForTimeout(800);
  await page.click('[data-submit]');
  await page.waitForSelector('.lr-hero', { timeout: 20000 });
  await page.waitForTimeout(700);
  const real = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    const me = window.Auth.current();
    const rec = p.records.find(r => r.pid === me.personId);
    return {
      tries: rec.tries,
      preview: !!document.querySelector('.lr-preview'),
      events: rec.events ? rec.events.length : 0
    };
  });
  check('学员交卷计入次数', real.tries >= 1, real.tries + ' 次');
  check('学员成绩不标预览', !real.preview);
  check('学员作答写入事件', real.events >= 9, real.events + ' 条');

  console.log('\n错误:', errs.length ? errs.slice(0, 6).join('\n') : '无');
  check('无运行时错误', errs.length === 0);

  console.log(`\n通过 ${ok.length} 项，失败 ${bad.length} 项`);
  if (bad.length) bad.forEach(b => console.log('  ✗ ' + b));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
