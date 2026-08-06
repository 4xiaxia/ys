# PROJECT_STATE.md — 实时真相
> 最后更新：2026-08-06 | 维护人：ZCode

## 项目一句话
小学数学「考题讲解视频」生产工作台。用户上传/输入题目 → 多模态LLM识别 → 真画布落位 → Agent B 生成七列执行表（时间/环节/旁注/口播/板书/动作稿），供后续 Agent C 执行渲染输出教学视频。

---

## 当前里程碑状态

| 阶段 | 状态 | 说明 |
|------|------|------|
| Step1 题目识别 | ✅ 功能完整 | 上传/文字→多模态识别→贴上真画布→四区布局→交接handoff |
| Step2 Agent B 七列表 | ✅ 功能完整 | 读handoff→截真画布→调/api/agent-b-v2/generate→contract校验→时间线预估 |
| Agent B v1（旧双阶段） | 🟡 保留但废弃路径 | agentBDraft.js/BoardParamDraft.vue 仍存在，不在主路由 |
| Agent C 执行层 | ❌ 未实现 | 工具定义齐全（boardToolCatalog），执行器尚未建设 |
| 视频导出 | ❌ 未实现 | - |

---

## 技术栈快照

```
Vue 3.5 + Vite 8.x + Ant Design Vue 4.x
渲染：KaTeX（板书数学）+ RoughJS（手绘图形）+ rough-notation（划重点）
截图：html-to-image（toPng）
字体：品方桥木手写体（public/fonts/）
持久化：localStorage（主）+ IndexedDB（副，simpleIndexedDb.js）
代理层：Vite 自定义中间件插件（vite.config.js + server/agentBV2ProxyPlugin.js）
API密钥：全部用户自填，存 localStorage qinghuabu.userApiConfig.v1，不写死
```

---

## 主路由（实际生效）

```
App.vue
  └─ DirectFlow.vue          ← 唯一入口
       ├─ Step1Entry.vue      ← 阶段1：识别+落位+确认
       └─ AgentBDirect.vue    ← 阶段2：七列表生成+编辑
```

---

## localStorage Key 清单

| Key | 内容 | 维护者 |
|-----|------|--------|
| `qinghuabu.userApiConfig.v1` | apiKey / endpoint / model（全局共享） | userApiConfig.js |
| `qinghuabu.step1.toBoardDraft.handoff` | Step1→Step2 交接对象 | stepHandoff.js |
| `qinghuabu.agentB.v2.config` | Agent B v2 config（温度等） | service.js |
| `qinghuabu.agentB.v2.rows.v3` | 七列表缓存（按题文匹配） | service.js |
| `qinghuabu.step1.agentConfig` | Step1局部偏好（能力/自动识别） | Step1Entry.vue |

---

## API 端点清单

| 路由 | 超时 | 插件位置 | 用途 |
|------|------|----------|------|
| `POST /api/recognition/problem` | 30s | vite.config.js inline | 多模态识别题目 |
| `POST /api/agent-b/board-draft` | 60s | vite.config.js inline | 旧v1双阶段（废弃路径） |
| `POST /api/agent-b-v2/generate` | 90s | server/agentBV2ProxyPlugin.js | 主路径七列表生成 |

---

## 核心数据结构

### Handoff（Step1→Step2交接）
```js
{
  problemText, problemType, boardFocus, keepOriginal, imageKind,
  hasSourceImage, sourceImageName, sourceImageDataUrl,
  topicLayout: { topicLabel, question, image, keepOriginal },
  boardPlan: { question, analysis, solution, summary, canvasW, canvasH },
  showGrid, previewDataUrl, confirmedAt,
  relatedKnowledge: [...],   // 最多6条知识点
}
```

### 七列表Row
```js
{
  duration: '待程序预估',   // → 程序预估后变为 '预计 M:SS—M:SS'
  stage: '题目|分析|解答|答语|总结',
  notes: '教学重点/易错点',
  speech: '口播稿（TTS可读）',
  board: '板书内容描述（含坐标标记）',
  actionSpec: [{ cueText, action: {...} } | { cueText, capabilityGap: {...} }]
}
```

---

## 文档索引
- `ENGINEERING_LOG.md` — 工作日志
- `DECISIONS.md` — 决策记录
- `项目实时架构模块图.md` — 系统全景 + 施工进展
- `doc/技术开发说明.md` — 模块详细说明（待整合）
