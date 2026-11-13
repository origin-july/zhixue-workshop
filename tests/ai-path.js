/* 用本地 mock 接口验证「培训管理 → 出题」走大模型的完整链路 */
const { chromium } = require('playwright');
const path = require('path');
const { start } = require('./mock-llm');

(async () => {
  const server = await start(0);
  const port = server.address().port;
  console.log('模拟接口端口:', port);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  page.on('dialog', d => d.accept());

  let pass = 0, fail = 0;
  const check = (name, ok, extra) => {
    if (ok) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')); }
    else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
  };

  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);

  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);

  /* 配置 AI */
  await page.click('#btnSettings');
  await page.waitForTimeout(400);
  await page.click('#swLlm');
  await page.waitForTimeout(300);
  await page.fill('#llmBase', `http://127.0.0.1:${port}/v1`);
  await page.fill('#llmKey', 'sk-test');
  await page.fill('#llmModel', 'mock-model');
  await page.waitForTimeout(400);

  await page.click('#btnTestLlm');
  await page.waitForTimeout(1400);
  const testRes = await page.textContent('#llmTestRes');
  check('测试连接通过', testRes.indexOf('连接正常') >= 0, testRes);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('顶栏显示模型名', (await page.textContent('#engineText')).indexOf('mock-model') >= 0,
    await page.textContent('#engineText'));

  /* 用粘贴资料出题 */
  await page.click('[data-tab="paper"]');
  await page.waitForTimeout(500);
  await page.click('#trainSrcTabs [data-src="paste"]');
  await page.waitForTimeout(300);
  await page.fill('#trainPaste',
    '信息安全管理制度。员工不得将公司内部资料上传至个人网盘，不得使用未经审批的第三方协作工具。' +
    '涉及客户信息的文件须加密存储，密码长度不少于 12 位，且每 90 天更换一次。' +
    '离开工位时必须锁定电脑屏幕，锁屏快捷键为 Win+L。发现账号异常登录的，应在 2 小时内向信息安全部门报告。' +
    '外部人员来访须由接待人全程陪同，不得单独留在办公区域。访客证当日有效，离场时须交回前台。');
  await page.waitForTimeout(500);
  check('资料字数识别', (await page.textContent('#trainPasteChars')) !== '0',
    await page.textContent('#trainPasteChars'));

  await page.click('#trainBtnGen');
  await page.waitForSelector('#trainQWrap:not(.hidden)', { timeout: 40000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => ({
    count: Number(document.querySelector('#trainQCount').textContent),
    score: document.querySelector('#trainFootScore').textContent,
    firstStem: (document.querySelector('#trainQList .qc-stem') || {}).textContent || '',
    types: [...document.querySelectorAll('#trainQList .qc-type')].map(e => e.textContent)
  }));
  check('AI 生成题目', r.count > 0, r.count + ' 题 / ' + r.score + ' 分');
  check('内容来自 AI', r.firstStem.indexOf('【AI出题】') >= 0, r.firstStem.slice(0, 40));
  check('题型齐全', r.types.length === r.count, r.types.slice(0, 4).join('/'));

  /* 学员登录后能看到 AI 出的题 */
  await page.evaluate(() => window.Auth.logout());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('#loginUser', 'chensiyuan');
  await page.fill('#loginPass', 'train2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1300);
  await page.locator('#learnHost .lw-row').first().click();
  await page.waitForTimeout(800);
  await page.click('#learnHost .lwcn-item.is-exam');
  await page.waitForTimeout(600);
  await page.click('#learnHost [data-start]');
  await page.waitForTimeout(900);
  const examStem = await page.textContent('#learnHost .lx-stem').catch(() => '');
  check('学员答题看到 AI 题', examStem.indexOf('【AI出题】') >= 0, examStem.slice(0, 34));

  console.log('\n错误:', errs.length ? errs.slice(0, 4) : '无');
  check('无运行时错误', errs.length === 0);

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
