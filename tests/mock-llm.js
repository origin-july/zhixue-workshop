const http = require('http');

/** 模拟 OpenAI 兼容接口，返回合法的题目 JSON */
function start(port = 0) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body); } catch (e) {}
        const prompt = (payload.messages || []).map(m => m.content).join('\n');

        // 测试连接用的短提示
        if (prompt.indexOf('回复两个字') >= 0) {
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: '正常' } }] }));
          return;
        }

        // 从提示词里读题型数量
        const counts = {};
        const re = /- (单选题|多选题|判断题|填空题|简答题) (\d+) 道/g;
        let m;
        while ((m = re.exec(prompt)) !== null) counts[m[1]] = Number(m[2]);

        const items = [];
        const map = { 单选题: 'single', 多选题: 'multi', 判断题: 'judge', 填空题: 'blank', 简答题: 'essay' };
        Object.keys(counts).forEach(cn => {
          for (let i = 0; i < counts[cn]; i++) {
            const type = map[cn];
            const q = {
              type,
              stem: `【AI出题】关于知识点的第 ${i + 1} 个问题（${cn}）？`,
              options: [], answer: '', analysis: '依据资料第 X 段。',
              difficulty: ['easy', 'medium', 'hard'][i % 3],
              score: { single: 4, multi: 6, judge: 3, blank: 4, essay: 10 }[type],
              point: '测试知识点'
            };
            if (type === 'single' || type === 'multi') {
              q.options = [
                { key: 'A', text: '选项甲' }, { key: 'B', text: '选项乙' },
                { key: 'C', text: '选项丙' }, { key: 'D', text: '选项丁' }
              ];
              q.answer = type === 'single' ? 'A' : ['A', 'C'];
            } else if (type === 'judge') {
              q.answer = '正确';
            } else if (type === 'blank') {
              q.stem = `【AI出题】填空第 ${i + 1} 题：____ 是核心要求。`;
              q.answer = '15 天';
            } else {
              q.answer = '要点一\n要点二';
            }
            items.push(q);
          }
        });

        // 故意包一层 markdown 代码块，测试容错
        const content = '```json\n' + JSON.stringify(items) + '\n```';
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { start };
