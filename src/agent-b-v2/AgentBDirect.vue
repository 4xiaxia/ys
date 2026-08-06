<script setup>
/* @qh-core LANE=B-V2 POINT=UI_WORKBENCH seven-col table primary */
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { toPng } from 'html-to-image'
import { message } from 'ant-design-vue'
import {
  CameraOutlined,
  SaveOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue'
import RealBoardPreview from '../components/RealBoardPreview.vue'
import QhPageHeader from '../components/QhPageHeader.vue'
import { getAgentBoardToolCatalog } from '../board-tools/boardToolCatalog.js'
import { CANVAS_W, CANVAS_H } from '../utils/canvasCoords.js'
import {
  HANDWRITING_FONTS,
  ensureHandwritingFont,
  loadBoardTypographyConfig,
  saveBoardTypographyConfig,
} from '../board-tools/boardTypography.js'
import { readStep1Handoff, isCompleteStep1Handoff } from '../services/stepHandoff.js'
import {
  generateAgentBV2Rows,
  loadAgentBV2Config,
  loadAgentBV2ConfigFromIdb,
  loadAgentBV2Rows,
  loadAgentBV2RowsFromIdb,
  saveAgentBV2Config,
  saveAgentBV2ConfigToIdb,
  saveAgentBV2Rows,
  saveAgentBV2RowsToIdb,
} from './service.js'
import { AGENT_B_V2_SYSTEM_PROMPT } from './prompt.js'
import {
  userApiConfig,
  saveUserApiConfig,
  isUserApiReady,
  subscribeUserApiConfig,
} from '../lib/userApiConfig.js'

const emit = defineEmits(['back-to-step1'])
const handoff = ref(readStep1Handoff())
const config = reactive(loadAgentBV2Config())
const typography = reactive(loadBoardTypographyConfig())
const rows = ref(loadAgentBV2Rows(handoff.value))
const previewCaptureRef = ref(null)
const previewDataUrl = ref('')
const extraNote = ref('')
const state = ref('idle')
const errorText = ref('')
const generatedModel = ref('')
const settingsOpen = ref(false)
const toolsOpen = ref(false)
const apiCollapseActiveKey = ref([])
const dispatchTimeIso = ref(new Date().toISOString())
const toolCatalog = getAgentBoardToolCatalog()

const registeredToolIds = new Set(toolCatalog.tools.map((tool) => tool.id))
const toolReferenceRows = [
  {
    key: 'underline',
    tool: 'rough-notation',
    action: 'underline',
    label: '下划线',
    usage: '在已有原文下画线；原文必须逐字一致',
  },
  {
    key: 'highlight',
    tool: 'rough-notation',
    action: 'highlight',
    label: '高亮',
    usage: '高亮已有原文；原文必须逐字一致',
  },
  {
    key: 'rough-line',
    tool: 'rough-line',
    label: '辅助线',
    usage: '分析/解题区画线；设计像素坐标',
  },
  {
    key: 'rough-arrow',
    tool: 'rough-arrow',
    label: '箭头',
    usage: '分析/解题区箭头；设计像素坐标',
  },
  {
    key: 'rough-rect',
    tool: 'rough-rect',
    label: '矩形',
    usage: '分析/解题区矩形框',
  },
  {
    key: 'rough-ellipse',
    tool: 'rough-ellipse',
    label: '椭圆',
    usage: '分析/解题区圆或椭圆',
  },
  {
    key: 'rough-polygon',
    tool: 'rough-polygon',
    label: '多边形',
    usage: '分析/解题区多边形',
  },
].filter((item) => registeredToolIds.has(item.tool))

const stageAccentColors = {
  '题目': '#1677ff',
  '分析': '#fa8c16',
  '解答': '#52c41a',
  '答语': '#13c2c2',
  '总结': '#722ed1',
}

const columns = [
  { title: '时间', key: 'duration', width: 90, fixed: 'left' },
  { title: '环节', key: 'stage', width: 80, fixed: 'left' },
  { title: '语音口播稿', key: 'speech', width: 300 },
  { title: '板书内容', key: 'board', width: 460 },
  { title: '板书动作', key: 'actionSpec', width: 110 },
  { title: '操作', key: 'operations', width: 100, fixed: 'right' },
]

const tableRows = computed(() => rows.value.map((row, index) => ({ ...row, _rowKey: `v2-${index}` })))
const problemTypeLabel = computed(() => ({
  geometry: '几何题',
  calculation: '计算题',
  word: '应用题',
}[handoff.value?.problemType] || handoff.value?.problemType || '未确认'))
const pureTextLabel = computed(() => (handoff.value?.imageKind || 'text_only') === 'text_only' ? '是' : '否')
const boardFocusLabel = computed(() => ({
  geometry_diagram: '几何图解',
  calculation_process: '演算过程',
  relation_understanding: '关系理解',
  mixed: '综合分析',
}[handoff.value?.boardFocus] || handoff.value?.boardFocus || '未确认'))
const relatedKnowledge = computed(() => Array.isArray(handoff.value?.relatedKnowledge)
  ? handoff.value.relatedKnowledge
  : [])
const previewStatusLabel = computed(() => previewDataUrl.value ? '已截取' : '生成时自动截取（可先预览）')
const dispatchTimeLabel = computed(() => formatDisplayTime(dispatchTimeIso.value))
const handoffFlowSteps = computed(() => [
  { title: '识别题目', status: 'finish', description: '第1步已确认' },
  { title: '判断题型', status: handoff.value?.problemType ? 'finish' : 'wait', description: problemTypeLabel.value },
  { title: '画布排版', status: handoff.value?.boardPlan ? 'finish' : 'wait', description: '真画布与四区布局' },
  {
    title: '知识关联',
    status: relatedKnowledge.value.length ? 'finish' : 'wait',
    description: relatedKnowledge.value.length ? `${relatedKnowledge.value.length} 条可选参考` : '可选，按题目判断',
  },
  { title: '组装输入', status: 'finish', description: '题目、图片、布局、工具' },
  {
    title: '待发送生成',
    status: state.value === 'generating' ? 'process' : rows.value.length ? 'finish' : 'wait',
    description: state.value === 'generating'
      ? '正在生成 Agent B 七列表'
      : rows.value.length
        ? `已生成 ${rows.value.length} 行`
        : '准备就绪 · 点击生成',
  },
])

function formatDisplayTime(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.valueOf()) ? String(value || '') : date.toLocaleString('zh-CN', { hour12: false })
}

function refreshDispatchTime() {
  dispatchTimeIso.value = new Date().toISOString()
}

async function persistAgentConfig() {
  // 本页只持久化 endpoint/model/temperature；apiKey 由 userApiConfig 统一管理
  Object.assign(config, saveAgentBV2Config(config))
  saveUserApiConfig({
    endpoint: userApiConfig.endpoint,
    model: userApiConfig.model,
  })
  try {
    await saveAgentBV2ConfigToIdb(config)
  } catch (error) {
    console.warn('Agent B 配置写入 IndexedDB 失败', error)
  }
}

async function persistTypographyConfig() {
  saveBoardTypographyConfig(typography)
}

async function persistRows() {
  saveAgentBV2Rows(handoff.value, rows.value)
  try {
    await saveAgentBV2RowsToIdb(handoff.value, rows.value)
  } catch (error) {
    console.warn('七列表写入 IndexedDB 失败', error)
  }
}

// 订阅全局 userApiConfig 变化（跨标签同步）—— 无业务回调，仅触发响应式更新
subscribeUserApiConfig(() => {})

onMounted(async () => {
  refreshDispatchTime()
  try {
    const [storedConfig, storedRows] = await Promise.all([
      loadAgentBV2ConfigFromIdb(),
      loadAgentBV2RowsFromIdb(handoff.value),
    ])
    if (storedConfig) Object.assign(config, saveAgentBV2Config(storedConfig))
    if (storedRows.length) {
      rows.value = storedRows
      saveAgentBV2Rows(handoff.value, rows.value)
    }
  } catch (error) {
    console.warn('Agent B IndexedDB 恢复失败', error)
  }
})

function updateRow(index, field, value) {
  rows.value[index] = { ...rows.value[index], [field]: value }
}

function insertRowAfter(index) {
  const newRow = {
    duration: '待程序预估',
    stage: rows.value[index]?.stage || '分析',
    notes: '（手动补充）',
    speech: '',
    board: '',
    actionSpec: [],
  }
  rows.value.splice(index + 1, 0, newRow)
  persistRows()
  message.success('已在下方插入空白行，快来写下补充内容吧 ╰(๑◕ ▿ ◕๑)╯')
}

function deleteRow(index) {
  if (rows.value.length <= 1) {
    message.warning('不能全部删完哦，最少要保留一行内容哈 ฅ(⌯꒦ິ³꒦ິ⌯)ฅ')
    return
  }
  rows.value.splice(index, 1)
  persistRows()
  message.success('已成功删除该行 ٩(｡•ω•｡)و')
}

function actionLabel(entry) {
  const action = entry?.action
  if (!action) return '能力缺口'
  return [action.tool, action.action].filter(Boolean).join(' · ')
}

function actionContent(entry) {
  if (entry?.capabilityGap) return entry.capabilityGap.need
  const action = entry?.action || {}
  return action.content || action.target?.exactText || entry?.cueText || ''
}

async function capturePreview({ quiet = false } = {}) {
  state.value = 'capturing'
  errorText.value = ''
  try {
    await nextTick()
    await document.fonts?.ready
    previewDataUrl.value = await toPng(previewCaptureRef.value, {
      cacheBust: true,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
    })
    state.value = 'idle'
    if (!quiet) message.success('真画布预览已更新')
    return previewDataUrl.value
  } catch (error) {
    state.value = 'error'
    errorText.value = error?.message || String(error)
    // quiet 只压 UI 成功提示，不压错误日志——根本原因必须可见
    console.error('[AgentBDirect] toPng 失败，完整错误：', error)
    console.error('[AgentBDirect] 截图目标元素：', previewCaptureRef.value)
    message.error('真画布预览截取失败')
    return ''
  }
}

async function generateRows() {
  if (state.value === 'generating') return
  // 完整度只做软提示，不卡死生成：第1步以能运行为主，审核标准不挡主路径
  if (!isCompleteStep1Handoff(handoff.value)) {
    message.warning('分析生成中，请耐心等待，如遇到卡顿可重新尝试仍继续生成；请以真画布与题型为准核对')
  }
  state.value = 'generating'
  errorText.value = ''
  try {
    refreshDispatchTime()
    await persistAgentConfig()
    Object.assign(typography, saveBoardTypographyConfig(typography))
    await ensureHandwritingFont(typography.fontId)
    const image = await capturePreview({ quiet: true })
    if (!image) console.warn('[AgentBDirect] 截图失败，不含预览图继续生成')
    state.value = 'generating'
    const result = await generateAgentBV2Rows({
      config,
      handoff: handoff.value,
      previewDataUrl: image,
      fontId: typography.fontId,
      extraNote: extraNote.value,
      currentTime: dispatchTimeIso.value,
    })
    rows.value = result.rows
    generatedModel.value = result.model
    await persistRows()
    state.value = 'ready'
    message.success(`已生成 ${rows.value.length} 行七列表`)
  } catch (error) {
    state.value = 'error'
    errorText.value = error?.message || String(error)
    message.error(errorText.value)
  }
}

async function saveRows() {
  await persistAgentConfig()
  await persistRows()
  message.success('七列表已保存')
}
</script>

<template>
  <a-layout class="qh-page">
    <QhPageHeader
      step-label="第 2 步 · Agent B"
      subtitle="题目信息 → 七列表"
      show-back
      @back="emit('back-to-step1')"
    >
      <template #actions>
        <a-button title="更新真画布预览" :loading="state === 'capturing'" @click="capturePreview()">
          <template #icon><CameraOutlined /></template>
          预览
        </a-button>
        <a-button title="可用工具" @click="toolsOpen = !toolsOpen">
          <template #icon><ToolOutlined /></template>
          工具
        </a-button>
        <a-button title="Agent B 设置" @click="settingsOpen = !settingsOpen">
          <template #icon><SettingOutlined /></template>
          设置
        </a-button>
        <a-button :disabled="!rows.length" @click="saveRows">
          <template #icon><SaveOutlined /></template>
          保存
        </a-button>
      </template>
    </QhPageHeader>

    <a-layout-content class="qh-page-content">
      <a-space direction="vertical" size="middle" style="width:100%">
        <a-card title="Agent B 输入交接台" class="qh-surface-card" size="small">
          <a-typography-text type="secondary">本次发给 Agent B</a-typography-text>
          <a-steps
            class="qh-handoff-steps"
            size="small"
            :items="handoffFlowSteps"
          />
          <a-space wrap size="small" style="margin: 4px 0">
            <a-tag>题目 1 道</a-tag>
            <a-tag>画布分区 {{ handoff?.boardPlan ? 4 : 0 }} 个</a-tag>
            <a-tag>知识参考 {{ relatedKnowledge.length }} 条</a-tag>
            <a-tag>工具能力 {{ toolCatalog.tools.length }} 项</a-tag>
          </a-space>
          <a-descriptions bordered size="small" :column="2">
            <a-descriptions-item label="题目类型">{{ problemTypeLabel }}</a-descriptions-item>
            <a-descriptions-item label="是否纯文本">{{ pureTextLabel }}</a-descriptions-item>
            <a-descriptions-item label="板书侧重">{{ boardFocusLabel }}</a-descriptions-item>
            <a-descriptions-item label="发送时间">{{ dispatchTimeLabel }}</a-descriptions-item>
            <a-descriptions-item label="真画布预览">
              {{ handoff?.showGrid ? '带刻度' : '无刻度' }} · {{ previewStatusLabel }}
            </a-descriptions-item>
            <a-descriptions-item label="四区布局">{{ handoff?.boardPlan ? '已确认' : '未确认' }}</a-descriptions-item>
            <a-descriptions-item label="知识关联点" :span="2">
              <a-space v-if="relatedKnowledge.length" wrap size="small">
                <a-tag v-for="item in relatedKnowledge" :key="item['编号'] || item['知识点']" color="blue">
                  {{ item['知识点'] || '未命名知识点' }}
                </a-tag>
              </a-space>
              <a-typography-text v-else type="secondary">未查询，Agent B 可按题目自行判断</a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="使用方式" :span="2">
              <a-typography-text type="secondary">
                思路与参考素材，不是唯一答案；Agent B 结合题目和真画布预览自行判断、按需使用。
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="运行时补充">
              <a-typography-text type="secondary">当前时间、真画布截图和布局随本次请求注入</a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="课堂话术">
              <a-typography-text type="secondary">小学单题耐心讲解参考，按题目自然改写</a-typography-text>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-collapse v-model:activeKey="apiCollapseActiveKey" class="qh-surface-card" style="border: 1px solid #1677ff; background: #ffffff; border-radius: 8px;">
          <a-collapse-panel key="api-config" header="Agent B 核心 API 配置 (点此展开/折叠 ٩(●˙▿˙●)۶)">
            <a-form layout="vertical">
              <a-row :gutter="[12, 12]">
                <a-col :span="8">
                  <a-form-item label="服务 Endpoint (接口地址)" style="margin-bottom: 0">
                    <a-input v-model:value="config.endpoint" placeholder="https://..." @change="persistAgentConfig" />
                  </a-form-item>
                </a-col>
                <a-col :span="6">
                  <a-form-item label="模型名称 (AI Model)" style="margin-bottom: 0">
                    <a-input v-model:value="config.model" placeholder="gpt-5.4" @change="persistAgentConfig" />
                  </a-form-item>
                </a-col>
                <a-col :span="5">
                  <a-form-item label="API Key (用户自填)" style="margin-bottom: 0">
                    <a-input-password
                      v-model:value="userApiConfig.apiKey"
                      placeholder="sk-...（仅存浏览器）"
                      autocomplete="off"
                      @change="persistAgentConfig"
                      style="width: 100%"
                    />
                  </a-form-item>
                </a-col>
                <a-col :span="5">
                  <a-form-item label="手写板书字体 (Handwriting Font)" style="margin-bottom: 0">
                    <a-select v-model:value="typography.fontId" aria-label="板书字体" @change="persistTypographyConfig" style="width: 100%">
                      <a-select-option v-for="font in HANDWRITING_FONTS" :key="font.id" :value="font.id">
                        {{ font.label }}
                      </a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
              </a-row>
            </a-form>
          </a-collapse-panel>
        </a-collapse>

        <a-alert
          v-if="errorText"
          type="error"
          show-icon
          :message="errorText"
        />


        <a-row :gutter="[16, 16]">
          <a-col :span="8">
            <a-card title="已确认题目" class="qh-surface-card">
              <template #extra>
                <a-tag color="blue">{{ problemTypeLabel }}</a-tag>
              </template>
              <a-typography-paragraph>{{ handoff?.problemText }}</a-typography-paragraph>
              <a-textarea
                v-model:value="extraNote"
                :rows="2"
                placeholder="本题补充要求（可留空）"
              />
            </a-card>
          </a-col>

          <a-col :span="16">
            <a-card class="qh-surface-card">
              <template #title>
                <a-space>
          <span>真画布预览 · {{ handoff?.boardPlan?.canvasW ?? CANVAS_W }}×{{ handoff?.boardPlan?.canvasH ?? CANVAS_H }}</span>
                  <a-tag :color="previewDataUrl ? 'green' : 'default'">
                    {{ previewDataUrl ? '已截取' : '待截取' }}
                  </a-tag>
                </a-space>
              </template>
              <div ref="previewCaptureRef">
                <RealBoardPreview
                  :problem-text="handoff?.problemText"
                  :board-plan="handoff?.boardPlan"
                  :topic-layout="handoff?.topicLayout"
                  :source-image-url="handoff?.sourceImageDataUrl"
                  :keep-original="handoff?.keepOriginal"
                  :show-grid="handoff?.showGrid"
                  show-all-labels
                  show-zone-guides
                  :interactive="false"
                />
              </div>
            </a-card>
          </a-col>
        </a-row>

        <a-card class="qh-surface-card">
          <template #title>
            <a-space>
              <span>七列执行表</span>
              <a-tag color="blue">{{ problemTypeLabel }}</a-tag>
              <a-tag v-if="generatedModel" color="green">{{ generatedModel }}</a-tag>
              <a-tag v-if="rows.length">{{ rows.length }} 行</a-tag>
            </a-space>
          </template>
          <template #extra>
            <a-space size="middle">
              <a-typography-text type="secondary">主工作区 · 170字/分估时</a-typography-text>
              <a-button
                type="primary"
                :loading="state === 'generating'"
                @click="generateRows"
              >
                <template #icon><ThunderboltOutlined /></template>
                生成 Agent B 七列表
              </a-button>
            </a-space>
          </template>

          <div v-if="!rows.length" style="padding: 20px 0; display:flex; align-items:center; gap:12px;">
            <a-typography-text type="secondary">题目信息已就绪，点击右上角"生成"按钮</a-typography-text>
          </div>
          <a-table
            v-else
            :columns="columns"
            :data-source="tableRows"
            row-key="_rowKey"
            :pagination="false"
            :scroll="{ x: 1060 }"
            size="small"
            bordered
          >
            <template #bodyCell="{ column, record, index }">
              <a-typography-text
                v-if="column.key === 'duration'"
                type="secondary"
                style="font-size: 11px; display: block; line-height: 1.5; white-space: pre-wrap"
              >{{ record.duration }}</a-typography-text>
              <div
                v-else-if="column.key === 'stage'"
                :style="{ borderLeft: `3px solid ${stageAccentColors[record.stage] || '#d9d9d9'}`, paddingLeft: '6px' }"
              >
                <a-select
                  :value="record.stage"
                  size="small"
                  style="width: 100%"
                  @change="(value) => updateRow(index, 'stage', value)"
                >
                  <a-select-option v-for="stage in ['题目', '分析', '解答', '答语', '总结']" :key="stage" :value="stage">
                    {{ stage }}
                  </a-select-option>
                </a-select>
              </div>
              <a-popover
                v-else-if="column.key === 'actionSpec' && record.actionSpec.length"
                trigger="click"
                placement="left"
              >
                <template #content>
                  <a-list
                    :data-source="record.actionSpec"
                    size="small"
                    style="width: 360px; max-height: 420px; overflow: auto"
                  >
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-space direction="vertical" size="small">
                          <a-space :size="4" wrap>
                            <a-tag v-if="item.action?.order" color="blue">#{{ item.action.order }}</a-tag>
                            <a-tag>{{ actionLabel(item) }}</a-tag>
                          </a-space>
                          <a-typography-text>{{ actionContent(item) }}</a-typography-text>
                        </a-space>
                      </a-list-item>
                    </template>
                  </a-list>
                </template>
                <a-tag color="processing" style="cursor: pointer">{{ record.actionSpec.length }} 个动作</a-tag>
              </a-popover>
              <span v-else-if="column.key === 'actionSpec'" style="color: #bfbfbf; font-size: 13px">—</span>
              <div v-else-if="column.key === 'operations'">
                <a-space size="small">
                  <a-button
                    type="primary"
                    shape="circle"
                    size="small"
                    title="在下方新增一行"
                    @click="insertRowAfter(index)"
                  >
                    <template #icon><PlusOutlined /></template>
                  </a-button>
                  <a-popconfirm
                    title="确定要删除这一行吗？"
                    ok-text="确定"
                    cancel-text="取消"
                    @confirm="deleteRow(index)"
                  >
                    <a-button
                      type="primary"
                      danger
                      shape="circle"
                      size="small"
                      title="删除这一行"
                    >
                      <template #icon><DeleteOutlined /></template>
                    </a-button>
                  </a-popconfirm>
                </a-space>
              </div>
              <a-textarea
                v-else
                :value="record[column.key]"
                :auto-size="{ minRows: 2, maxRows: 8 }"
                @change="(event) => updateRow(index, column.key, event.target.value)"
              />
            </template>
          </a-table>
        </a-card>

        <a-card v-if="toolsOpen" title="可用工具（人话）" class="qh-surface-card" size="small">
          <template #extra>
            <a-typography-text type="secondary">单手串行 · 随口播触发</a-typography-text>
          </template>
          <a-list
            :grid="{ gutter: 8, column: 4 }"
            :data-source="toolReferenceRows"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta :title="item.label" :description="item.usage" />
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-space>
    </a-layout-content>
    <!-- 设置抽屉：浮层组件，挂 layout 直接子级 -->
    <a-drawer
      v-model:open="settingsOpen"
      title="Agent B 配置"
      :width="760"
      placement="right"
    >
      <a-form layout="vertical">
        <a-row :gutter="[12, 12]">
          <a-col :span="10">
            <a-form-item label="Endpoint">
              <a-input v-model:value="config.endpoint" placeholder="https://..." @change="persistAgentConfig" />
            </a-form-item>
          </a-col>
          <a-col :span="5">
            <a-form-item label="模型">
              <a-input v-model:value="config.model" placeholder="gpt-5.4" @change="persistAgentConfig" />
            </a-form-item>
          </a-col>
          <a-col :span="4">
            <a-form-item label="API Key">
              <a-input-password
                v-model:value="userApiConfig.apiKey"
                placeholder="sk-...（仅存浏览器）"
                autocomplete="off"
                @change="persistAgentConfig"
              />
            </a-form-item>
          </a-col>
          <a-col :span="5">
            <a-form-item label="板书字体">
              <a-select v-model:value="typography.fontId" aria-label="板书字体" @change="persistTypographyConfig">
                <a-select-option v-for="font in HANDWRITING_FONTS" :key="font.id" :value="font.id">
                  {{ font.label }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="Agent B 提示词">
          <a-textarea
            :value="AGENT_B_V2_SYSTEM_PROMPT"
            :rows="16"
            readonly
          />
        </a-form-item>
      </a-form>
    </a-drawer>
  </a-layout>
</template>
