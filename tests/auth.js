/* 登录 / 角色 / 账号 / 同页审查 回归测试 */
const { chromium } = require('playwright');
const path = require('path');

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (x ? ' — ' + x : ''));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => {
    errs.push('PAGE: ' + e.message);
    console.log('>>> STACK:', (e.stack || '').split('\n').slice(0, 5).join(' | '));
  });
  page.on('console', m => { if (m.type() === 'error') errs.push('CON: ' + m.text().slice(0, 140)); });
  page.on('dialog', d => d.accept());

  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);

  /* ---------- 1. 登录门禁 ---------- */
  const g0 = await page.evaluate(() => ({
    loginOn: document.querySelector('#loginScreen').classList.contains('is-on'),
    topbar: getComputedStyle(document.querySelector('.topbar')).display,
    learn: document.querySelector('#shellLearn').classList.contains('is-on'),
    train: document.querySelector('#shellTrain').classList.contains('is-on'),
    hasHint: document.querySelectorAll('.lch-row').length
  }));
  check('未登录时显示登录页', g0.loginOn);
  check('未登录隐藏主界面', g0.topbar === 'none' && !g0.learn && !g0.train);
  check('登录页给出初始账号提示', g0.hasHint === 2, g0.hasHint + ' 组');

  /* ---------- 2. 登录校验 ---------- */
  await page.fill('#loginUser', 'nobody');
  await page.fill('#loginPass', 'whatever');
  await page.click('#loginBtn');
  await page.waitForTimeout(400);
  check('不存在的账号有提示', (await page.textContent('#loginErr')).indexOf('不存在') >= 0,
    await page.textContent('#loginErr'));

  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'badpass');
  await page.click('#loginBtn');
  await page.waitForTimeout(400);
  check('错误密码有提示', (await page.textContent('#loginErr')).indexOf('密码') >= 0,
    await page.textContent('#loginErr'));

  /* ---------- 3. 管理员登录 ---------- */
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);
  const g1 = await page.evaluate(() => ({
    loginOff: !document.querySelector('#loginScreen').classList.contains('is-on'),
    module: document.body.dataset.module,
    trainOn: document.querySelector('#shellTrain').classList.contains('is-on'),
    campusOff: !document.querySelector('#shellLearn').classList.contains('is-on'),
    name: document.querySelector('#userName').textContent,
    role: document.querySelector('#userRole').textContent,
    tabs: document.querySelectorAll('#trainTabs .ttab').length
  }));
  check('管理员登录成功', g1.loginOff && g1.name === '宋知微', g1.name + ' / ' + g1.role);
  check('默认进入培训管理', g1.module === 'manage' && g1.trainOn && g1.campusOff);
  check('管理端四个标签：看板/材料/试卷/分派', g1.tabs === 4, g1.tabs + ' 个标签');

  /* ---------- 4. 管理端主导航 ---------- */
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#mainNav .mn-btn')].map(b => b.dataset.module));
  const orderText = await page.evaluate(() =>
    [...document.querySelectorAll('#mainNav .mn-btn')].map(b => b.textContent.trim()));
  check('管理员只有两个入口：培训 + 员工库',
    order.join(',') === 'manage,staff', orderText.join(' → '));

  /* ---------- 5. 员工库 ---------- */
  await page.click('#mainNav [data-module="staff"]');
  await page.waitForTimeout(900);
  const staffMod = await page.evaluate(() => ({
    on: document.querySelector('#shellStaff').classList.contains('is-on'),
    trainOff: getComputedStyle(document.querySelector('#shellTrain')).display === 'none',
    rows: document.querySelectorAll('.staff-table tbody tr').length,
    meta: document.querySelector('#staffMeta').textContent,
    noLearn: getComputedStyle(document.querySelector('#shellLearn')).display === 'none'
  }));
  check('切到员工库', staffMod.on && staffMod.trainOff && staffMod.noLearn);
  check('员工库列出全部员工', staffMod.rows >= 16, staffMod.rows + ' 人 · ' + staffMod.meta);

  await page.click('#mainNav [data-module="manage"]');
  await page.waitForTimeout(800);
  check('回到培训', await page.evaluate(() =>
    document.querySelector('#shellTrain').classList.contains('is-on')));

  check('管理员没有学员视角入口', await page.evaluate(() =>
    !document.querySelector('#moduleSwitch') && !document.querySelector('#pvBar')));

  /* ---------- 6. 账号管理 ---------- */
  await page.click('#userBtn');
  await page.waitForTimeout(350);
  check('用户菜单可展开', (await page.locator('#userMenu.is-on').count()) === 1);
  await page.click('#umAccounts');
  await page.waitForTimeout(500);

  const acc0 = await page.evaluate(() => ({
    open: document.querySelector('#accountsModal').classList.contains('is-on'),
    rows: document.querySelectorAll('#accBody tr').length,
    sub: document.querySelector('#accSub').textContent
  }));
  check('账号管理打开', acc0.open && acc0.rows === 17, acc0.rows + ' 个账号');
  check('统计摘要正确', acc0.sub.indexOf('1 个管理员') >= 0 && acc0.sub.indexOf('16 个学员') >= 0, acc0.sub);

  // 密码默认隐藏，可点开
  const pwdHidden = await page.evaluate(() => document.querySelectorAll('#accBody .acc-pwd').length);
  await page.locator('#accBody [data-pwd]').first().click();
  await page.waitForTimeout(350);
  const pwdShown = await page.evaluate(() => {
    const cell = document.querySelector('#accBody .acc-pwd');
    return cell ? cell.textContent.indexOf('admin2026') >= 0 : false;
  });
  check('密码默认隐藏', pwdHidden > 0);
  check('点眼睛可查看密码', pwdShown);

  // 筛选
  await page.click('#accFilters [data-af="admin"]');
  await page.waitForTimeout(350);
  check('按管理员筛选', (await page.locator('#accBody tr').count()) === 1);
  await page.click('#accFilters [data-af="all"]');
  await page.waitForTimeout(350);

  // 搜索
  await page.fill('#accSearch', 'chensiyuan');
  await page.waitForTimeout(400);
  check('搜索账号', (await page.locator('#accBody tr').count()) === 1,
    await page.locator('#accBody .acc-name').first().textContent());
  await page.fill('#accSearch', '');
  await page.waitForTimeout(350);

  // 新建账号
  const rowsBefore = await page.locator('#accBody tr').count();
  await page.click('#accAddNew');
  await page.waitForTimeout(400);
  check('新建账号弹窗', (await page.locator('#accEditModal.is-on').count()) === 1);
  await page.fill('#aeName', '测试新人');
  await page.fill('#aeUsername', 'testuser01');
  await page.click('#aeGenPass');
  await page.waitForTimeout(250);
  const genPwd = await page.inputValue('#aePassword');
  check('随机密码生成', genPwd.length === 8, genPwd);
  await page.fill('#aeDept', '测试部');
  await page.click('#aeSave');
  await page.waitForTimeout(600);
  const rowsAfter = await page.locator('#accBody tr').count();
  check('账号创建成功', rowsAfter === rowsBefore + 1, `${rowsBefore} → ${rowsAfter}`);

  // 重复账号应拒绝
  await page.click('#accAddNew');
  await page.waitForTimeout(350);
  await page.fill('#aeName', '重复');
  await page.fill('#aeUsername', 'testuser01');
  await page.fill('#aePassword', 'abcd1234');
  await page.click('#aeSave');
  await page.waitForTimeout(400);
  check('重复账号被拒绝', (await page.textContent('#aeErr')).indexOf('已存在') >= 0,
    await page.textContent('#aeErr'));
  await page.locator('#accEditModal .icon-btn[data-close]').click();
  await page.waitForTimeout(400);

  // 停用账号
  await page.fill('#accSearch', 'chensiyuan');
  await page.waitForTimeout(400);
  await page.locator('#accBody [data-acc="toggle"]').first().click();
  await page.waitForTimeout(450);
  const offState = await page.evaluate(() => {
    const row = document.querySelector('#accBody tr');
    return row ? row.querySelector('.acc-off') !== null : false;
  });
  check('账号可停用', offState);
  // 恢复
  await page.locator('#accBody [data-acc="toggle"]').first().click();
  await page.waitForTimeout(400);
  await page.fill('#accSearch', '');
  await page.waitForTimeout(350);

  // 删除刚建的账号
  await page.fill('#accSearch', 'testuser01');
  await page.waitForTimeout(400);
  await page.locator('#accBody [data-acc="del"]').first().click();
  await page.waitForTimeout(500);
  const afterDel = await page.evaluate(() => document.querySelectorAll('#accBody tr').length);
  check('账号可删除', afterDel <= 1, afterDel + ' 行（应为空态）');
  await page.fill('#accSearch', '');
  await page.waitForTimeout(350);
  await page.locator('#accountsModal [data-close]').first().click();
  await page.waitForTimeout(450);

  /* ---------- 7. 试卷页改题 + 预览答题 ---------- */
  await page.click('[data-tab="paper"]');
  await page.waitForTimeout(900);
  const rv = await page.evaluate(() => ({
    qcards: document.querySelectorAll('#trainBody .qe-item').length,
    builder: getComputedStyle(document.querySelector('#trainBuilder')).display !== 'none',
    rightTitle: document.querySelector('.train-builder .panel-title').textContent.replace(/\s+/g, ' ').trim()
  }));
  check('试卷页列出全部题目', rv.qcards === 9, rv.qcards + ' 题');
  check('试卷页右侧是出题助手', rv.builder && rv.rightTitle.indexOf('考核出题') >= 0, rv.rightTitle);

  // 改题干
  await page.locator('#trainBody .qe-head').first().click();
  await page.waitForTimeout(400);
  await page.locator('#trainBody .qe-item.is-on textarea[data-f="stem"]').fill('【联动测试】这道题被管理员改过吗？');
  await page.waitForTimeout(600);
  const synced = await page.evaluate(() =>
    (document.querySelector('#trainBody .qe-item.is-on .qe-stem') || {}).textContent);
  check('题干修改即时回显', synced.indexOf('【联动测试】') >= 0, synced.slice(0, 26));

  // 改完题，用学员账号登录确认改动生效
  await page.evaluate(() => window.Auth.logout());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('#loginUser', 'chensiyuan');
  await page.fill('#loginPass', 'train2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1300);
  const pv = await page.evaluate(() => ({
    mod: document.body.dataset.module,
    hero: !!document.querySelector('#learnHost .lw-hero'),
    cards: document.querySelectorAll('#learnHost .lw-row').length
  }));
  check('学员登录进入我的学习', pv.mod === 'learn' && pv.hero, pv.cards + ' 个培训卡');

  await page.locator('#learnHost .lw-row').first().click();
  await page.waitForTimeout(800);
  check('学习页有左侧小节导航', await page.evaluate(() =>
    document.querySelectorAll('#learnHost .lwcn-item').length >= 2));

  await page.click('#learnHost .lwcn-item.is-exam');
  await page.waitForTimeout(600);
  await page.click('#learnHost [data-start]');
  await page.waitForTimeout(900);
  const exm = await page.evaluate(() => ({
    exam: !!document.querySelector('#learnHost .lx'),
    stem: (document.querySelector('#learnHost .lx-stem') || {}).textContent,
    timer: (document.querySelector('#learnHost .lx-clock') || {}).textContent,
    strip: !!document.querySelector('#learnHost .lx-strip'),
    submitInTop: !!document.querySelector('.lx-top .lx-submit'),
    prevLeft: (() => {
      const b = document.querySelector('.lx-nav[data-nav="prev"]').getBoundingClientRect();
      return b.left < 200;
    })(),
    nextRight: (() => {
      const n = document.querySelector('.lx-nav.is-next');
      if (!n) return true;
      const b = n.getBoundingClientRect();
      return b.right > innerWidth - 200;
    })()
  }));
  check('学员端可答题', exm.exam, '计时 ' + exm.timer);
  check('改动同步到答题页', exm.stem.indexOf('【联动测试】') >= 0, exm.stem.slice(0, 24));
  check('题号导航条显示', exm.strip);
  check('交卷在右上角', exm.submitInTop);
  check('上一题在左、下一题在右', exm.prevLeft && exm.nextRight);

  await page.locator('#learnHost .lx-opt').first().click();
  await page.waitForTimeout(400);

  await page.click('#learnHost [data-submit]');
  await page.waitForTimeout(1400);
  const res = await page.evaluate(() => ({
    result: !!document.querySelector('#learnHost .lr-hero'),
    preview: !!document.querySelector('#learnHost .lr-preview')
  }));
  check('学员可交卷出分', res.result);
  check('真实作答不标预览', !res.preview);

  /* ---------- 8. 修改密码（回到管理员） ---------- */
  await page.evaluate(() => window.Auth.logout());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1100);

  await page.click('#userBtn');
  await page.waitForTimeout(350);
  await page.click('#umPassword');
  await page.waitForTimeout(450);
  await page.fill('#pwdOld', 'wrongold');
  await page.fill('#pwdNew', 'newpass123');
  await page.fill('#pwdNew2', 'newpass123');
  await page.click('#pwdSave');
  await page.waitForTimeout(400);
  check('旧密码错误被拦截', (await page.textContent('#pwdErr')).indexOf('不正确') >= 0);

  await page.fill('#pwdOld', 'admin2026');
  await page.fill('#pwdNew', 'newpass123');
  await page.fill('#pwdNew2', 'different');
  await page.click('#pwdSave');
  await page.waitForTimeout(400);
  check('两次新密码不一致被拦截', (await page.textContent('#pwdErr')).indexOf('不一致') >= 0);

  await page.fill('#pwdNew2', 'newpass123');
  await page.click('#pwdSave');
  await page.waitForTimeout(600);
  check('密码修改成功', (await page.locator('#pwdModal.is-on').count()) === 0);

  // 用新密码重新登录
  await page.click('#userBtn');
  await page.waitForTimeout(300);
  await page.click('#umLogout');
  await page.waitForTimeout(800);
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'newpass123');
  await page.click('#loginBtn');
  await page.waitForTimeout(900);
  check('新密码可登录', !(await page.evaluate(() =>
    document.querySelector('#loginScreen').classList.contains('is-on'))));

  // 改回原密码
  await page.click('#userBtn');
  await page.waitForTimeout(300);
  await page.click('#umPassword');
  await page.waitForTimeout(400);
  await page.fill('#pwdOld', 'newpass123');
  await page.fill('#pwdNew', 'admin2026');
  await page.fill('#pwdNew2', 'admin2026');
  await page.click('#pwdSave');
  await page.waitForTimeout(500);

  /* ---------- 9. 学员登录与隔离 ---------- */
  await page.click('#userBtn');
  await page.waitForTimeout(300);
  await page.click('#umLogout');
  await page.waitForTimeout(800);
  await page.fill('#loginUser', 'chensiyuan');
  await page.fill('#loginPass', 'train2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);

  const stu = await page.evaluate(() => ({
    module: document.body.dataset.module,
    learn: document.querySelector('#shellLearn').classList.contains('is-on'),
    train: document.querySelector('#shellTrain').classList.contains('is-on'),
    nav: getComputedStyle(document.querySelector('#mainNav')).display,
    picker: !!document.querySelector('.pvp'),
    who: (document.querySelector('#lwName') || {}).textContent,
    cards: document.querySelectorAll('#learnHost .lw-row').length
  }));
  check('学员登录进入我的学习', stu.module === 'learn' && stu.learn);
  check('学员看不到管理界面', !stu.train && stu.nav === 'none');
  check('学员端没有身份选择页', !stu.picker);
  check('学员看到自己的培训', stu.cards >= 1, stu.who + ' · ' + stu.cards + ' 个培训');

  // 学员做题
  await page.locator('#learnHost .lw-row').first().click();
  await page.waitForTimeout(800);
  await page.click('#learnHost .lwcn-item.is-exam');
  await page.waitForTimeout(600);
  await page.click('#learnHost [data-start]');
  await page.waitForTimeout(900);
  const sexam = await page.evaluate(() => ({
    exam: !!document.querySelector('#learnHost .lx'),
    dots: document.querySelectorAll('#learnHost .lx-dot').length,
    timer: (document.querySelector('#learnHost .lx-clock') || {}).textContent
  }));
  check('学员可进入答题', sexam.exam && sexam.dots === 9, sexam.dots + ' 题 · ' + sexam.timer);

  // 全部答对
  const ansList = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    return p.questions.map(q => ({ type: q.type, answer: q.answer }));
  });
  for (let i = 0; i < ansList.length; i++) {
    const a = ansList[i];
    if (a.type === 'single' || a.type === 'multi') {
      const keys = Array.isArray(a.answer) ? a.answer : [a.answer];
      for (const k of keys) {
        const sel = `#learnHost .lx-opt[data-opt="${k}"]`;
        if (await page.locator(sel).count()) { await page.locator(sel).click(); await page.waitForTimeout(100); }
      }
    } else if (a.type === 'judge') {
      await page.locator(`#learnHost [data-judge="${a.answer}"]`).click();
      await page.waitForTimeout(100);
    } else if (a.type === 'blank') {
      await page.fill('#lxBlank', String(a.answer));
      await page.waitForTimeout(100);
    } else {
      await page.fill('#lxEssay', String(a.answer).replace(/\n/g, '，'));
      await page.waitForTimeout(100);
    }
    if (i < ansList.length - 1) { await page.click('#learnHost [data-nav="next"]'); await page.waitForTimeout(200); }
  }

  await page.waitForTimeout(400);
  await page.click('#learnHost [data-submit]');
  await page.waitForSelector('#learnHost .lr-hero', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const sres = await page.evaluate(() => {
    const sc = document.querySelector('#learnHost .lr-score');
    const bd = document.querySelector('#learnHost .lr-badge');
    return {
      result: !!document.querySelector('#learnHost .lr-hero'),
      score: sc ? sc.textContent.replace(/\s/g, '') : '(无)',
      badge: bd ? bd.textContent.trim() : '(无)',
      noPreview: !document.querySelector('#learnHost .lr-preview')
    };
  });
  check('学员交卷出分', sres.result, sres.score);
  check('全对通过考核', sres.badge.indexOf('通过') >= 0 && sres.badge.indexOf('未') < 0, sres.badge);
  check('真实作答不标预览', sres.noPreview);

  // 数据写回
  const written = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    const r = p.records.find(x => x.pid === 'p01');
    return { status: r.status, score: r.score };
  });
  check('学员成绩写回培训记录', written.status === 'done' && written.score === 60,
    JSON.stringify(written));

  /* ---------- 10. 刷新保持登录 ---------- */
  await page.reload();
  await page.waitForTimeout(1000);
  const keep = await page.evaluate(() => ({
    login: document.querySelector('#loginScreen').classList.contains('is-on'),
    shell: document.querySelector('#shellLearn').classList.contains('is-on'),
    user: (document.querySelector('#lwName') || {}).textContent || ''
  }));
  check('刷新后保持登录', !keep.login && keep.shell, keep.user);

  /* ---------- 11. 无运行时错误 ---------- */
  check('无 JS 运行时错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n通过 ' + ok.length + ' 项');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) {
    console.log('\n失败 ' + bad.length + ' 项');
    bad.forEach(x => console.log('  ✗ ' + x));
  }
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
