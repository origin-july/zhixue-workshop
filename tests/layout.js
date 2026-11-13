/* 布局审计：溢出 / 越界 / 遮挡 / 最小字号 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  page.on('pageerror', e => console.log('ERR:', e.message));
  page.on('dialog', d => d.accept());
  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);

  let problems = 0;

  async function audit(label, sels) {
    const r = await page.evaluate((sels) => {
      const out = { hScroll: false, overflow: [], cover: [], small: [], min: 99 };
      out.hScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      document.querySelectorAll('body *').forEach(el => {
        const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (!hasText || el.offsetParent === null) return;
        const st = getComputedStyle(el);
        const fs = parseFloat(st.fontSize);
        if (fs < out.min) out.min = fs;
        if (fs < 13) out.small.push(fs + 'px:' + el.textContent.trim().slice(0, 14));
        if (st.textOverflow === 'ellipsis' || st.webkitLineClamp !== 'none') return;
        if (el.scrollWidth > el.clientWidth + 4 && st.overflowX === 'visible') {
          out.overflow.push((String(el.className).split(' ')[0] || el.tagName) + ' ' + el.scrollWidth + '>' + el.clientWidth);
        }
      });
      (sels || []).forEach(s => {
        const e = document.querySelector(s);
        if (!e) { out.cover.push(s + ' 缺失'); return; }
        const b = e.getBoundingClientRect();
        // 祖先容器被隐藏（例如学员端标签下出题面板让位给快改面板）不算问题
        if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return;
        if (b.width === 0 || b.height === 0) {
          if (getComputedStyle(e).display !== 'none') out.cover.push(s + ' 尺寸为0');
          return;
        }
        if (b.right > innerWidth + 1 || b.left < -1) out.cover.push(s + ' 越界');
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (top && !e.contains(top) && top !== e && !top.closest('.modal.is-on') && !top.closest('.user-menu.is-on') && !top.closest('.reader.is-on')) {
          out.cover.push(s + ' 被 ' + (String(top.className).split(' ')[0] || top.tagName) + ' 遮挡');
        }
      });
      return out;
    }, sels);

    const bad = r.hScroll || r.overflow.length || r.cover.length || r.small.length;
    if (bad) problems++;
    console.log(`${bad ? '⚠' : '✓'} [${label}] 横滚=${r.hScroll} 溢出=${r.overflow.length} 遮挡=${r.cover.length} 最小=${r.min}px`);
    r.overflow.slice(0, 3).forEach(x => console.log('    溢出 ' + x));
    r.cover.slice(0, 4).forEach(x => console.log('    ' + x));
    r.small.slice(0, 4).forEach(x => console.log('    小字 ' + x));
  }

  await audit('登录页', ['#loginForm', '#loginBtn']);

  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1100);

  const adminSels = ['#userBtn', '#btnSettings', '#mainNav', '#trainTabs', '#thTitle'];
  await audit('管理-看板', adminSels.concat(['.bd-sum', '.bd-track', '.bd-table']));

  for (const t of ['material', 'paper', 'assign']) {
    await page.click(`[data-tab="${t}"]`);
    await page.waitForTimeout(600);
    await audit('管理-' + t, adminSels);
  }

  // 员工库
  await page.click('#mainNav [data-module="staff"]');
  await page.waitForTimeout(900);
  await audit('员工库', ['#shellStaff', '#staffBody', '#btnStaffAdd', '.staff-table']);
  await page.click('#mainNav [data-module="manage"]');
  await page.waitForTimeout(700);

  // 阅读器
  await page.click('[data-tab="material"]');
  await page.waitForTimeout(500);
  await page.locator('#trainBody .mat-item [data-mata="view"]').first().click();
  await page.waitForTimeout(900);
  await audit('阅读器', ['#reader .rd-bar', '#reader .rd-tools', '#reader .rd-foot']);
  await page.click('[data-rd="close"]');
  await page.waitForTimeout(400);

  // 学员中心（换学员账号）
  await page.evaluate(() => window.Auth.logout());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('#loginUser', 'chensiyuan');
  await page.fill('#loginPass', 'train2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1300);
  await audit('学员中心-学习台', ['#learnHost', '.learn-toolbar', '#mainNav']);
  await page.locator('#learnHost .lw-row').first().click();
  await page.waitForTimeout(800);
  await audit('学员中心-学习页', ['.learn-toolbar', '#learnHost .lwcn-item', '#learnHost .lwm']);

  // 切到考核小节
  await page.click('#learnHost .lwcn-item.is-exam');
  await page.waitForTimeout(600);
  await audit('学员中心-考核入口', ['#learnHost .lwe-card']);

  await page.click('#learnHost [data-start]');
  await page.waitForTimeout(900);
  await audit('学员中心-答题', ['#learnHost .lx-strip', '#learnHost .lx-submit', '#learnHost .lx-clock']);
  await page.click('#learnHost [data-submit]');
  await page.waitForSelector('#learnHost .lr-hero', { timeout: 20000 }).catch(() => { });
  await page.waitForTimeout(700);
  await audit('学员中心-成绩', ['#learnHost .lr-hero', '#learnHost .lw-mb']);

  // 弹窗（需回到管理员）
  await page.evaluate(() => window.Auth.logout());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1200);

  await page.click('#userBtn');
  await page.waitForTimeout(300);
  await page.click('#umAccounts');
  await page.waitForTimeout(500);
  await audit('账号管理', ['#accountsModal', '#accAddNew']);
  await page.locator('#accountsModal .icon-btn[data-close]').click();
  await page.waitForTimeout(400);

  await page.click('#btnSettings');
  await page.waitForTimeout(500);
  await audit('设置', ['#settingsModal']);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 多宽度
  for (const w of [1440, 1280, 1180, 1024]) {
    await page.setViewportSize({ width: w, height: 950 });
    await page.waitForTimeout(500);
    // 学员账号看不到管理端，只量学员端
    await audit(w + ' 学员中心', ['#learnHost', '.learn-toolbar']);
  }

  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'out/l-final.png' });

  console.log(problems ? `\n有 ${problems} 处需要处理` : '\n布局与字号全部正常');
  await browser.close();
  process.exit(problems ? 1 : 0);
})();
