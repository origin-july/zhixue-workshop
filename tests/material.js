const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const F = n => path.join(__dirname, 'fixtures', n);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/pdf|Failed to load resource/i.test(m.text())) errs.push('CON: ' + m.text().slice(0, 150)); });
  page.on('dialog', d => d.accept());

  let pass = 0, fail = 0;
  const check = (name, ok, extra) => {
    if (ok) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')); }
    else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
  };

  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(async () => {
    localStorage.clear();
    if (window.indexedDB && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      dbs.forEach(d => indexedDB.deleteDatabase(d.name));
    }
  });
  await page.reload();
  await page.waitForTimeout(800);
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);

  /* ---------- 1. 上传四类文件 ---------- */
  await page.click('[data-tab="material"]');
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => document.querySelectorAll('#trainBody .mat-item').length);

  await page.setInputFiles('#matFileInput', [
    F('信息安全制度-测试.pdf'),
    F('安全红线案例-测试.pptx'),
    F('访客管理规定-测试.docx'),
    F('培训要点-测试.txt')
  ]);
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => ({
    count: document.querySelectorAll('#trainBody .mat-item').length,
    names: [...document.querySelectorAll('#trainBody .mat-name')].map(e => e.textContent),
    types: [...document.querySelectorAll('#trainBody .mat-ic')].map(e => e.textContent),
    canGen: document.querySelectorAll('#trainBody .mat-ok').length,
    sizes: [...document.querySelectorAll('#trainBody .mat-meta')].map(e => e.textContent.replace(/\s+/g, ' ').slice(0, 40))
  }));
  check('上传 4 个文件', after.count === before + 4, `${before} → ${after.count} 份`);
  check('类型识别', after.types.slice(-4).join(',') === 'PDF,PPT,DOC,TXT', after.types.slice(-4).join(','));
  check('全部可出题', after.canGen >= 4, after.canGen + ' 份');

  /* ---------- 2. IndexedDB 持久化 ---------- */
  const usage = await page.evaluate(() => window.Files.usage());
  check('文件存入 IndexedDB', usage.count >= 4, `${usage.count} 个文件 / ${(usage.total / 1024).toFixed(0)} KB`);

  await page.reload();
  await page.waitForTimeout(1200);
  const persisted = await page.evaluate(() => ({
    mats: document.querySelectorAll('#trainBody .mat-item').length,
    login: document.querySelector('#loginScreen') ? document.querySelector('#loginScreen').classList.contains('is-on') : true
  }));
  check('刷新后登录保持', !persisted.login);
  check('刷新后材料还在', persisted.mats === after.count, persisted.mats + ' 份');

  /* ---------- 3. PDF 阅读 ---------- */
  const pdfItem = page.locator('#trainBody .mat-item', { hasText: '信息安全制度-测试' });
  await pdfItem.locator('[data-mata="view"]').click();
  await page.waitForTimeout(1500);
  const pdfView = await page.evaluate(() => {
    const r = document.getElementById('reader');
    const f = document.getElementById('rdFrame');
    return {
      open: r && r.classList.contains('is-on'),
      mode: document.querySelector('#rdBody').className,
      isBlob: !!(f && /^blob:/.test(f.src)),
      badge: (document.querySelector('#rdBadge') || {}).textContent,
      name: (document.querySelector('#rdName') || {}).textContent,
      meta: (document.querySelector('#rdMeta') || {}).textContent
    };
  });
  check('PDF 阅读器打开', !!pdfView.open, pdfView.name);
  check('PDF 走原生内嵌', pdfView.mode.indexOf('is-pdf') >= 0 && pdfView.isBlob, pdfView.mode);
  check('PDF 类型徽章', pdfView.badge === 'PDF');

  await page.click('[data-rd="close"]');
  await page.waitForTimeout(500);

  /* ---------- 4. PPTX 阅读 + 翻页 ---------- */
  const pptItem = page.locator('#trainBody .mat-item', { hasText: '安全红线案例-测试' });
  await pptItem.locator('[data-mata="view"]').click();
  await page.waitForTimeout(1200);
  const ppt1 = await page.evaluate(() => ({
    open: document.querySelector('#reader').classList.contains('is-on'),
    badge: (document.querySelector('#rdBadge') || {}).textContent,
    pages: (document.querySelector('#rdPnum') || {}).textContent,
    text: (document.querySelector('.rd-sheet') || {}).textContent || '',
    pagerShown: getComputedStyle(document.querySelector('#rdPager')).display !== 'none'
  }));
  check('PPTX 提取页面', (ppt1.pages || '').indexOf('/') > 0, ppt1.pages + ' 页');
  check('PPTX 显示文字内容', ppt1.text.indexOf('数据分级') >= 0 || ppt1.text.indexOf('密码规范') >= 0,
    ppt1.text.replace(/\s+/g, ' ').slice(0, 40));

  await page.click('[data-rd="next"]');
  await page.waitForTimeout(600);
  const ppt2 = await page.evaluate(() => ({
    pages: (document.querySelector('#rdPnum') || {}).textContent,
    text: (document.querySelector('.rd-sheet') || {}).textContent || ''
  }));
  check('PPTX 可翻页', ppt1.pages !== ppt2.pages, `${ppt1.pages} → ${ppt2.pages}`);

  await page.click('[data-rd="close"]');
  await page.waitForTimeout(400);

  /* ---------- 5. DOCX 阅读 ---------- */
  const docItem = page.locator('#trainBody .mat-item', { hasText: '访客管理规定-测试' });
  await docItem.locator('[data-mata="view"]').click();
  await page.waitForTimeout(1000);
  const docView = await page.evaluate(() => ({
    badge: (document.querySelector('#rdBadge') || {}).textContent,
    text: (document.querySelector('.rd-sheet') || {}).textContent || ''
  }));
  check('DOCX 提取文字', docView.text.indexOf('访客证') >= 0, docView.text.replace(/\s+/g, ' ').slice(0, 40));
  await page.click('[data-rd="close"]');
  await page.waitForTimeout(400);

  /* ---------- 6. 用材料出题 ---------- */
  await page.click('[data-tab="paper"]');
  await page.waitForTimeout(500);
  const docPicker = await page.evaluate(() => ({
    items: document.querySelectorAll('#trainDocList .dp-item').length,
    noText: document.querySelectorAll('#trainDocList .dp-item.is-notext').length
  }));
  check('材料进入出题列表', docPicker.items >= 4, `${docPicker.items} 份，其中 ${docPicker.noText} 份无文字`);

  // PDF 点一下应该只弹提示，不被勾选
  const pdfBtn = page.locator('#trainDocList .dp-item.is-notext').first();
  if (await pdfBtn.count()) {
    await pdfBtn.click();
    await page.waitForTimeout(500);
    const notPicked = await pdfBtn.evaluate(e => !e.classList.contains('is-on'));
    const toastTxt = await page.locator('.toast').last().textContent().catch(() => '');
    check('无文字材料不参与出题', notPicked, (toastTxt || '').slice(0, 30));
  }

  // 勾选有文字的材料
  const textItems = page.locator('#trainDocList .dp-item:not(.is-notext)');
  const cnt = await textItems.count();
  for (let i = 0; i < cnt; i++) {
    const on = await textItems.nth(i).evaluate(e => e.classList.contains('is-on'));
    if (!on) await textItems.nth(i).click();
  }
  await page.waitForTimeout(500);
  const picked = await page.evaluate(() => ({
    on: document.querySelectorAll('#trainDocList .dp-item.is-on').length,
    hint: (document.querySelector('#trainGenHint') || {}).textContent
  }));
  check('勾选有文字材料', picked.on >= 3, picked.on + ' 份');
  console.log('     提示:', picked.hint);

  await page.click('#trainBtnGen');
  await page.waitForSelector('#trainQWrap:not(.hidden)', { timeout: 40000 }).catch(() => { });
  await page.waitForTimeout(1500);
  const gen = await page.evaluate(() => ({
    count: Number((document.querySelector('#trainQCount') || {}).textContent),
    first: (document.querySelector('#trainQList .qc-stem') || {}).textContent || ''
  }));
  check('用材料生成试题', gen.count > 0, gen.count + ' 题');
  console.log('     首题:', gen.first.slice(0, 46));

  /* ---------- 7. 学员中心阅读（以学员身份登录） ---------- */
  await page.evaluate(() => window.Auth.logout());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('#loginUser', 'chensiyuan');
  await page.fill('#loginPass', 'train2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1300);
  const homeInfo = await page.evaluate(() => ({
    rows: document.querySelectorAll('#learnHost .lw-row').length,
    meta: (document.querySelector('#learnHost .lwr-meta') || {}).textContent || '',
    focus: (document.querySelector('#learnHost .lwf-act') || {}).textContent || ''
  }));
  check('学习台列出培训', homeInfo.rows >= 1, homeInfo.rows + ' 个');
  check('培训行显示材料进度', /\d+\/\d+ 材料/.test(homeInfo.meta), homeInfo.meta.slice(0, 30));

  await page.locator('#learnHost .lw-row').first().click();
  await page.waitForTimeout(900);
  const nav = await page.evaluate(() => ({
    items: document.querySelectorAll('#learnHost .lwcn-item').length,
    mats: document.querySelectorAll('#learnHost .lwcn-item:not(.is-exam)').length,
    exam: document.querySelectorAll('#learnHost .lwcn-item.is-exam').length,
    done: document.querySelectorAll('#learnHost .lwcn-item.is-done').length,
    hasContent: !!document.querySelector('#learnHost .lwm'),
    matTitle: (document.querySelector('#learnHost .lwm-title') || {}).textContent || ''
  }));
  check('左侧小节导航', nav.mats >= 4 && nav.exam === 1,
    nav.mats + ' 份材料 + ' + nav.exam + ' 个考核');
  check('默认打开第一份材料', nav.hasContent && nav.matTitle.length > 0, nav.matTitle);
  check('内嵌渲染不弹全屏', await page.evaluate(() =>
    !document.querySelector('#reader.is-on')));

  // 标记已读前先记下当前状态（种子数据里可能本来就有已读）
  const readBefore = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    const rec = p.records.find(r => r.pid === S.learnPersonId);
    return {
      read: rec && rec.read ? Object.keys(rec.read).length : 0,
      done: document.querySelectorAll('#learnHost .lwcn-item.is-done').length
    };
  });

  // 挑一份还没读的标记
  const unread = page.locator('#learnHost .lwcn-item:not(.is-done):not(.is-exam)').first();
  if (await unread.count()) {
    await unread.click();
    await page.waitForTimeout(700);
  }
  await page.click('#learnHost [data-read]');
  await page.waitForTimeout(700);
  const marked = await page.evaluate(() => ({
    done: document.querySelectorAll('#learnHost .lwcn-item.is-done').length,
    btn: (document.querySelector('#learnHost .lwm-btn.is-done') || {}).textContent || ''
  }));
  check('标记已读生效', marked.done > readBefore.done && marked.btn.indexOf('已读') >= 0,
    readBefore.done + ' → ' + marked.done + ' 个已读');

  // 预览不写库
  const notPolluted = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    const rec = p.records.find(r => r.pid === S.learnPersonId);
    return rec && rec.read ? Object.keys(rec.read).length : 0;
  });
  check('预览不写学习记录', notPolluted === readBefore.read,
    '仍是 ' + notPolluted + ' 条，未新增');

  // 切到 PPT 看提取效果
  const pptSec = page.locator('#learnHost .lwcn-item', { hasText: '安全红线案例-测试' });
  if (await pptSec.count()) {
    await pptSec.click();
    await page.waitForTimeout(900);
    const pptView = await page.evaluate(() => ({
      pages: document.querySelectorAll('#learnHost .lmp-page').length,
      text: (document.querySelector('#learnHost .lmp-sheet') || {}).textContent || ''
    }));
    check('PPT 按页渲染', pptView.pages >= 2, pptView.pages + ' 页');
    check('PPT 文字可读', pptView.text.indexOf('数据分级') >= 0 || pptView.text.indexOf('案例') >= 0,
      pptView.text.replace(/\s+/g, ' ').slice(0, 30));
  }

  await page.screenshot({ path: 'out/m3-learn-detail.png' });

  /* ---------- 8. 学员已读写回记录 ---------- */
  await page.reload();
  await page.waitForTimeout(1300);
  const stu = await page.evaluate(() => ({
    module: document.body.dataset.module,
    learnOn: document.querySelector('#shellLearn').classList.contains('is-on'),
    navHidden: getComputedStyle(document.querySelector('#mainNav')).display === 'none',
    picker: !!document.querySelector('.pvp'),
    who: (document.querySelector('#lwName') || {}).textContent,
    rows: document.querySelectorAll('#learnHost .lw-row').length
  }));
  check('学员只能进我的学习', stu.module === 'learn' && stu.learnOn);
  check('学员看不到管理导航与身份选择', stu.navHidden && !stu.picker);
  check('学员看到自己的培训', stu.rows > 0, stu.who + ' · ' + stu.rows + ' 个培训');

  await page.locator('#learnHost .lw-row').first().click();
  await page.waitForTimeout(900);
  await page.click('#learnHost [data-read]');
  await page.waitForTimeout(700);

  const stuRead = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    const me = window.Auth.current();
    const rec = p.records.find(r => r.pid === me.personId);
    return {
      done: document.querySelectorAll('#learnHost .lwcn-item.is-done').length,
      btn: (document.querySelector('#learnHost .lwm-btn.is-done') || {}).textContent || '',
      readCount: rec && rec.read ? Object.keys(rec.read).length : 0
    };
  });
  check('学员已读写入记录', stuRead.readCount > 0, stuRead.readCount + ' 份');
  check('学员端标记已读', stuRead.done >= 1, stuRead.btn.trim());

  await page.screenshot({ path: 'out/m4-student.png' });

  console.log('\n错误:', errs.length ? errs.slice(0, 6).join('\n') : '无');
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
