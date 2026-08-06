<script setup>
import RealBoardPreview from './RealBoardPreview.vue'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { toPng } from 'html-to-image'
import {
  ArrowLeftOutlined,
  CameraOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  SettingOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue'
import {
  readStep1Handoff,
  STEP1_HANDOFF_EVENT,
  clearStep1Handoff,
} from '../services/stepHandoff'
import { renderProblemHtml } from '../utils/mathText'
import {
  AGENT_B_DEFAULTS,
  AGENT_B_STAGE,
  generateAgentBBoardScript,
  generateAgentBSolutionDraft,
  getAgentBStageConnection,
  inspectAgentBReadiness,
  loadAgentBConfig,
  saveAgentBConfig,
} from '../services/agentBDraft'
import {
  userApiConfig,
  saveUserApiConfig,
  subscribeUserApiConfig,
} from '../lib/userApiConfig.js'
import {
  ensureHandwritingFont,
  HANDWRITING_FONTS,
  loadBoardTypographyConfig,
  saveBoardTypographyConfig,
} from '../board-tools/boardTypography'
import {
  createConfirmedSolutionSnapshot,
  createSolutionReviewDraft,
  deriveStep2Phase,
  validateSolutionReviewDraft,
} from '../services/step2Workflow'
import { validateAgentBSolutionCheck } from '../services/agentBDraftResult'
const DRAFT_STORAGE_KEY = 'qinghuabu.boardParamDraft.rows.v9'
localStorage.removeItem('qinghuabu.boardParamDraft.rows.v7')
localStorage.removeItem('qinghuabu.boardParamDraft.rows.v8')
const emit = defineEmits(['back-to-step1'])

const handoff = ref(readStep1Handoff())
const showGrid = ref(handoff.value?.showGrid ?? true)
const showGuides = ref(true)
const activeBoardPlan = computed(() => handoff.value?.boardPlan || null)
const typographyConfig = reactive(loadBoardTypographyConfig())
const activeRowKey = ref('')
const previewCaptureRef = ref(null)
const previewDataUrl = ref('')
const captureState = ref('idle')
const generationState = ref('idle')
const generationError = ref('')
const generatedModel = ref('')
const solutionExtraNote = ref('')
const scriptExtraNote = ref('')
const resolutionNote = ref('')
const generationStage = ref('')
const agentConfigOpen = ref(false)

const stageOptions = [
  { value: '题目', label: '题目' },
  { value: '分析', label: '分析' },
  { value: '解答', label: '解答' },
  { value: '答语', label: '答语' },
  { value: '总结', label: '总结' },
]

function emptyRow(partial = {}) {
  return {
    key: partial.key || `row-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    duration: partial.duration || '待程序预估',
    stage: partial.stage || '分析',
    notes: partial.notes || '',
    speech: partial.speech || '',
    board: partial.board || '',
    actionSpec: partial.actionSpec || '',
    timingStatus: partial.timingStatus || '',
    timingSource: partial.timingSource || '',
    speechCharacters: Number(partial.speechCharacters || 0),
    estimatedDurationMs: Number(partial.estimatedDurationMs || 0),
  }
}

function defaultRows() {
  return []
}

function belongsToCurrentHandoff(stored, currentHandoff = handoff.value) {
  if (!stored || !currentHandoff?.problemText) return false
  if (stored.problemText !== currentHandoff.problemText) return false
  return !stored.handoffConfirmedAt || stored.handoffConfirmedAt === currentHandoff.confirmedAt
}

function getStoredConfirmedSolution(stored) {
  if (!stored) return null
  if (stored.confirmedSolution) {
    const validation = validateAgentBSolutionCheck(stored.confirmedSolution)
    if (validation.ok && !validation.value.uncertainItems.length) return stored.confirmedSolution
  }
  if (stored.solutionConfirmed && stored.solutionCheck) {
    try {
      return createConfirmedSolutionSnapshot(createSolutionReviewDraft(stored.solutionCheck), {
        resolutionNote: stored.resolutionNote || '',
        confirmedAt: stored.updatedAt || '',
      })
    } catch {}
  }
  return null
}

function loadRows() {
  const h = handoff.value
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (belongsToCurrentHandoff(parsed, h) && Array.isArray(parsed?.rows) && parsed.rows.length) {
        return parsed.rows.map((row) => emptyRow(row))
      }
    }
  } catch {}
  return defaultRows()
}

const rows = ref(loadRows())

function loadSolutionCheck() {
  const h = handoff.value
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (belongsToCurrentHandoff(parsed, h) && parsed?.solutionCheck) return parsed.solutionCheck
  } catch {}
  return null
}

const solutionCheck = ref(loadSolutionCheck())
function loadSolutionReviewDraft() {
  const h = handoff.value
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (belongsToCurrentHandoff(parsed, h) && parsed?.solutionReviewDraft) {
      const draft = createSolutionReviewDraft(parsed.solutionReviewDraft)
      draft.originalUncertainItems = Array.isArray(parsed.solutionReviewDraft.originalUncertainItems)
        ? [...parsed.solutionReviewDraft.originalUncertainItems]
        : [...(solutionCheck.value?.uncertainItems || draft.uncertainItems)]
      return draft
    }
  } catch {}
  return createSolutionReviewDraft(solutionCheck.value)
}
function loadConfirmedSolution() {
  const h = handoff.value
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!belongsToCurrentHandoff(parsed, h)) return null
    return getStoredConfirmedSolution(parsed)
  } catch {}
  return null
}
function loadResolutionNote() {
  const h = handoff.value
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (belongsToCurrentHandoff(parsed, h)) return String(parsed.resolutionNote || '')
  } catch {}
  return ''
}
const solutionReviewDraft = ref(loadSolutionReviewDraft())
const confirmedSolution = ref(loadConfirmedSolution())
resolutionNote.value = loadResolutionNote()
let draftPersistenceEnabled = true

const columns = [
  { title: '时间', dataIndex: 'duration', key: 'duration', width: 130 },
  { title: '环节', dataIndex: 'stage', key: 'stage', width: 90 },
  { title: '注意事项', dataIndex: 'notes', key: 'notes', width: 150 },
  { title: '语音口播稿', dataIndex: 'speech', key: 'speech', width: 260 },
  { title: '板书内容', dataIndex: 'board', key: 'board', width: 400 },
  { title: '板书动作', dataIndex: 'actionSpec', key: 'actionSpec', width: 280 },
]

const problemHtml = computed(() =>
  renderProblemHtml(handoff.value?.problemText || ''),
)
const typeLabel = computed(
  () =>
    ({ geometry: '几何题', calculation: '计算运算题', word: '应用题', other: '其他' })[
      handoff.value?.problemType
    ] || handoff.value?.problemType || '几何题',
)
const focusLabel = computed(
  () =>
    ({
      geometry_diagram: '几何图解',
      calculation_process: '演算过程',
      relation_understanding: '关系理解',
      mixed: '综合',
    })[handoff.value?.boardFocus] || handoff.value?.boardFocus || '几何图解',
)

const topicAnchor = computed(() => handoff.value?.topicLayout?.question || null)

const agentConfig = reactive(loadAgentBConfig())
const agentAdvancedOpen = ref([])
const solutionReadiness = computed(() =>
  inspectAgentBReadiness({
    taskStage: AGENT_B_STAGE.SOLUTION_DRAFT,
    config: agentConfig,
    handoff: handoff.value,
    boardPlan: activeBoardPlan.value,
    previewDataUrl: previewDataUrl.value,
    rowsCount: rows.value.length,
  }),
)
const scriptReadiness = computed(() =>
  inspectAgentBReadiness({
    taskStage: AGENT_B_STAGE.BOARD_SCRIPT,
    config: agentConfig,
    handoff: handoff.value,
    boardPlan: activeBoardPlan.value,
    previewDataUrl: previewDataUrl.value,
    rowsCount: rows.value.length,
  }),
)
const agentSlotOptions = [
  { value: 'primary', label: '主用' },
  { value: 'backup1', label: '备用1' },
  { value: 'backup2', label: '备用2' },
]
const activeSolutionAgent = computed(() =>
  getAgentBStageConnection(agentConfig, AGENT_B_STAGE.SOLUTION_DRAFT),
)
const activeScriptAgent = computed(() =>
  getAgentBStageConnection(agentConfig, AGENT_B_STAGE.BOARD_SCRIPT),
)
const handoffReady = computed(() => Boolean(
  handoff.value?.problemText?.trim() &&
  handoff.value?.topicLayout?.question &&
  handoff.value?.boardPlan,
))
const currentPhase = computed(() => deriveStep2Phase({
  solutionCheck: solutionCheck.value,
  confirmedSolution: confirmedSolution.value,
  rows: rows.value,
  generationStage: generationStage.value,
  generationState: generationState.value,
}))
const solutionReviewValidation = computed(() =>
  validateSolutionReviewDraft(solutionReviewDraft.value, resolutionNote.value),
)

async function onHandwritingFontChange(fontId) {
  try {
    await ensureHandwritingFont(fontId)
    typographyConfig.fontId = fontId
    saveBoardTypographyConfig(typographyConfig)
    message.success('板书字体已更新')
  } catch (error) {
    message.error(error?.message || '板书字体加载失败')
  }
}

function refreshHandoff() {
  handoff.value = readStep1Handoff()
  showGrid.value = handoff.value?.showGrid ?? true
  previewDataUrl.value = ''
  rows.value = loadRows()
  solutionCheck.value = loadSolutionCheck()
  solutionReviewDraft.value = loadSolutionReviewDraft()
  confirmedSolution.value = loadConfirmedSolution()
  resolutionNote.value = loadResolutionNote()
}
function onHandoffEvent(e) {
  handoff.value = e?.detail || readStep1Handoff()
  showGrid.value = handoff.value?.showGrid ?? true
  previewDataUrl.value = ''
  rows.value = loadRows()
  solutionCheck.value = loadSolutionCheck()
  solutionReviewDraft.value = loadSolutionReviewDraft()
  confirmedSolution.value = loadConfirmedSolution()
  resolutionNote.value = loadResolutionNote()
}
onMounted(() => {
  ensureHandwritingFont(typographyConfig.fontId).catch(() => {})
  window.addEventListener(STEP1_HANDOFF_EVENT, onHandoffEvent)
  window.addEventListener('storage', refreshHandoff)
})
onUnmounted(() => {
  window.removeEventListener(STEP1_HANDOFF_EVENT, onHandoffEvent)
  window.removeEventListener('storage', refreshHandoff)
})

watch(
  [rows, solutionCheck, solutionReviewDraft, confirmedSolution, resolutionNote],
  ([rowValues, check, reviewDraft, confirmed, note]) => {
    if (!draftPersistenceEnabled) return
    localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        problemText: handoff.value?.problemText || '',
        handoffConfirmedAt: handoff.value?.confirmedAt || '',
        rows: rowValues,
        solutionCheck: check,
        solutionReviewDraft: reviewDraft,
        confirmedSolution: confirmed,
        solutionConfirmed: Boolean(confirmed),
        resolutionNote: note,
        updatedAt: new Date().toISOString(),
      }),
    )
  },
  { deep: true },
)

watch(
  [handoff, activeBoardPlan, showGrid, showGuides],
  () => {
    previewDataUrl.value = ''
    captureState.value = 'idle'
  },
  { deep: true, immediate: true },
)

function addRow() {
  rows.value.push(emptyRow({ stage: '分析' }))
}
function removeRow(key) {
  rows.value = rows.value.filter((r) => r.key !== key)
}
function saveDraft() {
  if (!rows.value.length) {
    message.warning('当前真题还没有生成书稿')
    return
  }
  message.success('7列表书稿已保存（本机）')
}
function saveAgentConfigAtPage() {
  // endpoint/model/temperature 走本页 localStorage；apiKey 走全局 userApiConfig
  Object.assign(agentConfig, saveAgentBConfig(agentConfig))
  saveUserApiConfig()
  message.success('Agent B 配置已保存（Key 全局生效）')
}

// 订阅全局 userApiConfig 变化（跨标签同步）—— 仅触发响应式更新
subscribeUserApiConfig(() => {})
async function capturePreview() {
  if (!handoffReady.value) {
    message.warning('请先从第1步带入题目')
    return ''
  }
  captureState.value = 'loading'
  generationError.value = ''
  try {
    await nextTick()
    await document.fonts?.ready
    const dataUrl = await toPng(previewCaptureRef.value, {
      cacheBust: true,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
    })
    previewDataUrl.value = dataUrl
    captureState.value = 'ready'
    message.success('真画布预览已截取')
    return dataUrl
  } catch (error) {
    captureState.value = 'error'
    generationError.value = error?.message || String(error)
    message.error('预览截取失败')
    return ''
  }
}
async function generateSolutionDraft() {
  if (generationState.value === 'loading') return
  saveAgentBConfig(agentConfig)
  generationStage.value = 'solution'
  generationState.value = 'loading'
  generationError.value = ''
  try {
    const image = previewDataUrl.value || (await capturePreview())
    if (!image) {
      generationState.value = captureState.value === 'error' ? 'error' : 'idle'
      return
    }
    const result = await generateAgentBSolutionDraft({
      config: agentConfig,
      handoff: handoff.value,
      boardPlan: activeBoardPlan.value,
      previewDataUrl: image,
      handwritingFontId: typographyConfig.fontId,
      extraNote: solutionExtraNote.value,
    })
    solutionCheck.value = result.solutionCheck
    solutionReviewDraft.value = createSolutionReviewDraft(result.solutionCheck)
    confirmedSolution.value = null
    resolutionNote.value = ''
    rows.value = []
    generatedModel.value = result.model || activeSolutionAgent.value.model
    generationState.value = 'ready'
    if (result.blockedByUncertainty) {
      message.warning('B 解题草案有待确认项，尚未进入剧本阶段')
    } else {
      message.success('B 解题草案已生成，请预览确认')
    }
  } catch (error) {
    generationState.value = 'error'
    generationError.value = error?.message || String(error)
    message.error(generationError.value)
  } finally {
    generationStage.value = ''
  }
}
function confirmSolution() {
  if (!solutionReviewDraft.value) {
    message.warning('请先生成 B 解题草案')
    return
  }
  if (!solutionReviewValidation.value.ok) {
    message.warning(solutionReviewValidation.value.error || '请先完成解法审核')
    return
  }
  confirmedSolution.value = createConfirmedSolutionSnapshot(solutionReviewDraft.value, {
    resolutionNote: resolutionNote.value,
    confirmedAt: new Date().toISOString(),
  })
  rows.value = []
  message.success('解法已确认并锁定')
}
async function regenerateSolutionDraft() {
  if (resolutionNote.value.trim()) solutionExtraNote.value = resolutionNote.value.trim()
  await generateSolutionDraft()
}
async function generateScript() {
  if (generationState.value === 'loading') return
  if (!confirmedSolution.value) {
    message.warning('请先确认解法')
    return
  }
  saveAgentBConfig(agentConfig)
  generationStage.value = 'script'
  generationState.value = 'loading'
  generationError.value = ''
  try {
    const image = previewDataUrl.value || (await capturePreview())
    if (!image) {
      generationState.value = captureState.value === 'error' ? 'error' : 'idle'
      return
    }
    const result = await generateAgentBBoardScript({
      config: agentConfig,
      handoff: handoff.value,
      boardPlan: activeBoardPlan.value,
      previewDataUrl: image,
      handwritingFontId: typographyConfig.fontId,
      confirmedSolution: confirmedSolution.value,
      solutionConfirmed: true,
      extraNote: scriptExtraNote.value,
    })
    rows.value = result.rows.map((row) => emptyRow(row))
    generatedModel.value = result.model || activeScriptAgent.value.model
    generationState.value = 'ready'
    message.success(`已按确认解法生成 ${rows.value.length} 行剧本`)
  } catch (error) {
    generationState.value = 'error'
    generationError.value = error?.message || String(error)
    message.error(generationError.value)
  } finally {
    generationStage.value = ''
  }
}
async function generateTable() {
  if (generationState.value === 'loading') return
  saveAgentBConfig(agentConfig)
  generationStage.value = 'table'
  generationState.value = 'loading'
  generationError.value = ''
  try {
    const image = previewDataUrl.value || (await capturePreview())
    if (!image) {
      generationState.value = captureState.value === 'error' ? 'error' : 'idle'
      return
    }
    const scriptResult = await generateAgentBBoardScript({
      config: agentConfig,
      handoff: handoff.value,
      boardPlan: activeBoardPlan.value,
      previewDataUrl: image,
      handwritingFontId: typographyConfig.fontId,
      extraNote: scriptExtraNote.value,
    })
    rows.value = scriptResult.rows.map((row) => emptyRow(row))
    generatedModel.value = scriptResult.model || activeScriptAgent.value.model
    generationState.value = 'ready'
    message.success(`已生成 ${rows.value.length} 行七列表`)
  } catch (error) {
    generationState.value = 'error'
    generationError.value = error?.message || String(error)
    message.error(generationError.value)
  } finally {
    generationStage.value = ''
  }
}
function onPickCoord(c) {
  const text =
    '起笔 表(' + c.refX + ',' + c.refY + ') → 画布(' + c.px + ',' + c.py + ')px / (' + c.xPct + ',' + c.yPct + ')%'
  navigator.clipboard?.writeText(text)
  message.success('已复制起笔坐标')
}

function back() {
  emit('back-to-step1')
}
function clearAndBack() {
  draftPersistenceEnabled = false
  clearStep1Handoff()
  rows.value = []
  solutionCheck.value = null
  solutionReviewDraft.value = null
  confirmedSolution.value = null
  resolutionNote.value = ''
  localStorage.removeItem(DRAFT_STORAGE_KEY)
  message.info('已清空，回第1步')
  emit('back-to-step1')
}
</script>

<template>
  <a-layout class="qh-page">
    <a-layout-header class="qh-page-header">
      <div class="qh-brand">
        <span class="qh-brand-mark">教学板书</span>
        <a-tag color="geekblue">第2步 · 板书参数书稿</a-tag>
        <a-typography-text type="secondary">生成并审核七列讲题执行表</a-typography-text>
      </div>
      <a-space>
        <a-button @click="back">
          <template #icon><ArrowLeftOutlined /></template>
          返回第1步
        </a-button>
        <a-button @click="agentConfigOpen = true">
          <template #icon><SettingOutlined /></template>
          Agent 设置
        </a-button>
        <a-button type="primary" :disabled="!rows.length" @click="saveDraft">
          <template #icon><SaveOutlined /></template>
          保存书稿
        </a-button>
      </a-space>
    </a-layout-header>

    <a-layout-content class="qh-page-content">
      <a-alert
        v-if="!handoffReady"
        type="warning"
        show-icon
        class="top-alert"
        message="等待第1步交接"
        description="第1步确认快照不完整；请返回原步骤重新预览确认，本页不做默认补算。"
      />

      <a-row :gutter="[16, 16]">
        <a-col :xs="{ span: 24, order: 2 }" :xl="{ span: 9, order: 1 }">
          <a-card :bordered="false" class="preview-card">
            <template #title>
              <span>真画布预览</span>
              <a-typography-text type="secondary" class="sub">完整继承第1步</a-typography-text>
            </template>
            <template #extra>
              <a-space>
                <a-switch v-model:checked="showGrid" checked-children="网格" un-checked-children="网格" size="small" />
                <a-switch v-model:checked="showGuides" checked-children="分区" un-checked-children="分区" size="small" />
              </a-space>
            </template>
            <a-descriptions size="small" :column="{ xs: 1, sm: 2, lg: 3 }" class="handoff-meta">
              <a-descriptions-item label="数据来源">
                <a-tag color="success">第1步真识别交接</a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="题型">{{ typeLabel }}</a-descriptions-item>
              <a-descriptions-item label="板书侧重">{{ focusLabel }}</a-descriptions-item>
              <a-descriptions-item label="题目锚">
                <template v-if="topicAnchor">
                  ({{ Number(topicAnchor.x).toFixed(1) }}, {{ Number(topicAnchor.y).toFixed(1) }})%
                </template>
                <a-tag v-else color="error">缺失</a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="四标签">
                <a-tag :color="handoff?.boardPlan ? 'success' : 'warning'">
                  {{ handoff?.boardPlan ? '已确认' : '缺失' }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="板书字体">
                <a-select
                  :value="typographyConfig.fontId"
                  style="min-width: 180px"
                  @change="onHandwritingFontChange"
                >
                  <a-select-option v-for="font in HANDWRITING_FONTS" :key="font.id" :value="font.id">
                    <span :style="{ fontFamily: font.family }">{{ font.label }}</span>
                  </a-select-option>
                </a-select>
              </a-descriptions-item>
              <a-descriptions-item label="原图层">
                {{ handoff?.keepOriginal && handoff?.sourceImageDataUrl ? '已继承' : '不需要' }}
              </a-descriptions-item>
              <a-descriptions-item label="画布">1726 × 980</a-descriptions-item>
            </a-descriptions>

            <div v-if="handoffReady" ref="previewCaptureRef" class="preview-capture">
              <RealBoardPreview
                :problem-text="handoff?.problemText || ''"
                :board-plan="activeBoardPlan"
                :topic-layout="handoff?.topicLayout"
                :show-all-labels="true"
                :show-grid="showGrid"
                :show-zone-guides="showGuides"
                :source-image-url="handoff?.sourceImageDataUrl || ''"
                :keep-original="Boolean(handoff?.keepOriginal)"
                interactive
                @pick-coord="onPickCoord"
              />
            </div>

            <div class="preview-actions">
              <a-space wrap>
                <a-button :loading="captureState === 'loading'" :disabled="!handoffReady" @click="capturePreview">
                  <template #icon><CameraOutlined /></template>
                  截取当前预览
                </a-button>
                <a-tag :color="previewDataUrl ? 'success' : 'default'">
                  {{ previewDataUrl ? '预览已送入 Agent B' : '尚未截取' }}
                </a-tag>
              </a-space>
              <a-typography-text type="secondary" class="coord-tip">
                点击画布可复制起笔坐标
              </a-typography-text>
            </div>
          </a-card>
        </a-col>

        <a-col :xs="{ span: 24, order: 1 }" :xl="{ span: 15, order: 2 }">
          <a-card :bordered="false" class="table-card main-table-card">
            <template #title>
              <span>七列讲题执行表</span>
              <a-typography-text type="secondary" class="sub">
                时间 | 环节 | 注意事项 | 语音口播稿 | 分析区动作板书 | 解题区板书 | 板书动作
              </a-typography-text>
            </template>
            <template #extra>
              <a-space wrap>
                <a-button
                  type="primary"
                  :loading="generationState === 'loading' && generationStage === 'table'"
                  :disabled="!handoffReady"
                  @click="generateTable"
                >
                  <template #icon><RobotOutlined /></template>
                  生成七列表
                </a-button>
                <a-button size="small" type="dashed" @click="addRow">
                  <template #icon><PlusOutlined /></template>
                  补一行
                </a-button>
                <a-button size="small" danger :disabled="!activeRowKey" @click="removeRow(activeRowKey)">
                  <template #icon><DeleteOutlined /></template>
                  删除选中行
                </a-button>
              </a-space>
            </template>

            <a-table
              :columns="columns"
              :data-source="rows"
              :pagination="false"
              :scroll="{ x: 1380, y: 520 }"
              size="small"
              bordered
              row-key="key"
              :row-class-name="(record) => (record.key === activeRowKey ? 'row-active' : '')"
              :custom-row="(record) => ({ onClick: () => (activeRowKey = record.key) })"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.dataIndex === 'duration'">
                  <a-input v-model:value="record.duration" placeholder="待程序预估" />
                </template>
                <template v-else-if="column.dataIndex === 'stage'">
                  <a-select v-model:value="record.stage" style="width: 100%" :options="stageOptions" />
                </template>
                <template v-else-if="column.dataIndex === 'notes'">
                  <a-textarea v-model:value="record.notes" :rows="3" placeholder="教学重点、易错点、单位" />
                </template>
                <template v-else-if="column.dataIndex === 'speech'">
                  <a-textarea v-model:value="record.speech" :rows="4" placeholder="可直接朗读的语音口播稿" />
                </template>
                <template v-else-if="column.dataIndex === 'board'">
                  <a-textarea v-model:value="record.board" :rows="4" placeholder="本行板书内容描述（落区由 actionSpec 的 region 决定）" />
                </template>
                <template v-else-if="column.dataIndex === 'actionSpec'">
                  <a-textarea v-model:value="record.actionSpec" :rows="4" placeholder="触发语句、工具、顺序、定位和颜色" />
                </template>
              </template>
              <template #emptyText>
                <a-empty description="点击“生成七列表”，或先补一行手动填写" />
              </template>
            </a-table>

            <a-alert v-if="generationError" type="error" show-icon :message="generationError" class="agent-error" />
            <div class="table-foot">
              <a-typography-text type="secondary">
                画布 1726 × 980 · 口播按 170 字/分钟预估 · 所有板书动作单手互斥
              </a-typography-text>
              <a-typography-text v-if="generatedModel" type="secondary">
                {{ generatedModel }}<template v-if="rows.length"> · {{ rows.length }} 行</template>
              </a-typography-text>
            </div>
          </a-card>
        </a-col>
      </a-row>

      <a-drawer
        v-model:open="agentConfigOpen"
        title="Agent B 设置"
        placement="right"
        :width="560"
      >
        <template #extra>
          <a-button type="primary" @click="saveAgentConfigAtPage">保存配置</a-button>
        </template>
        <a-form :model="agentConfig" layout="vertical" class="agent-form">
          <a-tabs size="small" class="agent-config-tabs">
            <a-tab-pane key="solution" tab="B-A 解题">
              <a-segmented v-model:value="agentConfig.solutionAgentSlot" :options="agentSlotOptions" block class="agent-slot-switch" />
              <div class="readiness-list">
                <div v-for="check in solutionReadiness.checks" :key="check.id" class="readiness-item">
                  <CheckCircleFilled v-if="check.pass" class="check-ok" />
                  <CloseCircleFilled v-else class="check-missing" />
                  <span>{{ check.need }}</span>
                  <a-typography-text type="secondary">{{ check.have }}</a-typography-text>
                </div>
              </div>
              <a-form-item label="Endpoint"><a-input v-model:value="activeSolutionAgent.endpoint" /></a-form-item>
              <a-form-item label="Model"><a-input v-model:value="activeSolutionAgent.model" /></a-form-item>
              <a-form-item label="API Key (用户自填)">
                <a-input-password
                  v-model:value="userApiConfig.apiKey"
                  placeholder="sk-...（仅存浏览器）"
                  autocomplete="off"
                />
                <a-typography-text type="secondary" style="font-size:12px">
                  Key 全局共享，所有 Agent B 阶段（B-A / B-B / 新线）共用同一份
                </a-typography-text>
              </a-form-item>
              <a-form-item label="Temperature">
                <a-input-number v-model:value="activeSolutionAgent.temperature" :min="0" :max="1" :step="0.1" style="width: 100%" />
              </a-form-item>
              <a-form-item label="本题补充要求">
                <a-textarea v-model:value="solutionExtraNote" :auto-size="{ minRows: 2, maxRows: 4 }" />
              </a-form-item>
              <a-collapse v-model:activeKey="agentAdvancedOpen" ghost class="agent-advanced">
                <a-collapse-panel key="solution-prompt" header="B-A 系统提示词">
                  <a-textarea v-model:value="agentConfig.solutionPrompt" :auto-size="{ minRows: 8, maxRows: 16 }" />
                  <a-button type="link" size="small" @click="agentConfig.solutionPrompt = AGENT_B_DEFAULTS.solutionPrompt">恢复 B-A 默认提示词</a-button>
                </a-collapse-panel>
              </a-collapse>
            </a-tab-pane>
            <a-tab-pane key="script" tab="B-B 剧本">
              <a-segmented v-model:value="agentConfig.scriptAgentSlot" :options="agentSlotOptions" block class="agent-slot-switch" />
              <div class="readiness-list">
                <div v-for="check in scriptReadiness.checks" :key="check.id" class="readiness-item">
                  <CheckCircleFilled v-if="check.pass" class="check-ok" />
                  <CloseCircleFilled v-else class="check-missing" />
                  <span>{{ check.need }}</span>
                  <a-typography-text type="secondary">{{ check.have }}</a-typography-text>
                </div>
              </div>
              <a-form-item label="Endpoint"><a-input v-model:value="activeScriptAgent.endpoint" /></a-form-item>
              <a-form-item label="Model"><a-input v-model:value="activeScriptAgent.model" /></a-form-item>
              <a-form-item label="API Key (用户自填)">
                <a-input-password
                  v-model:value="userApiConfig.apiKey"
                  placeholder="sk-...（仅存浏览器）"
                  autocomplete="off"
                />
                <a-typography-text type="secondary" style="font-size:12px">
                  Key 全局共享，所有 Agent B 阶段（B-A / B-B / 新线）共用同一份
                </a-typography-text>
              </a-form-item>
              <a-form-item label="Temperature">
                <a-input-number v-model:value="activeScriptAgent.temperature" :min="0" :max="1" :step="0.1" style="width: 100%" />
              </a-form-item>
              <a-form-item label="本题补充要求">
                <a-textarea v-model:value="scriptExtraNote" :auto-size="{ minRows: 2, maxRows: 4 }" />
              </a-form-item>
              <a-collapse v-model:activeKey="agentAdvancedOpen" ghost class="agent-advanced">
                <a-collapse-panel key="script-prompt" header="B-B 系统提示词">
                  <a-textarea v-model:value="agentConfig.scriptPrompt" :auto-size="{ minRows: 8, maxRows: 16 }" />
                  <a-button type="link" size="small" @click="agentConfig.scriptPrompt = AGENT_B_DEFAULTS.scriptPrompt">恢复 B-B 默认提示词</a-button>
                </a-collapse-panel>
              </a-collapse>
            </a-tab-pane>
          </a-tabs>
        </a-form>
      </a-drawer>

    </a-layout-content>
  </a-layout>
</template>

<style scoped>
.top-alert { margin-bottom: 16px; }
.phase-bar { margin-bottom: 16px; }
.preview-card,
.table-card {
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(31, 45, 61, 0.05);
}
.table-card { margin-top: 16px; }
.work-panel {
  min-height: 100%;
  padding: 18px;
  border: 1px solid #e4e9f0;
  border-radius: 8px;
  background: #fff;
}
.work-panel-head,
.work-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.work-panel-head { margin-bottom: 14px; }
.work-panel-head :deep(.ant-typography) { margin: 0; }
.compact-readiness { max-height: 280px; }
.sub { margin-left: 8px; font-size: 12px; }
.handoff-meta { margin-bottom: 12px; }
.preview-capture {
  width: 100%;
  min-height: 420px;
  display: grid;
  place-items: center;
  padding: 12px;
  border: 1px solid #e4e9f0;
  border-radius: 8px;
  background: #f6f8fb;
}
.preview-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.coord-tip { font-size: 12px; }
.readiness-list {
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  background: #fafbfc;
}
.readiness-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  font-size: 12px;
}
.readiness-item :deep(.ant-typography) { font-size: 11px; }
.check-ok { color: #389e0d; }
.check-missing { color: #d46b08; }
.agent-form :deep(.ant-form-item) { margin-bottom: 10px; }
.agent-config-tabs { margin-top: -4px; }
.agent-slot-switch { margin-bottom: 10px; }
.agent-advanced { margin: 2px -12px 10px; }
.agent-advanced :deep(.ant-collapse-header) { padding-block: 8px !important; }
.agent-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.agent-error { margin-top: 12px; }
.generated-meta { display: block; margin-top: 10px; font-size: 12px; }
.table-foot {
  display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 12px;
}
:deep(.row-active) td { background: #eff6ff !important; }

@media (max-width: 768px) {
  .preview-capture { min-height: 240px; padding: 8px; }
  .preview-actions,
  .table-foot,
  .work-actions { align-items: stretch; flex-direction: column; }
  .readiness-item { grid-template-columns: 16px minmax(0, 1fr); }
  .readiness-item :deep(.ant-typography) { grid-column: 2; }
}
</style>
