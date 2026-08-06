# DECISIONS.md — 决策溯源 + 坑点记录
> 更新：2026-08-06

---

## D-001 APIKey 全前端用户自填，不走 .env

**决策**：所有 apiKey/endpoint/model 由用户在前端填写，存 `qinghuabu.userApiConfig.v1`（localStorage），服务端代理只做透传，不读任何环境变量。

**依据**：避免密钥硬编码进代码；同一套代码多用户使用不同账号；`.env.example` 已明确注释说明。

**影响**：`vite.config.js` 和 `agentBV2ProxyPlugin.js` 均从请求体读取 `apiKey/endpoint/model`，无服务端密钥管理。

---

## D-002 抛弃 Agent B v1 双阶段，切换至 V2 单阶段

**决策**：主路由走 `AgentBDirect.vue` + `/api/agent-b-v2/generate`，旧 `BoardParamDraft.vue` + `/api/agent-b/board-draft` 保留但不在主路由。

**依据**：双阶段调用两次LLM成本高；V2单阶段 + 真画布预览图注入质量更稳定；contract 校验更严格。

**遗留风险**：`agentBDraft.js`（24KB）和 `BoardParamDraft.vue`（34KB）仍在仓库，可能引起混淆。建议后续评估是否归档到 `_deprecated/`。

---

## D-003 真画布截图注入 Agent B

**决策**：生成七列表前先用 `html-to-image` 截取带网格的真画布 PNG，随请求传给 Agent B。

**依据**：Agent B 需要看到真实画布布局（四区坐标、题目位置）才能准确生成 `board` 字段的坐标标记。

**注意**：截图失败不阻断流程，降级为空串继续生成（有警告日志）。

---

## D-004 几何题 contract 强制检查分析区画图

**决策**：`validateAgentBV2Rows()` 对 `geometry` 题型额外检查：至少一个分析行要使用注册的绘图工具（`draw/rough-*`）。

**依据**：几何题不画图等于没讲；prompt 第五章也明确要求"先画再说"。

**坑点**：模型有时用 `capabilityGap` 代替 `draw`，被 contract 拦截。prompt 已在第五章明确禁止此做法。

---

## D-005 口播时间线基准：170字/分钟

**决策**：`speechTiming.js` 固定语速 170字/分钟 = 353ms/字，用于 `applyAgentBV2Timeline()` 预估每行时间区间。

**依据**：小学数学讲解语速参考值，非精确，为估算用。`duration` 字段最终值写 `预计 M:SS—M:SS` 格式。

---

## D-006 板书数学校验默认软模式（不卡死生成）

**决策**：`validateAgentBBoardRows(rows, { hardFail: false })` 软校验，只警告不抛错。

**依据**：七列表能出比完美更重要；硬校验导致用户反复重试体验差。

**坑点**：软校验警告会记录在 `boardMathWarnings` 数组中，UI 当前未展示，后续可考虑显示给用户。

---

## D-007 LocalStorage + IndexedDB 双持久化

**决策**：七列表和配置同时写 localStorage（快速同步读取）和 IndexedDB（容量大，跨会话稳定）。

**依据**：localStorage 容量限制约5MB，大七列表可能溢出；IndexedDB 作保底。

**加载顺序**：`onMounted` 先从 localStorage 同步读，再异步从 IndexedDB 恢复更新；以 IndexedDB 为准。

---

## 踩坑笔记

| 编号 | 问题 | 解法 |
|------|------|------|
| B-001 | 纯文字题图被识别后仍带原图进画布 | Step1Entry 增加 `imageKind` 硬边界：`text_only` → `keepOriginal=false` |
| B-002 | 横图题目区宽度撑满导致三区无空间 | `isLandscape` 检测，横图走上下布局（`landscape-top-image`） |
| B-003 | 模型返回 board 字段有旧版占位文本 | contract.js `EMPTY_BOARD_TEXTS` 集合向后兼容清理 |
| B-004 | Agent B 偶尔漏写 actionSpec 字段 | contract 自动补空数组，不卡死整表 |
| B-005 | 截图时字体未加载导致黑块 | `useBoardCapture` 等 `document.fonts.ready` + 两次 `nextTick` |
