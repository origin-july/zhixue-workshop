/* =========================================================
   train-data.js — 员工培训模块种子数据
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 受训人员 ---------- */
  var PEOPLE = [
    { id: 'p01', name: '陈思远', dept: '产业事业部', role: '售前顾问', mail: 'chensiyuan@example.com', avatar: '陈' },
    { id: 'p02', name: '林晚晴', dept: '产业事业部', role: '产品经理', mail: 'linwanqing@example.com', avatar: '林' },
    { id: 'p03', name: '周予安', dept: '销售管理部', role: '销售代表', mail: 'zhouyuan@example.com', avatar: '周' },
    { id: 'p04', name: '许嘉禾', dept: '销售管理部', role: '售前经理', mail: 'xujiahe@example.com', avatar: '许' },
    { id: 'p05', name: '沈亦舟', dept: '金融事业部', role: '业务分析', mail: 'shenyizhou@example.com', avatar: '沈' },
    { id: 'p06', name: '顾清和', dept: '金融事业部', role: '项目经理', mail: 'guqinghe@example.com', avatar: '顾' },
    { id: 'p07', name: '叶行舟', dept: '交付中心', role: '交付工程师', mail: 'yexingzhou@example.com', avatar: '叶' },
    { id: 'p08', name: '唐宁川', dept: '交付中心', role: 'IDP 顾问', mail: 'tangningchuan@example.com', avatar: '唐' },
    { id: 'p09', name: '宋知微', dept: '人力资源部', role: 'HRBP', mail: 'songzhiwei@example.com', avatar: '宋' },
    { id: 'p10', name: '方叙白', dept: '研发中心', role: '后端开发', mail: 'fangxubai@example.com', avatar: '方' },
    { id: 'p11', name: '江砚清', dept: '研发中心', role: '算法工程师', mail: 'jiangyanqing@example.com', avatar: '江' },
    { id: 'p12', name: '温以宁', dept: '研发中心', role: '前端开发', mail: 'wenyining@example.com', avatar: '温' },
    { id: 'p13', name: '贺молодой', dept: '产业事业部', role: '实施顾问', mail: 'hejun@example.com', avatar: '贺' },
    { id: 'p14', name: '苏墨白', dept: '销售管理部', role: '渠道经理', mail: 'sumobai@example.com', avatar: '苏' },
    { id: 'p15', name: '程亦寒', dept: '交付中心', role: '实施顾问', mail: 'chengyihan@example.com', avatar: '程' },
    { id: 'p16', name: '卢星野', dept: '金融事业部', role: '售前顾问', mail: 'luxingye@example.com', avatar: '卢' }
  ];
  // 修正一个误入的字符
  PEOPLE[12].name = '贺君行';

  /* ---------- 邮件模板 ---------- */
  function defaultTemplates() {
    return {
      invite: {
        id: 'invite',
        name: '开班通知',
        subject: '【培训通知】{{培训名称}} 已开放，请于 {{截止时间}} 前完成',
        body:
'{{姓名}}，你好：\n\n' +
'你被安排参加《{{培训名称}}》培训考核，具体安排如下：\n\n' +
'  培训项目：{{培训名称}}\n' +
'  所属部门：{{部门}}\n' +
'  学习材料：{{材料数量}} 份\n' +
'  考核题量：{{题目数量}} 题，满分 {{总分}} 分，{{及格分}} 分及格\n' +
'  截止时间：{{截止时间}}\n' +
'  限时作答：{{时长}} 分钟\n\n' +
'请先阅读培训材料，再进入考核。提交后立即出分，未通过可在截止前重考一次。\n\n' +
'开始学习：{{链接}}\n\n' +
'如有疑问请联系人力资源部培训组。\n\n' +
'人力资源部'
      },
      remind: {
        id: 'remind',
        name: '截止前提醒',
        subject: '【还有 {{剩余天数}} 天】{{培训名称}} 尚未完成，请尽快处理',
        body:
'{{姓名}}，你好：\n\n' +
'《{{培训名称}}》的完成截止时间为 {{截止时间}}，你目前尚未提交考核。\n\n' +
'  当前进度：{{进度}}\n' +
'  剩余时间：{{剩余天数}} 天\n\n' +
'请合理安排时间，在截止前完成学习与考核。逾期未完成将计入本月培训完成率统计。\n\n' +
'继续学习：{{链接}}\n\n' +
'人力资源部'
      },
      urge: {
        id: 'urge',
        name: '逾期催办',
        subject: '【已逾期】{{培训名称}} 未完成，请联系培训组',
        body:
'{{姓名}}，你好：\n\n' +
'《{{培训名称}}》已于 {{截止时间}} 截止，系统显示你尚未完成考核。\n\n' +
'  培训项目：{{培训名称}}\n' +
'  应完成时间：{{截止时间}}\n' +
'  当前状态：{{进度}}\n\n' +
'如需补做，请回复本邮件说明原因，培训组会视情况开放补考窗口。\n\n' +
'人力资源部'
      },
      result: {
        id: 'result',
        name: '成绩通知',
        subject: '【考核结果】{{培训名称}} — {{成绩}} 分',
        body:
'{{姓名}}，你好：\n\n' +
'你已完成《{{培训名称}}》考核，结果如下：\n\n' +
'  得分：{{成绩}} 分（满分 {{总分}} 分）\n' +
'  结果：{{通过状态}}\n' +
'  用时：{{用时}}\n' +
'  提交时间：{{提交时间}}\n\n' +
'{{结果提示}}\n\n' +
'查看详情：{{链接}}\n\n' +
'人力资源部'
      }
    };
  }

  /* ---------- 提醒规则 ---------- */
  function defaultRules() {
    return [
      { key: 'invite', name: '开班通知', desc: '分发后立即发送给全部受训人员', on: true, timing: 'onPublish', sent: 0 },
      { key: 'remind3', name: '截止前 3 天提醒', desc: '仅发给未完成的人员', on: true, timing: 'd3', sent: 0 },
      { key: 'remind1', name: '截止前 1 天提醒', desc: '仅发给未完成的人员', on: true, timing: 'd1', sent: 0 },
      { key: 'urge', name: '逾期催办', desc: '截止后次日发给未完成人员', on: false, timing: 'overdue', sent: 0 },
      { key: 'result', name: '成绩通知', desc: '交卷后立即发送给本人', on: true, timing: 'onSubmit', sent: 0 }
    ];
  }

  /* ---------- 培训材料 ----------
     示例材料没有真实文件，只带一段 preview 正文，用来演示阅读器
     真实上传的材料会有 hasFile: true，文件本体存在 IndexedDB 里
  */
  function defaultMaterials() {
    return [
      {
        id: 'm1', name: '信息安全管理制度 v3.2.pdf', type: 'pdf', size: '1.8 MB',
        pages: 24, uploadedAt: '2026-11-02', views: 0, hasFile: false,
        preview: '第一章 总则\n\n' +
          '第一条 为规范公司信息资产的使用与保护，防范数据泄露风险，依据《网络安全法》《数据安全法》制定本制度。\n\n' +
          '第二条 本制度适用于公司全体员工、实习生、外包人员及经授权访问公司信息系统的外部人员。\n\n' +
          '第二章 数据分级\n\n' +
          '第三条 公司信息资产按敏感程度分为四级：公开、内部、机密、绝密。\n' +
          '客户名单、合同文本、报价体系属于机密级；源代码、算法模型、未公开财报属于绝密级。\n\n' +
          '第四条 机密级及以上信息不得存储在个人设备、个人网盘或未经审批的第三方协作工具中。\n\n' +
          '第三章 账号与密码\n\n' +
          '第五条 涉及客户信息的文件须加密存储，密码长度不少于 12 位，包含大小写字母、数字与符号。\n\n' +
          '第六条 密码每 90 天更换一次，不得与个人其他账号复用。\n\n' +
          '第七条 发现账号异常登录的，应在 2 小时内向信息安全部门报告，并立即修改密码。\n\n' +
          '第四章 终端与场所\n\n' +
          '第八条 离开工位必须锁定电脑屏幕，锁屏快捷键为 Win+L。\n\n' +
          '第九条 外部人员来访须由接待人全程陪同，不得单独留在办公区域。\n' +
          '访客证当日有效，离场时须交回前台。\n\n' +
          '第五章 违规处理\n\n' +
          '第十条 违反上述规定造成数据泄露的，按公司制度处理；情节严重的，解除劳动合同并追究法律责任。'
      },
      {
        id: 'm2', name: '信息安全红线案例集.pptx', type: 'ppt', size: '3.4 MB',
        pages: 12, uploadedAt: '2026-11-02', views: 0, hasFile: false,
        preview: '案例一：把客户名单发到个人邮箱\n\n' +
          '某销售为方便周末处理业务，将客户联系表转发至个人邮箱。三周后该邮箱被撞库，客户信息流入灰产渠道。\n' +
          '结果：解除劳动合同，公司承担违约赔偿。\n\n' +
          '案例二：用个人网盘同步项目资料\n\n' +
          '某研发为在家办公，将项目源码同步至个人网盘，网盘账号未开启二次验证。\n' +
          '结果：源码外泄，项目延期，当事人被追责。\n\n' +
          '案例三：离开工位不锁屏\n\n' +
          '某员工午休未锁屏，同事误操作删除了测试库数据，导致当日版本发布失败。\n' +
          '结果：通报批评，绩效降级。\n\n' +
          '案例四：访客单独留在办公区\n\n' +
          '前台临时离岗，访客独自在开放办公区停留 20 分钟，拍摄了工位屏幕。\n' +
          '结果：前台与接待人同时被问责。'
      },
      {
        id: 'm3', name: '账号与密码规范操作手册.docx', type: 'doc', size: '860 KB',
        pages: 8, uploadedAt: '2026-11-03', views: 0, hasFile: false,
        preview: '一、账号申请\n\n' +
          '新入职员工由直属主管在 IT 服务台提交账号申请，注明所需系统与权限范围。\n' +
          '账号命名规则为「姓全拼 + 名首字母」，重名时追加数字。\n\n' +
          '二、密码设置\n\n' +
          '1. 长度不少于 12 位\n' +
          '2. 包含大写字母、小写字母、数字、符号中的至少三类\n' +
          '3. 不得使用姓名、生日、手机号、连续数字\n' +
          '4. 不得与个人社交账号、邮箱使用同一密码\n\n' +
          '三、密码更换\n\n' +
          '每 90 天更换一次。系统会在到期前 7 天、前 1 天分别提醒。\n' +
          '如怀疑密码泄露，应立即手动更换，不受周期限制。\n\n' +
          '四、多因素认证\n\n' +
          'VPN、邮箱、代码仓库、财务系统必须开启二次验证。\n\n' +
          '五、离职处理\n\n' +
          '离职当日 18:00 前由 IT 统一停用账号，权限同步回收。'
      }
    ];
  }


  /* ---------- 种子试题 ---------- */
  function seedQuestions(bank) {
    function q(type, stem, opts, answer, analysis, diff, score, point) {
      return {
        id: 'sq' + bank + Math.random().toString(36).slice(2, 8),
        type: type, stem: stem,
        options: (opts || []).map(function (t, i) { return { key: 'ABCDEF'[i], text: t }; }),
        answer: answer, analysis: analysis || '',
        difficulty: diff || 'medium', score: score || 5,
        point: point || '信息安全基础'
      };
    }

    return [
      q('single', '员工将公司内部资料上传至个人网盘，属于下列哪种情形？',
        ['正常备份行为', '违反信息安全规定的行为', '只要不涉及客户信息即可', '经主管口头同意即可'],
        'B', '公司明确规定内部资料不得上传至个人网盘或未经审批的第三方工具。', 'easy', 5, '数据外发红线'),
      q('single', '涉及客户信息的文件，密码长度要求不少于多少位？',
        ['4 位', '6 位', '8 位', '12 位'],
        'D', '制度要求密码长度不少于 12 位，且每 90 天更换一次。', 'medium', 5, '账号与密码'),
      q('multi', '以下哪些做法符合信息安全规范？',
        ['客户信息文件加密存储', '离开工位锁定电脑屏幕', '用个人邮箱转发合同给客户', '每 90 天更换一次密码'],
        ['A', 'B', 'D'], '用个人邮箱转发合同属于违规外发行为。', 'medium', 8, '数据外发红线'),
      q('multi', '发现账号异常登录后，正确的处理包括？',
        ['立即修改密码', '2 小时内向信息安全部门报告', '先观察几天再说', '检查近期操作记录'],
        ['A', 'B', 'D'], '异常登录必须及时处置并上报，不能拖延观察。', 'medium', 8, '异常登录处置'),
      q('judge', '外部人员来访时，须由接待人全程陪同，不得单独留在办公区域。',
        [], '正确', '这是访客管理的基本要求。', 'easy', 5, '访客与场所管理'),
      q('judge', '访客证可以多次使用，离场时无需交回前台。',
        [], '错误', '访客证当日有效，离场时必须交回前台。', 'easy', 5, '访客与场所管理'),
      q('blank', '发现账号异常登录的，应在 ____ 小时内向信息安全部门报告。',
        [], '2', '制度明确要求 2 小时内报告。', 'medium', 6, '异常登录处置'),
      q('blank', '客户信息文件的密码每 ____ 天需要更换一次。',
        [], '90', '密码更换周期为 90 天。', 'hard', 6, '账号与密码'),
      q('essay', '请简述员工在日常工作中应当遵守的三条信息安全要求，并说明违反可能带来的后果。',
        [], '1. 不得将内部资料上传个人网盘或未经审批的第三方工具\n2. 客户信息文件须加密存储，密码不少于 12 位并定期更换\n3. 离开工位必须锁屏，异常登录及时上报',
        '答出三条具体做法并结合泄露风险说明即可。', 'hard', 12, '综合应用')
    ];
  }

  /* ---------- 培训项目 ---------- */
  function defaultProjects() {
    // 题目实例只生成一次：题目 id 必须和记录里的事件 qid 对得上，
    // 否则看板算不出逐题正确率
    var qsA = seedQuestions('a');
    var qsB = seedQuestions('b').slice(0, 5);

    return [
      {
        id: 'tp1',
        title: '2026 信息安全与数据合规培训',
        dept: '全员',
        type: '必修',
        status: 'active',
        owner: '宋知微',
        createdAt: '2026-11-02',
        startAt: '2026-11-05',
        dueAt: '2026-11-25',
        duration: 45,
        passScore: 60,
        retake: 1,
        desc: '面向全员的年度信息安全培训，覆盖账号安全、数据分级、外发审批与违规案例。完成后需通过 20 题考核。',
        materials: defaultMaterials(),
        questions: qsA,
        rules: defaultRules(),
        templates: defaultTemplates(),
        people: PEOPLE.slice(0, 14).map(function (p) { return p.id; }),
        records: buildRecords(PEOPLE.slice(0, 14), 'tp1', 60, qsA, ['m1', 'm2', 'm3'])
      },
      {
        id: 'tp2',
        title: '新员工入职必修（11 月批次）',
        dept: '新入职',
        type: '必修',
        status: 'active',
        owner: '宋知微',
        createdAt: '2026-11-08',
        startAt: '2026-11-10',
        dueAt: '2026-12-10',
        duration: 30,
        passScore: 60,
        retake: 2,
        desc: '11 月入职新员工的制度与流程必修课，覆盖考勤休假、报销规范、信息安全与协作工具。',
        materials: [
          { id: 'm1', name: '员工手册 2026 版.pdf', type: 'pdf', size: '3.2 MB', pages: 46, uploadedAt: '2026-11-08', views: 0 },
          { id: 'm2', name: '入职第一周指引.docx', type: 'doc', size: '420 KB', pages: 6, uploadedAt: '2026-11-08', views: 0 }
        ],
        questions: qsB,
        rules: defaultRules(),
        templates: defaultTemplates(),
        people: PEOPLE.slice(9, 16).map(function (p) { return p.id; }),
        records: buildRecords(PEOPLE.slice(9, 16), 'tp2', 31, qsB, ['m1', 'm2'])
      },
      {
        id: 'tp3',
        title: '售前方案能力认证（Q4）',
        dept: '销售管理部',
        type: '选修',
        status: 'draft',
        owner: '许嘉禾',
        createdAt: '2026-11-12',
        startAt: '2026-11-20',
        dueAt: '2026-12-20',
        duration: 60,
        passScore: 70,
        retake: 1,
        desc: '面向售前岗位的方案设计能力认证，含客户需求拆解、方案结构、报价逻辑三个模块。',
        materials: [],
        questions: [],
        rules: defaultRules(),
        templates: defaultTemplates(),
        people: PEOPLE.slice(2, 5).map(function (p) { return p.id; }),
        records: buildRecords(PEOPLE.slice(2, 5), 'tp3', 0, [], [])
      }
    ];
  }

  /**
   * 生成受训记录：部分人已完成，部分进行中，部分未开始
   * maxScore 传卷面总分，分数按比例换算，避免超过满分
   */
  function buildRecords(people, projId, maxScore, questions, matIds) {
    var seed = projId === 'tp1' ? 0.5 : (projId === 'tp2' ? 0.4 : 0);
    var max = maxScore || 100;
    var qs = questions || [];

    return people.map(function (p, i) {
      var r = { pid: p.id, status: 'pending', score: null, used: null, submitAt: null, tries: 0, answers: null, read: {} };
      var roll = (i + (projId === 'tp2' ? 3 : 0)) % 10 / 10;

      if (projId === 'tp3') return r;   // 草稿项目，无进度

      if (roll < seed) {
        r.status = 'done';
        // 得分率落在 45% ~ 95%，及格线 60% 上下浮动更真实
        var pct = 68 + ((i * 11 + (projId === 'tp2' ? 19 : 0)) % 31);
        r.score = Math.round(max * pct / 100);
        r.used = 12 + (i * 3) % 26;
        var dd = 3 + (i % 7);   // 落在本月 3~9 号，都是过去时间
        var at = new Date(2026, 10, dd, 10, 0, 0).getTime();
        r.submitAt = '2026-11-' + String(dd).padStart(2, '0') + ' ' +
          String(9 + (i % 8)).padStart(2, '0') + ':' + String((i * 11) % 60).padStart(2, '0');
        r.tries = 1;

        // 已交卷的人把材料读完了
        r.read = {};
        (matIds || []).forEach(function (mid) { r.read[mid] = at - 3600000; });

        // 生成作答事件：掌握度靠这个算，不靠存档的分数
        r.events = qs.map(function (q, k) {
          // 得分率高的人答对更多；保留一点随机，避免所有人曲线一样
          var cut = pct / 100 + ((k * 7 + i * 3) % 20 - 10) / 100;
          return {
            kind: 'attempt',
            qid: q.id,
            point: String(q.point || '').trim() || '综合考核',
            correct: (k + 1) / qs.length <= cut,
            earned: 0,
            full: Number(q.score) || 0,
            at: at
          };
        });
      } else if (roll < seed + 0.25) {
        r.status = 'doing';
        r.used = 3 + (i % 9);
        r.read = {};
        (matIds || []).slice(0, 1 + (i % 2)).forEach(function (mid) {
          r.read[mid] = new Date(2026, 10, 8, 15, 0, 0).getTime();
        });
      }
      return r;
    });
  }

  /* ---------- 状态字典 ---------- */
  var STATUS = {
    active: { name: '进行中', cls: 'st-active' },
    draft: { name: '草稿', cls: 'st-draft' },
    closed: { name: '已结束', cls: 'st-closed' }
  };

  var REC_STATUS = {
    done: { name: '已完成', cls: 'rs-done' },
    doing: { name: '进行中', cls: 'rs-doing' },
    pending: { name: '未开始', cls: 'rs-pending' }
  };

  global.TrainData = {
    seedPeople: PEOPLE,        // 首次运行用来初始化员工库
    people: PEOPLE,            // 兼容字段；staff.js 会把它桥接到活的员工库
    status: STATUS,
    recStatus: REC_STATUS,
    defaultProjects: defaultProjects,
    defaultTemplates: defaultTemplates,
    defaultRules: defaultRules,
    defaultMaterials: defaultMaterials,
    personById: function (id) {
      return PEOPLE.find(function (p) { return p.id === id; });
    }
  };
})(window);
