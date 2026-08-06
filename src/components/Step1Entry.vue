<script setup>
/* @qh-core LANE=STEP1 POINT=UI_CONFIRM recognize+type+boardPlan+save handoff */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { toPng } from 'html-to-image'

const emit = defineEmits(['enter-board-draft'])
import { message } from 'ant-design-vue'
import { recognizeProblem, fileToDataUrl } from '../services/recognitionClient'
import { renderProblemHtml } from '../utils/mathText'
import { buildStep1Handoff, saveStep1Handoff } from '../services/stepHandoff'
import { selectAgentBRelatedKnowledge } from '../services/agentBKnowledge.js'
import {
  userApiConfig,
  saveUserApiConfig,
  isUserApiReady,
  subscribeUserApiConfig,
} from '../lib/userApiConfig.js'
import RealBoardPreview from './RealBoardPreview.vue'
import QhPageHeader from './QhPageHeader.vue'
import { planLabelsFromTopic } from '../utils/boardLayout'
import {
  CloudUploadOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue'

// 生产车间第1步：真画布上贴题，不是假预览壳

const problemText = ref('')
const problemTextHtml = computed(() => renderProblemHtml(problemText.value))
const sourceImageUrl = ref('')
const sourceImageName = ref('')
const sourceImageDataUrl = ref('')
const keepOriginal = ref(false)
const recognizeStatus = ref('idle')
const layoutStatus = ref('idle') // idle | ready | regenerating
const layoutSeed = ref(0)
const isLandscape = ref(false)
const step1Confirmed = ref(false)
const boardPlan = ref(null)
const showGrid = ref(false)
const labelsPlanned = ref(false)
const topicMeasurement = ref({ bottomPct: null, heightPct: null })
const previewCaptureRef = ref(null)

const problemType = ref(undefined)
const boardFocus = ref(undefined)
const knowledgeStatus = ref('idle')
const relatedKnowledge = ref([])
const knowledgeError = ref('')

const AGENT_STORAGE_KEY = 'qinghuabu.step1.agentConfig'

// 全局 userApiConfig 由 lib/userApiConfig.js 维护，所有页面共享同一份密钥/endpoint/model
// agentConfig 这里只保留本页“能力 / 自动识别”等局部偏好；endpoint/model/apiKey 直接走 userApiConfig
const agentConfig = reactive({
  pageName: '第1步 · 贴题识别',
  capability: 'multimodal',
  autoRecognize: true,
})

const agentDrawerOpen = ref(false)

function loadAgentConfig() {
  try {
    const raw = localStorage.getItem(AGENT_STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    agentConfig.capability = saved.capability || agentConfig.capability
    agentConfig.autoRecognize = saved.autoRecognize !== false
    // 兼容老数据：若旧 localStorage 里有 endpoint/model，迁到 userApiConfig 一次
    if (!userApiConfig.endpoint && saved.endpoint) userApiConfig.endpoint = saved.endpoint
    if (!userApiConfig.model && saved.model) userApiConfig.model = saved.model
    saveUserApiConfig()
  } catch (error) {
    // ignore bad local cache
  }
}

loadAgentConfig()

// 订阅全局 userApiConfig 变化（多标签同步），无需任何回调逻辑
subscribeUserApiConfig(() => {})

const agentReady = computed(() => {
  // 本地过交互可不配 endpoint；要真识别再要求 apiKey+endpoint+model 齐备
  return Boolean(agentConfig.capability) && isUserApiReady()
})

const agentSummary = computed(() => {
  const model = userApiConfig.model || '未填模型'
  const ep = userApiConfig.endpoint ? '已填服务' : '服务未填'
  const key = userApiConfig.apiKey ? '· Key 已填' : '· Key 未填'
  return `${agentConfig.capability} · ${model} · ${ep} ${key}`
})

const problemTypeOptions = [
  { value: 'geometry', label: '几何题' },
  { value: 'calculation', label: '计算运算题' },
  { value: 'word', label: '应用题' },
  { value: 'other', label: '其他' },
]

const boardFocusOptions = [
  { value: 'geometry_diagram', label: '几何图解', forTypes: ['geometry'] },
  { value: 'calculation_process', label: '演算过程', forTypes: ['calculation'] },
  { value: 'relation_understanding', label: '关系理解（可画图）', forTypes: ['word'] },
  { value: 'mixed', label: '综合分析', forTypes: ['geometry', 'calculation', 'word', 'other'] },
]

// 题目层落位（相对 1726×980 百分比，来自已验证 demo 落点）
// 布局规则：图片题目区 = 左半(w≤44%) + 上半(y从标签下13.2%到50%) = maxH≈36%
// 文字题目：只填左侧文字，不走图片分支
const baseLayout = {
  topicLabel: { x: 5.7, y: 6.6, w: 7.1 },
  question: { x: 6.0, y: 13.2, w: 40.4 },
  image: { x: 6.0, y: 13.2, w: 38.0 },   // 高度由 limitTopicImageHeightPct 自适应到画布底，不写死 maxH
}

const topicLayout = computed(() => {
  // 重新生成：只微调题目块，不乱动甲方底板
  const jitter = (layoutSeed.value % 3) * 0.4
  const fontBump = layoutSeed.value % 3
  const hasImage = Boolean(sourceImageUrl.value && keepOriginal.value)
  return {
    topicLabel: { ...baseLayout.topicLabel },
    image: hasImage
      ? {
          x: baseLayout.image.x,
          y: baseLayout.image.y,
          // 横图(宽>高)上下布局：图片宽占满安全区（6%~94%）
          // 竖图(高>宽)左右布局：图片占左列，宽约44%
          // 高度均由 limitTopicImageHeightPct 自适应到画布底，不在这里限制
          w: isLandscape.value ? 88 : baseLayout.image.w - jitter * 0.3,
        }
      : null,
    question: {
      x: baseLayout.question.x,
      y: hasImage ? 42 + jitter : baseLayout.question.y + jitter * 0.3,
      w: baseLayout.question.w - jitter * 0.2,
      fontSize: hasImage ? 28 - fontBump : 30 - fontBump,
    },
  }
})

const hasBoardContent = computed(() => {
  return Boolean(problemText.value.trim() || (sourceImageUrl.value && keepOriginal.value))
})

const canQueryKnowledge = computed(() => {
  return (
    problemText.value.trim().length > 0 &&
    layoutStatus.value === 'ready' &&
    Boolean(problemType.value) &&
    Boolean(boardFocus.value) &&
    !step1Confirmed.value
  )
})

const canConfirm = computed(() => {
  return (
    problemText.value.trim().length > 0 &&
    recognizeStatus.value !== 'loading' &&
    layoutStatus.value === 'ready' &&
    Boolean(problemType.value) &&
    Boolean(boardFocus.value) &&
    labelsPlanned.value &&
    showGrid.value &&
    boardPlan.value?.question &&
    boardPlan.value?.analysis &&
    boardPlan.value?.solution &&
    boardPlan.value?.summary &&
    (!keepOriginal.value || Boolean(sourceImageUrl.value)) &&
    !step1Confirmed.value
  )
})

const statusText = computed(() => {
  if (step1Confirmed.value) return '第1步已确认：题目已落在甲方画布题目层。'
  if (recognizeStatus.value === 'loading') return '识别中，识别完直接贴上画布…'
  if (layoutStatus.value === 'regenerating') return '按画布重新落位…'
  if (!hasBoardContent.value) return '初始是空白甲方画布。贴题后，题目直接放上去。'
  if (sourceImageUrl.value && !keepOriginal.value && problemText.value.trim()) {
    return '纯文字题图已按文本处理：画布只放题文，不贴原图。核对题型后可确认。'
  }
  if (!problemType.value || !boardFocus.value) return '确认题型与板书侧重。'
  if (knowledgeStatus.value !== 'success') return '题型已确认，可查询知识关联点，也可直接进入下一步。'
  return '看缩略画布：识别对不对、放位对不对。不好就重新生成。'
})

function resetKnowledgeQuery() {
  knowledgeStatus.value = 'idle'
  relatedKnowledge.value = []
  knowledgeError.value = ''
}

watch([problemText, problemType], resetKnowledgeQuery)

function suggestFromText(text) {
  const raw = text || ''
  // 暂定粗判断；夏夏后续会整理「题型分类库」再细接，避免 agent 乱判
  // 夏夏：几何题特征一定有面积/长/宽/角度/边长等几何相关字眼
  const geometryHit =
    /梯形|平行四边形|矩形|正方形|菱形|三角|圆|扇形|几何|图形|如图|作图|证明|∠|°|底边|高|对角线|相似|全等|平行|垂直|面积|周长|体积|边长|长|宽|角度|求角|夹角|圆心角|半径|直径|弦|弧|面积是多少|边长是多少/.test(
      raw,
    )
  if (geometryHit) {
    return { type: 'geometry', focus: 'geometry_diagram' }
  }
  if (/方程|计算|求值|化简|运算|简便|竖式/.test(raw)) {
    return { type: 'calculation', focus: 'calculation_process' }
  }
  // 应用题：一般有场景（小船、鸡兔同笼、行程工程买卖等），暂粗判
  if (
    /应用题|场景|小船|顺水|逆水|鸡兔同笼|鸡|兔|行程|工程|速度|工作效率|买|卖|原价|折扣|余下|还剩|一共|多少人|多少钱|果园|工厂|水池/.test(
      raw,
    )
  ) {
    return { type: 'word', focus: 'relation_understanding' }
  }
  return { type: undefined, focus: undefined }
}

function detectLandscape(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve(img.naturalWidth / (img.naturalHeight || 1) > 1.4)
    img.onerror = () => resolve(false)
    img.src = dataUrl
  })
}

function applySuggestion(text) {
  const suggestion = suggestFromText(text)
  if (suggestion.type && !problemType.value) problemType.value = suggestion.type
  if (suggestion.focus && !boardFocus.value) boardFocus.value = suggestion.focus
}

function onProblemTypeChange(value) {
  problemType.value = value
  const preferred = boardFocusOptions.find(
    (item) => item.forTypes.includes(value) && item.value !== 'mixed',
  )
  if (preferred) boardFocus.value = preferred.value
}

function markLayoutReady() {
  layoutStatus.value = hasBoardContent.value ? 'ready' : 'idle'
}

async function placeOnCanvas({ fromUpload = false } = {}) {
  if (!sourceImageUrl.value && !problemText.value.trim()) {
    message.warning('请先上传图片或输入题目')
    return
  }

  recognizeStatus.value = 'loading'
  layoutStatus.value = 'regenerating'
  step1Confirmed.value = false
    boardPlan.value = null
    labelsPlanned.value = false
    showGrid.value = false

  try {
    // 真车间：本页多模态识别完，直接往甲方画布题目层放
    // model/endpoint/apiKey 全部来自全局 userApiConfig
    const result = await recognizeProblem({
      problemText: problemText.value,
      imageDataUrl: sourceImageDataUrl.value,
      model: userApiConfig.model,
      endpoint: userApiConfig.endpoint,
      apiKey: userApiConfig.apiKey,
    })

    if (result.problemText) problemText.value = result.problemText

    // 题型以题目内容为准：本地几何信号可纠正模型误判
    const localGuess = suggestFromText(result.problemText || problemText.value)
    let nextType = result.problemType || localGuess.type
    let nextFocus = result.boardFocus || localGuess.focus
    if (localGuess.type === 'geometry' && nextType !== 'geometry') {
      nextType = 'geometry'
      nextFocus = 'geometry_diagram'
    } else if (localGuess.type === 'calculation' && nextType === 'word') {
      nextType = 'calculation'
      nextFocus = 'calculation_process'
    }
    if (nextType) problemType.value = nextType
    if (nextFocus) boardFocus.value = nextFocus

    // 夏夏硬边界：纯文字题图归文本，不贴原图；只有识别为 has_diagram 才贴
    const imageKind = String(result.imageKind || '').toLowerCase()
    if (imageKind === 'text_only' || imageKind === 'text') {
      keepOriginal.value = false
    } else if (imageKind === 'has_diagram' || imageKind === 'diagram' || imageKind === 'figure') {
      keepOriginal.value = true
    } else if (typeof result.keepOriginal === 'boolean') {
      // 模型没给 imageKind 时：有图输入也默认不贴，除非明确 keepOriginal=true 且题干像“如图”
      const textNow = result.problemText || problemText.value || ''
      const diagramHint = /如图|见图|下图|右图|左图|图中|示意图|图形如下|看图/.test(textNow)
      keepOriginal.value = Boolean(result.keepOriginal) && diagramHint
    } else {
      keepOriginal.value = false
    }

    // 若仍缺题型/侧重，本地再补
    applySuggestion(problemText.value)

    layoutSeed.value += 1
    recognizeStatus.value = 'done'
    markLayoutReady()
    const pureTextImage = Boolean(sourceImageUrl.value) && !keepOriginal.value
    message.success(
      pureTextImage
        ? '纯文字题图：已按文本处理，不贴原图'
        : fromUpload
          ? '图片已识别并贴上画布'
          : '题目已识别并贴上画布',
    )
  } catch (error) {
    recognizeStatus.value = 'error'
    layoutStatus.value = 'idle'
    message.error(error?.message || '识别/落位未完成')
  }
}

async function regenerateLayout() {
  if (!hasBoardContent.value) {
    message.warning('画布上还没有题目')
    return
  }
  if (step1Confirmed.value) {
    message.info('已确认。要重排先撤销')
    return
  }
  layoutStatus.value = 'regenerating'
  await new Promise((resolve) => setTimeout(resolve, 280))
  layoutSeed.value += 1
  layoutStatus.value = 'ready'
  message.success('题目在画布上重新落位')
}

async function beforeUpload(file) {
  if (!String(file.type || '').startsWith('image/')) {
    message.error('请上传图片')
    return false
  }

  try {
    if (sourceImageUrl.value) URL.revokeObjectURL(sourceImageUrl.value)
    sourceImageUrl.value = URL.createObjectURL(file)
    sourceImageName.value = file.name
    sourceImageDataUrl.value = await fileToDataUrl(file)
    // 横版检测：宽高比 > 1.4 视为横向图片
    isLandscape.value = await detectLandscape(sourceImageDataUrl.value)
    step1Confirmed.value = false
    // 上传只是入口；是否贴原图由识别判定（纯文字图=文本，不贴原图）
    keepOriginal.value = false

    if (agentConfig.autoRecognize) await placeOnCanvas({ fromUpload: true })
    else markLayoutReady()
  } catch (error) {
    message.error(error?.message || '读取图片失败')
  }
  return false
}

function onTextInput() {
  step1Confirmed.value = false
  if (problemText.value.trim()) {
    applySuggestion(problemText.value)
    markLayoutReady()
  } else if (!sourceImageUrl.value) {
    layoutStatus.value = 'idle'
  }
}

async function queryRelatedKnowledge() {
  if (!canQueryKnowledge.value) {
    message.warning('请先确认题目识别结果和题型')
    return
  }

  knowledgeStatus.value = 'loading'
  knowledgeError.value = ''
  try {
    await Promise.resolve()
    relatedKnowledge.value = selectAgentBRelatedKnowledge({
      problemText: problemText.value,
      problemType: problemType.value,
    })
    knowledgeStatus.value = 'success'
    message.success(
      relatedKnowledge.value.length
        ? `已找到 ${relatedKnowledge.value.length} 条知识关联点`
        : '本题暂无精确匹配，已记录为未匹配',
    )
  } catch (error) {
    knowledgeStatus.value = 'error'
    knowledgeError.value = error?.message || '关联知识查询失败'
    message.error(knowledgeError.value)
  }
}

function onTopicMeasured(measurement) {
  if (!Number.isFinite(Number(measurement?.bottomPct))) return
  topicMeasurement.value = {
    bottomPct: Number(measurement.bottomPct),
    heightPct: Number(measurement.heightPct || 0),
  }
}


function planBoardLabels() {
  if (!hasBoardContent.value) {
    message.warning('请先识别并贴上题目')
    return
  }
  // 题目锚已定：一次规划四标签 + 打开网格比例尺（复用甲方落点，按题块高度弹性下移分析区）
  boardPlan.value = planLabelsFromTopic(
    {
      topicLabel: topicLayout.value.topicLabel,
      question: topicLayout.value.question,
      image: topicLayout.value.image,
    },
    {
      isLandscape: isLandscape.value && Boolean(sourceImageUrl.value) && keepOriginal.value,
      topicBottomPct: topicMeasurement.value.bottomPct,
    },
  )
  labelsPlanned.value = true
  showGrid.value = true
  message.success('已在真画布上规划：分析 / 解答 / 总结，并打开网格')
}

async function captureConfirmedPreview() {
  await nextTick()
  await document.fonts?.ready
  return toPng(previewCaptureRef.value, {
    cacheBust: true,
    pixelRatio: 1,
    backgroundColor: '#ffffff',
  })
}

async function confirmStep1() {
  if (!canConfirm.value) {
    message.warning('请先让题目正确落在画布上，并确认题型侧重')
    return
  }

  let previewDataUrl = ''
  try {
    previewDataUrl = await captureConfirmedPreview()
  } catch (error) {
    console.warn('[Step1Entry] capture confirmed preview failed, proceeding without snapshot', error)
  }
  // 快照失败不阻断流程，空串作降级处理

  // 进入下一步信号：确定进入生成表 → 把参数交给板书参数书稿页 / 页面B agent
  // 注意：apiKey/endpoint/model 由全局 userApiConfig 维护，不再放进 handoff
  const payload = buildStep1Handoff({
    problemText: problemText.value,
    problemType: problemType.value,
    boardFocus: boardFocus.value,
    keepOriginal: keepOriginal.value,
    imageKind: keepOriginal.value ? 'has_diagram' : 'text_only',
    hasSourceImage: Boolean(sourceImageUrl.value),
    sourceImageName: sourceImageName.value,
    sourceImageDataUrl: keepOriginal.value ? sourceImageDataUrl.value : '',
    topicLayout: {
      topicLabel: topicLayout.value.topicLabel,
      question: topicLayout.value.question,
      image: topicLayout.value.image || null,
      keepOriginal: keepOriginal.value,
    },
    boardPlan: boardPlan.value,
    showGrid: showGrid.value,
    previewDataUrl,
    agentPageName: agentConfig.pageName,
    agentCapability: agentConfig.capability,
    relatedKnowledge: knowledgeStatus.value === 'success' ? relatedKnowledge.value : null,
  })
  saveStep1Handoff(payload)

  step1Confirmed.value = true
  message.success('已进入板书参数书稿：题目 / 题型 / 侧重已交接')
  emit('enter-board-draft', payload)
}

function resetConfirm() {
  step1Confirmed.value = false
}

function clearImage() {
  if (sourceImageUrl.value) URL.revokeObjectURL(sourceImageUrl.value)
  sourceImageUrl.value = ''
  sourceImageName.value = ''
  sourceImageDataUrl.value = ''
  step1Confirmed.value = false
  isLandscape.value = false
  markLayoutReady()
}

function saveAgentConfig() {
  // apiKey/endpoint/model 由全局 userApiConfig 持久化
  saveUserApiConfig()
  localStorage.setItem(
    AGENT_STORAGE_KEY,
    JSON.stringify({
      capability: agentConfig.capability,
      autoRecognize: agentConfig.autoRecognize,
    }),
  )
  agentDrawerOpen.value = false
  message.success('本页 Agent 配置已保存（Key/Endpoint/Model 全局生效）')
}

function pct(style) {
  return {
    left: `${style.x}%`,
    top: `${style.y}%`,
    width: `${style.w}%`,
  }
}
</script>

<template>
  <a-layout class="qh-page">
    <QhPageHeader step-label="第 1 步 · 生产车间" subtitle="识别 → 真画布落位">
      <template #actions>
        <a-tag :color="userApiConfig.endpoint ? 'purple' : 'default'">{{ agentSummary }}</a-tag>
        <a-tooltip title="本页 Agent 配置">
          <a-button type="text" shape="circle" aria-label="本页 Agent 配置" @click="agentDrawerOpen = true">
            <template #icon><SettingOutlined /></template>
          </a-button>
        </a-tooltip>
      </template>
    </QhPageHeader>
    <a-layout-content class="qh-page-content">
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :lg="10">
          <a-card title="创建一道题" class="main-card qh-surface-card" :bordered="false">
            <div class="field-label">识别题目</div>
            <a-textarea
              v-model:value="problemText"
              :rows="7"
              :disabled="step1Confirmed"
              placeholder="支持文本输入；也可上传图片识别后落到这里"
              @input="onTextInput"
            />

            <div class="row-2">
              <div>
                <div class="field-label">题型</div>
                <a-select
                  v-model:value="problemType"
                  allow-clear
                  placeholder="自动判断，可改"
                  style="width: 100%"
                  :disabled="step1Confirmed"
                  :options="problemTypeOptions"
                  @change="onProblemTypeChange"
                />
              </div>
              <div>
                <div class="field-label">板书侧重</div>
                <a-select
                  v-model:value="boardFocus"
                  allow-clear
                  placeholder="分析侧重，可改"
                  style="width: 100%"
                  :disabled="step1Confirmed"
                  :options="boardFocusOptions.map((i) => ({ value: i.value, label: i.label }))"
                />
              </div>
            </div>

            <div class="upload-actions">
              <a-upload
                :disabled="step1Confirmed"
                :show-upload-list="false"
                :before-upload="beforeUpload"
                accept="image/*"
              >
                <a-button :disabled="step1Confirmed">
                  <template #icon><CloudUploadOutlined /></template>
                  支持上传图片
                </a-button>
              </a-upload>
            </div>

            <div v-if="sourceImageUrl" class="image-mini">
              <a-image :src="sourceImageUrl" :width="64" :alt="sourceImageName" />
              <div class="image-mini-meta">
                <a-typography-text :content="sourceImageName" :ellipsis="{ tooltip: sourceImageName }" />
                <a-space size="small">
                  <a-switch v-model:checked="keepOriginal" size="small" :disabled="step1Confirmed" />
                  <a-typography-text type="secondary">原图入题（仅含图才开）</a-typography-text>
                  <a-typography-text v-if="sourceImageUrl && !keepOriginal" type="warning" style="font-size:12px">
                    纯文字图：归文本，不贴原图
                  </a-typography-text>
                  <a-button type="link" size="small" :disabled="step1Confirmed" @click="clearImage">移除</a-button>
                </a-space>
              </div>
            </div>

            <div class="actions">
              <a-button
                :loading="recognizeStatus === 'loading'"
                :disabled="step1Confirmed || (!sourceImageUrl && !problemText.trim())"
                @click="placeOnCanvas({ fromUpload: Boolean(sourceImageUrl) })"
              >
                识别并贴上画布
              </a-button>
              <a-button v-if="step1Confirmed" @click="resetConfirm">撤销确认</a-button>
            </div>

            <a-typography-text type="secondary" class="status">{{ statusText }}</a-typography-text>
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="14">
          <a-card class="preview-card qh-surface-card" :bordered="false">
            <template #title>
              <span>预览</span>
              <a-typography-text type="secondary" class="preview-sub">
                缩小的真画布 · 初始空白 · 现做现产
              </a-typography-text>
            </template>
            <template #extra>
              <a-button
                size="small"
                :loading="layoutStatus === 'regenerating'"
                :disabled="!hasBoardContent || step1Confirmed"
                @click="regenerateLayout"
              >
                <template #icon><ReloadOutlined /></template>
                重新生成落位
              </a-button>
            </template>

            <div class="board-viewport" ref="previewCaptureRef">
              <RealBoardPreview
                :problem-text="problemText"
                :topic-layout="topicLayout"
                :board-plan="boardPlan"
                :show-all-labels="labelsPlanned"
                :show-grid="showGrid"
                :show-zone-guides="labelsPlanned"
                :source-image-url="sourceImageUrl"
                :keep-original="keepOriginal"
                :interactive="labelsPlanned"
                @topic-measured="onTopicMeasured"
              />
              <div v-if="layoutStatus === 'regenerating'" class="board-mask-outer">落位中…</div>
            </div>

            <div class="preview-tools" v-if="hasBoardContent">
              <a-space wrap>
                <a-button
                  size="small"
                  type="primary"
                  ghost
                  :disabled="step1Confirmed"
                  @click="planBoardLabels"
                >
                  {{ labelsPlanned ? '重新规划四标签+网格' : '规划四标签 + 网格' }}
                </a-button>
                <a-button
                  size="small"
                  :disabled="!labelsPlanned || step1Confirmed"
                  @click="showGrid = !showGrid"
                >
                  {{ showGrid ? '关闭网格' : '打开网格' }}
                </a-button>
              </a-space>
            </div>

            <a-typography-paragraph type="secondary" class="thumb-tip">
              客户看这里：字识对了没有、有没有放对地方。第1步没有技巧，纯粹识别 + 落画布。
            </a-typography-paragraph>
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]" style="margin-top: 0">
        <a-col :xs="24">
          <a-card title="知识关联点" class="knowledge-card qh-surface-card" :bordered="false">
            <a-alert
              type="info"
              show-icon
              message="关联建议，不是唯一答案"
            />

            <a-space class="knowledge-actions" wrap>
              <a-button
                :loading="knowledgeStatus === 'loading'"
                :disabled="!canQueryKnowledge"
                @click="queryRelatedKnowledge"
              >
                <template #icon><SearchOutlined /></template>
                <span>查询知识关联点</span>
              </a-button>
              <a-typography-text type="secondary">可选步骤，不作为进入下一步的门槛</a-typography-text>
            </a-space>

            <a-alert
              v-if="knowledgeStatus === 'error'"
              class="knowledge-state"
              type="error"
              show-icon
              :message="knowledgeError"
            />

            <a-empty
              v-else-if="knowledgeStatus === 'success' && relatedKnowledge.length === 0"
              class="knowledge-state"
              :image="null"
              description="暂未匹配到明确关联点，Agent B 仍可继续处理"
            />

            <div
              v-else-if="relatedKnowledge.length"
              class="knowledge-chips"
            >
              <a-tag
                v-for="(item, index) in relatedKnowledge"
                :key="index"
                color="blue"
              >{{ item['知识点'] || '未命名' }} <a-typography-text type="secondary" style="font-size:10px;color:inherit;opacity:0.75">{{ item['学科'] }}</a-typography-text></a-tag>
            </div>

            <a-divider />
            <a-space wrap>
              <a-button type="primary" :disabled="!canConfirm" @click="confirmStep1">
                <template #icon><CheckCircleOutlined /></template>
                确定进入生成表
              </a-button>
              <a-typography-text v-if="knowledgeStatus === 'success'" type="secondary">
                将携带 {{ relatedKnowledge.length }} 条关联建议交给 Agent B
              </a-typography-text>
            </a-space>
          </a-card>
        </a-col>
      </a-row>
    </a-layout-content>

    <a-drawer
      v-model:open="agentDrawerOpen"
      title="本页 Agent 配置"
      placement="right"
      :width="480"
    >
      <a-form layout="vertical" class="agent-form">
        <a-form-item label="能力">
          <a-select
            v-model:value="agentConfig.capability"
            :options="[
              { value: 'multimodal', label: '多模态（图+文）' },
              { value: 'text', label: '纯文本' },
              { value: 'vision', label: '偏视觉' },
            ]"
          />
        </a-form-item>
        <a-form-item label="Endpoint (上游 API URL)">
          <a-input
            v-model:value="userApiConfig.endpoint"
            placeholder="https://api.penguinsaichat.dpdns.org/v1"
          />
          <a-typography-text type="secondary" style="font-size:12px">
            OpenAI 兼容接口；支持图片/音频/视频的多模态服务
          </a-typography-text>
        </a-form-item>
        <a-form-item label="Model (模型名)">
          <a-input
            v-model:value="userApiConfig.model"
            placeholder="gpt-5.6-terra（必须填支持多模态的模型，否则图片识别会失败）"
          />
          <a-typography-text type="secondary" style="font-size:12px">
            ⚠ 不能用 gpt-5.4 等纯文本模型；要支持 image_url 输入
          </a-typography-text>
        </a-form-item>
        <a-form-item label="API Key (用户自填，仅存浏览器)">
          <a-input-password
            v-model:value="userApiConfig.apiKey"
            placeholder="sk-...（仅存浏览器，不上传服务端）"
            autocomplete="off"
          />
        </a-form-item>
        <a-form-item label="选图后自动识别并贴画布">
          <a-switch v-model:checked="agentConfig.autoRecognize" />
        </a-form-item>
        <a-space wrap>
          <a-button type="primary" @click="saveAgentConfig">保存本页配置</a-button>
          <a-tag :color="userApiConfig.endpoint && userApiConfig.apiKey && userApiConfig.model ? 'success' : 'default'">
            {{ userApiConfig.endpoint && userApiConfig.apiKey && userApiConfig.model ? '可接真识别' : '请先填 Key + Endpoint + Model' }}
          </a-tag>
        </a-space>
      </a-form>
    </a-drawer>
  </a-layout>
</template>

<style scoped>
.knowledge-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.knowledge-chips .ant-tag {
  margin: 0;
  line-height: 22px;
}

/* 壳层宽度/顶栏见 style.css：--page-max-width 等 */

.preview-card {
  border-radius: var(--card-radius);
  box-shadow: 0 8px 24px rgba(31, 45, 61, 0.05);
  min-height: 560px;
}

.main-card {
  border-radius: var(--card-radius);
  box-shadow: 0 8px 24px rgba(31, 45, 61, 0.05);
}

.field-label {
  margin: 0 0 8px;
  color: #595959;
  font-size: 13px;
}

.row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 14px 0;
}

.upload-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-top: 8px;
}

.image-mini {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 12px;
  padding: 8px;
  border-radius: 10px;
  background: #f7faff;
}

.image-mini-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.status {
  display: block;
  margin-top: 10px;
}

.preview-sub {
  margin-left: 8px;
  font-size: 12px;
}

.board-viewport {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 420px;
  padding: 12px;
  border-radius: 8px;
  background: #f3f6fa;
  border: 1px solid #e4ebf5;
}

.board-mask-outer {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.68);
  color: #5b6b7c;
  font-size: 14px;
  pointer-events: none;
}

.thumb-tip {
  margin: 12px 0 0;
  font-size: 12px;
}

.knowledge-card {
  margin-top: 16px;
  border-radius: var(--card-radius);
  box-shadow: 0 8px 24px rgba(31, 45, 61, 0.05);
}

.knowledge-actions {
  margin-top: 16px;
}

.knowledge-state,
.knowledge-list {
  margin-top: 12px;
}

.knowledge-list :deep(.ant-list-item-meta-description) {
  color: #595959;
}

.knowledge-card :deep(.ant-divider-horizontal) {
  margin: 12px 0;
}

.agent-form {
  max-width: 100%;
}

@media (max-width: 768px) {
  .row-2 {
    grid-template-columns: 1fr;
  }

  .preview-card {
    min-height: auto;
  }

  .board-viewport {
    min-height: 260px;
  }
}
</style>


