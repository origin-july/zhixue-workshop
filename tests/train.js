/* 培训模块回归测试 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (x ? ' — ' + x : ''));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON: ' + m.text().slice(0, 140)); });
  page.on('dialog', d => d.accept());

  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);

  /* ---------- 0. 管理员登录 ---------- */
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);

  /* ---------- 1. 模块切换 ---------- */
  const m0 = await page.evaluate(() => ({
    module: document.body.dataset.module,
    train: document.querySelector('#shellTrain').classList.contains('is-on'),
    learnHidden: getComputedStyle(document.querySelector('#shellLearn')).display === 'none',
    switches: document.querySelectorAll('#mainNav .mn-btn').length,
    builderHidden: getComputedStyle(document.querySelector('#trainBuilder')).display === 'none'
  }));
  check('默认进入培训管理', m0.module === 'manage' && m0.train && m0.learnHidden);
  check('导航两个入口：培训 + 员工库', m0.switches === 2, m0.switches + ' 个');
  check('看板页不占出题栏', m0.builderHidden);

  await page.waitForTimeout(500);
  const m1 = await page.evaluate(() => ({
    module: document.body.dataset.module,
    train: document.querySelector('#shellTrain').classList.contains('is-on'),
    projName: document.querySelector('#thTitle').textContent,
    projects: document.querySelectorAll('#tpList .tp-item').length
  }));
  check('培训模块已就绪', m1.module === 'manage' && m1.train);
  check('项目列表加载', m1.projects === 3, m1.projects + ' 个项目');
  check('头部显示项目名', m1.projName.length > 4, m1.projName);

  /* ---------- 2. 项目切换 ---------- */
  const t0 = await page.textContent('#thTitle');
  await page.locator('#tpList [data-proj]').nth(1).click();
  await page.waitForTimeout(600);
  const t1 = await page.textContent('#thTitle');
  check('切换项目', t0 !== t1, `${t0.slice(0, 12)} → ${t1.slice(0, 12)}`);

  // 切回第一个
  await page.locator('#tpList [data-proj]').nth(0).click();
  await page.waitForTimeout(600);

  /* ---------- 3. 四个标签渲染 ---------- */
  const tabs = ['board', 'material', 'paper', 'assign'];
  const tabLens = {};
  for (const t of tabs) {
    await page.click(`[data-tab="${t}"]`);
    await page.waitForTimeout(420);
    tabLens[t] = await page.evaluate(() => document.querySelector('#trainBody').innerHTML.length);
  }
  check('四个标签都有内容', tabs.every(t => tabLens[t] > 300),
    tabs.map(t => t + ':' + tabLens[t]).join(' '));

  /* ---------- 4. 看板 ---------- */
  await page.click('[data-tab="board"]');
  await page.waitForTimeout(400);
  const ov = await page.evaluate(() => ({
    sum: !!document.querySelector('#trainBody .bd-sum'),
    track: !!document.querySelector('#trainBody .bd-track'),
    todoTab: (document.querySelector('#trainBody [data-bt="todo"]') || {}).textContent,
    rows: document.querySelectorAll('#trainBody .bd-table tbody tr').length,
    dist: document.querySelectorAll('#trainBody .bdd-col').length,
    qs: document.querySelectorAll('#trainBody .bdq-row').length,
    oldCards: document.querySelectorAll('#trainBody .ov-card').length
  }));
  check('看板有进度摘要行', ov.sum && ov.track);
  check('看板有待处理筛选', /待处理/.test(ov.todoTab || ''), ov.todoTab);
  check('看板有全员名单', ov.rows === 14, ov.rows + ' 行');
  check('分数分布按及格线分段', ov.dist === 3, ov.dist + ' 段');
  check('逐题正确率来自真实答题', ov.qs > 0, ov.qs + ' 题');
  check('看板不再堆 KPI 卡', ov.oldCards === 0);

  /* ---------- 5. 材料上传 ---------- */
  await page.click('[data-tab="material"]');
  await page.waitForTimeout(400);
  const mBefore = await page.evaluate(() => document.querySelectorAll('#trainBody .mat-item').length);
  check('材料列表渲染', mBefore === 3, mBefore + ' 份');

  const tmp = path.join(__dirname, 'out', '信息安全.txt');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, '信息安全管理制度。员工不得将公司内部资料上传至个人网盘。涉及客户信息的文件须加密存储，密码长度不少于 12 位，每 90 天更换一次。离开工位必须锁屏。发现账号异常登录应在 2 小时内报告。', 'utf8');
  await page.setInputFiles('#matFileInput', tmp);
  await page.waitForTimeout(800);
  const mAfter = await page.evaluate(() => document.querySelectorAll('#trainBody .mat-item').length);
  check('上传材料', mAfter === mBefore + 1, `${mBefore} → ${mAfter}`);

  /* ---------- 6. 出题（出题助手只在试卷页出现） ---------- */
  await page.click('[data-tab="paper"]');
  await page.waitForTimeout(500);
  await page.click('#trainSrcTabs [data-src="paste"]');
  await page.waitForTimeout(300);
  await page.fill('#trainPaste',
    '信息安全管理制度。员工不得将公司内部资料上传至个人网盘，不得使用未经审批的第三方协作工具。涉及客户信息的文件须加密存储，密码长度不少于 12 位，且每 90 天更换一次。离开工位时必须锁定电脑屏幕，锁屏快捷键为 Win+L。发现账号异常登录的，应在 2 小时内向信息安全部门报告。外部人员来访须由接待人全程陪同，不得单独留在办公区域。访客证当日有效，离场时须交回前台。违反上述规定造成数据泄露的，按公司制度处理。');
  await page.waitForTimeout(500);
  const pasteChars = Number(await page.textContent('#trainPasteChars'));
  check('粘贴字数统计', pasteChars > 150, pasteChars + ' 字');

  await page.click('#trainBtnGen');
  await page.waitForSelector('#trainQWrap:not(.hidden)', { timeout: 45000 });
  await page.waitForTimeout(1400);
  const gen = await page.evaluate(() => ({
    count: Number(document.querySelector('#trainQCount').textContent),
    cards: document.querySelectorAll('#trainQList .qcard').length,
    score: document.querySelector('#trainFootScore').textContent
  }));
  check('培训模块出题', gen.count > 0 && gen.cards === gen.count, `${gen.count} 题 / ${gen.score} 分`);

  /* ---------- 7. 试卷标签同步 ---------- */
  await page.click('[data-tab="paper"]');
  await page.waitForTimeout(500);
  const paper = await page.evaluate(() => ({
    bar: !!document.querySelector('#trainBody .paper-bar'),
    qcard: document.querySelectorAll('#trainBody .qe-item').length,
    builderShown: getComputedStyle(document.querySelector('#trainBuilder')).display !== 'none',
    cols: getComputedStyle(document.querySelector('#shellTrain')).gridTemplateColumns.split(' ').length
  }));
  check('试卷页同步题目', paper.qcard === gen.count, paper.qcard + ' 题');
  check('试卷页才出现出题助手', paper.builderShown && paper.cols === 3, paper.cols + ' 栏');

  /* ---------- 8. 分派选人 ---------- */
  await page.click('[data-tab="assign"]');
  await page.waitForTimeout(450);
  const dist = await page.evaluate(() => ({
    persons: document.querySelectorAll('[data-person]').length,
    on: document.querySelectorAll('[data-person].is-on').length,
    depts: document.querySelectorAll('[data-dept]').length
  }));
  check('分派页按部门分组', dist.depts >= 3, dist.depts + ' 个部门');
  check('受训人员列表', dist.persons === 16, dist.persons + ' 人可选');
  check('已有选中人员', dist.on > 0, dist.on + ' 人已选');

  await page.locator('[data-person]').first().click();
  await page.waitForTimeout(350);
  const dist2 = await page.evaluate(() => document.querySelectorAll('[data-person].is-on').length);
  check('可增删受训人员', dist2 === dist.on - 1, `${dist.on} → ${dist2}`);

  await page.click('[data-pick="all"]');
  await page.waitForTimeout(350);
  const dist3 = await page.evaluate(() => document.querySelectorAll('[data-person].is-on').length);
  check('全选受训人员', dist3 === 16, dist3 + ' 人');

  /* ---------- 9. 分派页的通知（原本独立一页） ---------- */
  await page.waitForTimeout(300);
  const mail = await page.evaluate(() => ({
    rules: document.querySelectorAll('[data-rule]').length,
    subject: document.querySelector('#mailSubject').value,
    body: document.querySelector('#mailBody').value.length,
    preview: !!document.querySelector('.mail-preview'),
    vars: document.querySelectorAll('[data-var]').length,
    aud: document.querySelectorAll('[data-aud]').length,
    sendBtn: !!document.querySelector('#btnSendMail'),
    log: !!document.querySelector('.asg-log')
  }));
  check('选人与通知在同一页', mail.sendBtn && mail.log);
  check('提醒规则列表', mail.rules === 5, mail.rules + ' 条规则');
  check('邮件模板可编辑', mail.subject.length > 5 && mail.body > 60);
  check('变量插入按钮', mail.vars >= 15, mail.vars + ' 个变量');
  check('收件人筛选', mail.aud === 3);
  check('预览默认折叠', mail.preview && !(await page.locator('.asge-pv[open]').count()));

  // 改主题 → 预览联动
  await page.fill('#mailSubject', '【改过】{{培训名称}} 截止 {{截止时间}}');
  await page.waitForTimeout(500);
  const pvHead = await page.textContent('.mp-head');
  check('改主题预览同步', pvHead.indexOf('【改过】') >= 0, pvHead.slice(0, 40));

  // 切换收件人筛选
  await page.locator('[data-aud="all"]').click();
  await page.waitForTimeout(400);
  const sendAll = await page.textContent('#btnSendMail');
  await page.locator('[data-aud="undone"]').click();
  await page.waitForTimeout(400);
  const sendUndone = await page.textContent('#btnSendMail');
  check('筛选改变收件人数', sendAll !== sendUndone, `${sendAll} vs ${sendUndone}`);

  // 发送
  const logBefore = await page.evaluate(() => document.querySelectorAll('.asgl-row').length);
  await page.click('#btnSendMail');
  await page.waitForTimeout(800);
  const logAfter = await page.evaluate(() => document.querySelectorAll('.asgl-row').length);
  check('发送邮件生成记录', logAfter === logBefore + 1, `${logBefore} → ${logAfter}`);

  // 导出 eml
  const dl1 = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#btnExportEml');
  const d1 = await dl1;
  const emlPath = path.join(__dirname, 'out', d1.suggestedFilename());
  await d1.saveAs(emlPath);
  const eml = fs.readFileSync(emlPath, 'utf8');
  check('导出 .eml 邮件', fs.existsSync(emlPath) && eml.indexOf('Subject:') >= 0 && eml.indexOf('Content-Type: text/plain') >= 0,
    (fs.statSync(emlPath).size / 1024).toFixed(1) + ' KB');

  // 导出名单
  const dl2 = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#btnExportMailList');
  const d2 = await dl2;
  const listPath = path.join(__dirname, 'out', d2.suggestedFilename());
  await d2.saveAs(listPath);
  const csv = fs.readFileSync(listPath, 'utf8');
  check('导出收件人名单', csv.indexOf('姓名') >= 0 && csv.indexOf('邮箱') >= 0, d2.suggestedFilename());

  /* ---------- 10. 看板里的明细与导出 ---------- */
  await page.click('[data-tab="board"]');
  await page.waitForTimeout(500);
  const data = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    return {
      rows: document.querySelectorAll('#trainBody .bd-table tbody tr').length,
      people: p.people.length,
      firstStatus: (document.querySelector('#trainBody .bd-table tbody tr .bd-st') || {}).textContent
    };
  });
  check('人员明细覆盖全部参训人', data.rows === data.people, data.rows + ' 行 / ' + data.people + ' 人');
  check('明细首行是已完成', data.firstStatus === '已完成', data.firstStatus);

  // 待处理筛选
  await page.click('#trainBody [data-bt="todo"]');
  await page.waitForTimeout(500);
  const todoRows = await page.evaluate(() => ({
    rows: document.querySelectorAll('#trainBody .bd-table tbody tr').length,
    active: (document.querySelector('#trainBody .bt-tab.is-on') || {}).textContent
  }));
  check('待处理筛选只留没交卷的人', todoRows.rows > 0 && todoRows.rows < data.rows,
    todoRows.rows + ' / ' + data.rows);
  await page.click('#trainBody [data-bt="all"]');
  await page.waitForTimeout(400);

  // 导出 CSV
  const dl3 = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#btnExportCsv');
  const d3 = await dl3;
  const csvPath = path.join(__dirname, 'out', d3.suggestedFilename());
  await d3.saveAs(csvPath);
  const dataCsv = fs.readFileSync(csvPath, 'utf8');
  check('导出数据 CSV', dataCsv.indexOf('得分') >= 0, d3.suggestedFilename());

  /* ---------- 11. 学员答题（换学员账号登录） ---------- */
  await page.evaluate(() => window.Auth.logout());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('#loginUser', 'chensiyuan');
  await page.fill('#loginPass', 'train2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1300);
  const pv1 = await page.evaluate(() => ({
    mod: document.body.dataset.module,
    hero: !!document.querySelector('#learnHost .lw-hero')
  }));
  check('学员登录进入我的学习', pv1.mod === 'learn' && pv1.hero);

  await page.locator('#learnHost .lw-row').first().click();
  await page.waitForTimeout(800);
  await page.click('#learnHost .lwcn-item.is-exam');
  await page.waitForTimeout(600);
  await page.click('#learnHost [data-start]');
  await page.waitForTimeout(900);
  const ex = await page.evaluate(() => ({
    on: !!document.querySelector('#learnHost .lx'),
    clock: (document.querySelector('#learnHost .lx-clock') || {}).textContent,
    dots: document.querySelectorAll('#learnHost .lx-dot').length,
    progress: (document.querySelector('#learnHost .lx-prog') || {}).textContent,
    submitTop: !!document.querySelector('.lx-top .lx-submit')
  }));
  check('答题端打开', ex.on);
  check('倒计时启动', /^\d{2}:\d{2}$/.test(ex.clock), ex.clock);
  check('题号导航题数正确', ex.dots === gen.count, ex.dots + ' 格 · ' + (ex.progress || ''));
  check('交卷按钮在答题区右上', ex.submitTop);

  // 用正确答案作答（从题目数据里取）
  const answers = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    return p.questions.map(q => ({ id: q.id, type: q.type, answer: q.answer }));
  });

  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (a.type === 'single' || a.type === 'multi') {
      const keys = Array.isArray(a.answer) ? a.answer : [a.answer];
      for (const k of keys) {
        const sel = `#learnHost .lx-opt[data-opt="${k}"]`;
        if (await page.locator(sel).count()) { await page.locator(sel).click(); await page.waitForTimeout(120); }
      }
    } else if (a.type === 'judge') {
      await page.locator(`#learnHost [data-judge="${a.answer}"]`).click();
      await page.waitForTimeout(120);
    } else if (a.type === 'blank') {
      await page.fill('#lxBlank', String(a.answer));
      await page.waitForTimeout(120);
    } else {
      await page.fill('#lxEssay', String(a.answer).replace(/\n/g, '，'));
      await page.waitForTimeout(120);
    }
    if (i < answers.length - 1) { await page.click('#learnHost [data-nav="next"]'); await page.waitForTimeout(220); }
  }

  // 补答：逐个检查答题卡，未答的再选一次
  for (let pass = 0; pass < 2; pass++) {
    const missing = await page.evaluate(() => {
      const dots = [...document.querySelectorAll('#learnHost .lx-dot')];
      return dots.map((d, i) => ({ i, done: d.classList.contains('is-done') || d.classList.contains('is-flag') }))
                 .filter(x => !x.done).map(x => x.i);
    });
    if (!missing.length) break;
    for (const idx of missing) {
      await page.locator(`#learnHost .lx-dot[data-jump="${idx}"]`).click();
      await page.waitForTimeout(220);
      const a = answers[idx];
      if (a.type === 'single' || a.type === 'multi') {
        const keys = Array.isArray(a.answer) ? a.answer : [a.answer];
        for (const k of keys) {
          const sel = `#learnHost .lx-opt[data-opt="${k}"]`;
          if (await page.locator(sel).count()) { await page.locator(sel).click(); await page.waitForTimeout(120); }
        }
      } else if (a.type === 'judge') {
        await page.locator(`#learnHost [data-judge="${a.answer}"]`).click();
        await page.waitForTimeout(150);
      } else if (a.type === 'blank') {
        await page.fill('#lxBlank', String(a.answer));
        await page.waitForTimeout(150);
      } else {
        await page.fill('#lxEssay', String(a.answer).replace(/\n/g, '，'));
        await page.waitForTimeout(150);
      }
    }
  }

  const answered = await page.evaluate(() => ({
    done: document.querySelectorAll('#learnHost .lx-dot.is-done').length,
    total: document.querySelectorAll('#learnHost .lx-dot').length
  }));
  check('全部题目已答', answered.done === answered.total, `${answered.done}/${answered.total}`);

  // 标记待定
  await page.click('#learnHost [data-flag]');
  await page.waitForTimeout(300);
  const flagOn = await page.evaluate(() => document.querySelectorAll('#learnHost .lx-dot.is-flag').length);
  check('可标记待定', flagOn === 1);
  await page.click('#learnHost [data-flag]');
  await page.waitForTimeout(250);

  // 交卷（预览模式不写数据）
  await page.click('#learnHost [data-submit]');
  await page.waitForSelector('#learnHost .lr-hero', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const res = await page.evaluate(() => ({
    open: !!document.querySelector('#learnHost .lr-hero'),
    score: (document.querySelector('#learnHost .lr-score') || {}).textContent.replace(/\s/g, ''),
    badge: (document.querySelector('#learnHost .lr-badge') || {}).textContent.trim(),
    rows: document.querySelectorAll('#learnHost .lr-item').length,
    okRows: document.querySelectorAll('#learnHost .lr-item.ok').length,
    exit: true
  }));
  check('交卷出成绩', res.open && res.rows === gen.count, res.score);
  check('成绩判定正确', res.okRows === gen.count && res.badge.indexOf('通过') >= 0 && res.badge.indexOf('未') < 0,
    `${res.okRows}/${res.rows} 正确 · ${res.badge}`);
  check('真实作答不标预览', !(await page.evaluate(() => !!document.querySelector('#learnHost .lr-preview'))));

  /* ---------- 12. 回到管理员，看板显示这位学员已交卷 ---------- */
  await page.evaluate(() => window.Auth.logout());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1300);
  const backBoard = await page.evaluate(() => ({
    mod: document.body.dataset.module,
    rows: document.querySelectorAll('#trainBody .bd-table tbody tr').length,
    done: document.querySelectorAll('#trainBody .bd-st.is-done').length,
    sum: (document.querySelector('#trainBody .bds-n') || {}).textContent
  }));
  check('回到管理端看板', backBoard.mod === 'manage' && backBoard.rows > 0, backBoard.sum);
  check('学员交卷写进成绩', backBoard.done > 0, backBoard.done + ' 人已完成 / ' + backBoard.rows + ' 人');

  /* ---------- 13. 头部「分派」按钮跳到分派页 ---------- */
  const logBeforePub = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    return (p.mailLog || []).length;
  });
  await page.click('#btnPublish');
  await page.waitForTimeout(800);
  const pub = await page.evaluate(() => ({
    tab: document.querySelector('.ttab.is-on').dataset.tab,
    hasSend: !!document.querySelector('#btnSendMail'),
    logCount: (() => {
      const S = window.App.state;
      const p = S.projects.find(x => x.id === S.activeProjectId);
      return (p.mailLog || []).length;
    })()
  }));
  check('头部「分派」跳到分派页', pub.tab === 'assign' && pub.hasSend, pub.tab);
  check('只是跳转，不擅自发信', pub.logCount === logBeforePub, pub.logCount + ' 条记录');

  /* ---------- 14. 新建项目 ---------- */
  const pjBefore = await page.evaluate(() => document.querySelectorAll('#tpList .tp-item').length);
  await page.click('#btnNewProject');
  await page.waitForTimeout(500);
  check('新建弹窗打开', (await page.locator('#newProjectModal.is-on').count()) === 1);
  await page.fill('#npTitle', '回归测试用培训项目');
  await page.fill('#npDesc', '这是一条测试数据');
  await page.fill('#npDept', '测试部门');
  await page.click('#npCreate');
  await page.waitForTimeout(900);
  const pjAfter = await page.evaluate(() => ({
    count: document.querySelectorAll('#tpList .tp-item').length,
    title: document.querySelector('#thTitle').textContent,
    status: (document.querySelector('#thTags .tpi-st') || {}).textContent
  }));
  check('创建培训项目', pjAfter.count === pjBefore + 1, `${pjBefore} → ${pjAfter.count}`);
  check('新项目自动选中', pjAfter.title === '回归测试用培训项目', pjAfter.status);

  /* ---------- 14b. 新项目落在看板的准备清单 ---------- */
  const emptyB = await page.evaluate(() => ({
    tab: document.querySelector('.ttab.is-on').dataset.tab,
    empty: !!document.querySelector('.bd-empty'),
    steps: document.querySelectorAll('.bde-row').length,
    gotos: document.querySelectorAll('[data-goto]').length
  }));
  check('新项目落在看板', emptyB.tab === 'board', emptyB.tab);
  check('没分派时给出准备清单', emptyB.empty && emptyB.steps === 3, emptyB.steps + ' 步');
  check('每步都能跳过去', emptyB.gotos === 3);

  await page.locator('[data-goto="assign"]').click();
  await page.waitForTimeout(500);
  check('清单能跳到分派页', await page.evaluate(() =>
    document.querySelector('.ttab.is-on').dataset.tab === 'assign'));

  /* ---------- 15. 刷新恢复 ---------- */
  const savedProjects = await page.evaluate(() => document.querySelectorAll('#tpList .tp-item').length);
  await page.reload();
  await page.waitForTimeout(1000);
  const restored = await page.evaluate(() => ({
    module: document.body.dataset.module,
    projects: document.querySelectorAll('#tpList .tp-item').length,
    title: (document.querySelector('#thTitle') || {}).textContent
  }));
  check('刷新恢复模块状态', restored.module === 'manage');
  check('刷新恢复培训数据', restored.projects === savedProjects, `${restored.projects} 个项目`);
  check('刷新恢复当前项目', restored.title === '回归测试用培训项目', restored.title);

  /* ---------- 16. 员工库入口 ---------- */
  await page.click('#mainNav [data-module="staff"]');
  await page.waitForTimeout(900);
  const learn = await page.evaluate(() => ({
    on: document.querySelector('#shellStaff').classList.contains('is-on'),
    trainOff: getComputedStyle(document.querySelector('#shellTrain')).display === 'none',
    rows: document.querySelectorAll('.staff-table tbody tr').length,
    learnOff: getComputedStyle(document.querySelector('#shellLearn')).display === 'none',
    noPicker: !document.querySelector('.pvp')
  }));
  check('切到员工库', learn.on && learn.trainOff && learn.learnOff);
  check('员工库列出全部员工', learn.rows >= 16, learn.rows + ' 人');
  check('没有学员视角入口', learn.noPicker);

  await page.click('#mainNav [data-module="manage"]');
  await page.waitForTimeout(700);
  const backManage = await page.evaluate(() => ({
    on: document.querySelector('#shellTrain').classList.contains('is-on'),
    staffOff: getComputedStyle(document.querySelector('#shellStaff')).display === 'none'
  }));
  check('切回培训', backManage.on && backManage.staffOff);


  console.log('\n错误:', errs.length ? errs.slice(0, 6).join('\n') : '无');
  console.log(`\n通过 ${ok.length} 项，失败 ${bad.length} 项`);
  if (bad.length) bad.forEach(b => console.log('  ✗ ' + b));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
