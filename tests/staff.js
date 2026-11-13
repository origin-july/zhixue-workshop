/* 员工库：来源、导入、自动加入新员工、与培训分派的联动 */
const { chromium } = require('playwright');
const path = require('path');

const ok = [], bad = [];
const check = (n, c, x) => (c ? ok : bad).push(n + (x ? ' — ' + x : ''));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CON: ' + m.text().slice(0, 140)); });
  page.on('dialog', d => d.accept());

  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1200);

  /* ---------- 1. 员工库基本结构 ---------- */
  await page.click('#mainNav [data-module="staff"]');
  await page.waitForTimeout(900);
  const s1 = await page.evaluate(() => ({
    on: document.querySelector('#shellStaff').classList.contains('is-on'),
    rows: document.querySelectorAll('.staff-table tbody tr').length,
    meta: document.querySelector('#staffMeta').textContent,
    depts: document.querySelectorAll('.stb-dept-btn').length,
    tabs: document.querySelectorAll('.stb-tab').length,
    sources: [...new Set([...document.querySelectorAll('.sft-src')].map(e => e.textContent.trim()))]
  }));
  check('员工库可进入', s1.on);
  check('列出种子员工', s1.rows === 16, s1.rows + ' 人');
  check('显示部门与状态', s1.depts >= 7 && s1.tabs === 3, s1.depts + ' 个部门按钮');
  check('标注来源', s1.sources.indexOf('示例') >= 0, s1.sources.join('/'));

  /* ---------- 2. 筛选与搜索 ---------- */
  await page.click('.stb-dept-btn:nth-child(2)');
  await page.waitForTimeout(500);
  const f1 = await page.evaluate(() => document.querySelectorAll('.staff-table tbody tr').length);
  check('按部门筛选', f1 > 0 && f1 < 16, f1 + ' 人');

  await page.click('.stb-dept-btn:first-child');
  await page.waitForTimeout(400);
  await page.fill('#staffSearch', '陈思远');
  await page.waitForTimeout(500);
  const f2 = await page.evaluate(() => ({
    rows: document.querySelectorAll('.staff-table tbody tr').length,
    name: (document.querySelector('.sft-name') || {}).textContent
  }));
  check('按姓名搜索', f2.rows === 1 && f2.name === '陈思远', f2.name);
  await page.fill('#staffSearch', '');
  await page.waitForTimeout(400);

  /* ---------- 3. 手工加员工 ---------- */
  await page.click('#btnStaffAdd');
  await page.waitForTimeout(600);
  const addOpen = await page.evaluate(() => document.getElementById('staffEditModal').classList.contains('is-on'));
  check('加员工弹窗打开', addOpen);

  await page.click('#seSave');
  await page.waitForTimeout(300);
  check('姓名必填', (await page.textContent('#seErr')).indexOf('姓名') >= 0);

  await page.fill('#seName', '陆知行');
  await page.fill('#seDept', '金融事业部');
  await page.fill('#seRole', '数据工程师');
  await page.fill('#seMail', 'luzhixing@example.com');
  await page.fill('#seJobNo', 'DG2026');
  await page.click('#seSave');
  await page.waitForTimeout(800);
  const s2 = await page.evaluate(() => ({
    rows: document.querySelectorAll('.staff-table tbody tr').length,
    pos: document.querySelector('.staff-table').innerText.indexOf('陆知行'),
    meta: document.querySelector('#staffMeta').textContent
  }));
  check('新员工入库', s2.rows === 17 && s2.pos >= 0, s2.meta);
  check('新员工算入职 30 天内', /位新入职/.test(s2.meta), s2.meta);

  /* ---------- 4. 新入职筛选 ---------- */
  await page.click('[data-sf="new"]');
  await page.waitForTimeout(500);
  const s3 = await page.evaluate(() => ({
    rows: document.querySelectorAll('.staff-table tbody tr').length,
    tag: (document.querySelector('.sft-new') || {}).textContent
  }));
  check('新入职筛选', s3.rows === 1 && /入职/.test(s3.tag || ''), s3.tag);
  await page.click('[data-sf="all"]');
  await page.waitForTimeout(400);

  /* ---------- 5. 停用 / 启用 ---------- */
  await page.locator('.staff-table [data-eact="toggle"]').last().click();
  await page.waitForTimeout(600);
  const s4 = await page.evaluate(() => ({
    off: document.querySelectorAll('.staff-table tbody tr.is-off').length,
    meta: document.querySelector('#staffMeta').textContent
  }));
  check('可停用员工', s4.off === 1, s4.meta);

  await page.click('[data-sf="off"]');
  await page.waitForTimeout(500);
  const s5 = await page.evaluate(() => document.querySelectorAll('.staff-table tbody tr').length);
  check('停用筛选只看到停用的', s5 === 1, s5 + ' 人');
  await page.locator('.staff-table [data-eact="toggle"]').first().click();
  await page.waitForTimeout(600);
  await page.click('[data-sf="all"]');
  await page.waitForTimeout(400);

  /* ---------- 6. CSV 导入 ---------- */
  await page.click('#btnStaffImport');
  await page.waitForTimeout(600);
  await page.click('#siSample');
  await page.waitForTimeout(700);
  const imp1 = await page.evaluate(() => ({
    sum: (document.querySelector('.si-sum') || {}).textContent,
    rows: document.querySelectorAll('.si-row').length,
    hasBtn: !!document.querySelector('#siDo')
  }));
  check('导入前先给预览', /识别到/.test(imp1.sum || '') && imp1.rows > 0, imp1.sum);

  await page.click('#siDo');
  await page.waitForTimeout(900);
  const imp2 = await page.evaluate(() => ({
    rows: document.querySelectorAll('.staff-table tbody tr').length,
    hasZhang: document.querySelector('.staff-table').innerText.indexOf('张三') >= 0,
    src: [...document.querySelectorAll('.staff-table .sft-src')].map(e => e.textContent.trim())
  }));
  check('导入写入员工库', imp2.rows === 19 && imp2.hasZhang, imp2.rows + ' 人');
  check('导入来源标注正确', imp2.src.indexOf('导入') >= 0);

  /* ---------- 7. 重复导入不产生重复人 ---------- */
  await page.click('#btnStaffImport');
  await page.waitForTimeout(600);
  await page.click('#siSample');
  await page.waitForTimeout(700);
  const imp3 = await page.evaluate(() => (document.querySelector('.si-sum') || {}).textContent);
  check('重复导入识别为更新', /新增 0/.test(imp3), imp3);
  await page.locator('#staffImportModal [data-close]').first().click();
  await page.waitForTimeout(400);

  /* ---------- 8. 钉钉同步（贴 JSON） ---------- */
  await page.click('#btnStaffSync');
  await page.waitForTimeout(700);
  const ding1 = await page.evaluate(() => ({
    state: (document.querySelector('#sdState') || {}).textContent,
    hasJson: !!document.querySelector('#sdJson')
  }));
  check('钉钉入口说明未连接状态', /未连接/.test(ding1.state || ''), (ding1.state || '').slice(0, 14));

  await page.fill('#sdJson', JSON.stringify([
    { name: '钉钉新人', dept: '产业事业部', role: '售前顾问', mail: 'dd@example.com', joinedAt: '2026-11-08' }
  ]));
  await page.click('#sdPull');
  await page.waitForTimeout(1000);
  const ding2 = await page.evaluate(() => ({
    rows: document.querySelectorAll('.staff-table tbody tr').length,
    src: [...document.querySelectorAll('.staff-table .sft-src')].map(e => e.textContent.trim())
  }));
  check('钉钉数据落地员工库', ding2.rows === 20, ding2.rows + ' 人');
  check('钉钉来源标注', ding2.src.indexOf('钉钉') >= 0);

  /* ---------- 9. 新员工自动加入培训项目 ---------- */
  await page.click('#mainNav [data-module="manage"]');
  await page.waitForTimeout(700);
  await page.click('[data-tab="assign"]');
  await page.waitForTimeout(700);

  await page.click('#asgAutoJoin');
  await page.waitForTimeout(700);
  const a1 = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    return {
      on: !!p.autoJoin,
      people: p.people.length,
      newHireChips: [...document.querySelectorAll('.asgp-chip b')].filter(b => /陆知行|钉钉新人|张三/.test(b.textContent)).length
    };
  });
  check('可开启新员工自动加入', a1.on, a1.people + ' 人已加入');
  check('自动加入把新入职的塞进项目', a1.newHireChips >= 2, a1.newHireChips + ' 位新人在名单里');

  await page.click('[data-pick="new"]');
  await page.waitForTimeout(700);
  const a2 = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    return { people: p.people.length, sum: document.querySelector('#asgSum').textContent };
  });
  check('一键选新入职', /人参加/.test(a2.sum), a2.sum);

  /* ---------- 10. 员工库改动同步到分派名单 ---------- */
  const before = a2.people;
  await page.click('#mainNav [data-module="staff"]');
  await page.waitForTimeout(700);
  await page.fill('#staffSearch', '陆知行');
  await page.waitForTimeout(500);
  await page.locator('.staff-table [data-eact="del"]').first().click();
  await page.waitForTimeout(900);
  await page.click('#mainNav [data-module="manage"]');
  await page.waitForTimeout(700);
  await page.click('[data-tab="assign"]');
  await page.waitForTimeout(700);
  const a3 = await page.evaluate(() => {
    const S = window.App.state;
    const p = S.projects.find(x => x.id === S.activeProjectId);
    return { people: p.people.length, names: [...document.querySelectorAll('.asgp-chip b')].map(b => b.textContent) };
  });
  check('删员工后分派名单同步移除', a3.people === before - 1, before + ' → ' + a3.people);
  check('名单里不再有这个人', a3.names.indexOf('陆知行') < 0);

  /* ---------- 11. 导出成绩包含没开始的人 ---------- */
  await page.click('[data-tab="board"]');
  await page.waitForTimeout(600);
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#btnExportCsv');
  const d = await dl;
  await d.saveAs(path.join(__dirname, 'out', d.suggestedFilename()));
  const fs = require('fs');
  const csv = fs.readFileSync(path.join(__dirname, 'out', d.suggestedFilename()), 'utf8');
  const lines = csv.split('\n').filter(l => l.trim());
  const head = lines[0];
  check('成绩表含及格线与通过状态', head.indexOf('及格线') >= 0 && head.indexOf('是否通过') >= 0);
  check('没交卷的人也在表里', lines.length - 1 === a3.people, (lines.length - 1) + ' 行 / ' + a3.people + ' 人');

  console.log('\n错误:', errs.length ? errs.slice(0, 6).join('\n') : '无');
  console.log(`\n通过 ${ok.length} 项，失败 ${bad.length} 项`);
  if (bad.length) bad.forEach(b => console.log('  ✗ ' + b));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
