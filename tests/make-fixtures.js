/* 生成测试用真实文件：PDF（Chromium 打印）、PPTX / DOCX（JSZip 造最小 OOXML） */
const { chromium } = require('playwright');
const JSZip = require('../lib/jszip.min.js');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fixtures');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // ---------- 真实 PDF ----------
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`
    <html><head><style>
      body { font-family: sans-serif; padding: 40px; line-height: 1.9; font-size: 15px; }
      h1 { font-size: 22px; } h2 { font-size: 17px; margin-top: 22px; }
    </style></head><body>
      <h1>信息安全管理制度（测试用 PDF）</h1>
      <h2>第三章 账号与密码</h2>
      <p>第五条 涉及客户信息的文件须加密存储，密码长度不少于 12 位。</p>
      <p>第六条 密码每 90 天更换一次，不得与个人其他账号复用。</p>
      <p>第七条 发现账号异常登录的，应在 2 小时内向信息安全部门报告。</p>
      <h2>第四章 终端与场所</h2>
      <p>第八条 离开工位必须锁定电脑屏幕，锁屏快捷键为 Win+L。</p>
      <p>第九条 外部人员来访须由接待人全程陪同，不得单独留在办公区域。</p>
      <p style="page-break-before: always">第十条 违反上述规定造成数据泄露的，按公司制度处理；情节严重的解除劳动合同。</p>
    </body></html>`);
  await page.pdf({
    path: path.join(OUT, '信息安全制度-测试.pdf'),
    format: 'A4',
    margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' }
  });
  await browser.close();
  console.log('PDF 已生成:', fs.statSync(path.join(OUT, '信息安全制度-测试.pdf')).size, 'bytes');

  // ---------- PPTX ----------
  const pptx = new JSZip();
  pptx.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '</Types>');

  const slides = [
    ['数据分级', '公开、内部、机密、绝密四个等级', '客户名单与合同属于机密级', '源代码与算法模型属于绝密级'],
    ['密码规范', '长度不少于 12 位', '每 90 天更换一次', '不得与个人账号复用'],
    ['异常处置', '发现异常登录立即改密', '2 小时内向信息安全部门报告', '保留登录日志备查']
  ];
  slides.forEach((lines, i) => {
    const body = lines.map(t =>
      '<a:p><a:r><a:t>' + t + '</a:t></a:r></a:p>').join('');
    pptx.file('ppt/slides/slide' + (i + 1) + '.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:sp><p:txBody>' + body + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  });
  const pptxBuf = await pptx.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(OUT, '安全红线案例-测试.pptx'), pptxBuf);
  console.log('PPTX 已生成:', pptxBuf.length, 'bytes');

  // ---------- DOCX ----------
  const docx = new JSZip();
  docx.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '</Types>');
  const paras = [
    '访客管理规定（测试用 Word）',
    '外部人员来访须由接待人全程陪同，不得单独留在办公区域。',
    '访客证当日有效，离场时须交回前台。',
    '访客进入机要区域须提前一天申请，由信息安全部门审批。'
  ].map(t => '<w:p><w:r><w:t>' + t + '</w:t></w:r></w:p>').join('');
  docx.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + paras + '</w:body></w:document>');
  const docxBuf = await docx.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(OUT, '访客管理规定-测试.docx'), docxBuf);
  console.log('DOCX 已生成:', docxBuf.length, 'bytes');

  // ---------- txt（GBK 编码，验证解码） ----------
  fs.writeFileSync(path.join(OUT, '培训要点-测试.txt'),
    Buffer.from('培训要点\n一、密码长度不少于 12 位\n二、每 90 天更换一次\n三、离岗必须锁屏', 'utf8'));
  console.log('TXT 已生成');
})();
