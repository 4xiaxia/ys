<script setup>
/* @qh-core LANE=SHARED POINT=TRUE_PREVIEW 1726x980 capture source */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DESIGN_W,
  DESIGN_H,
  BOARD_LAYOUT,
  limitTopicImageHeightPct,
  pctBox,
} from '../utils/boardLayout'
import { renderProblemHtml } from '../utils/mathText'
import { TABLE_REF_W, TABLE_REF_H, buildGridLines } from '../utils/canvasCoords'

const props = defineProps({
  problemText: { type: String, default: '' },
  /** 完整规划：四标签+区+题目；没有则只显示题目标签/题文默认位 */
  boardPlan: { type: Object, default: null },
  /** 兼容只传 topicLayout */
  topicLayout: { type: Object, default: null },
  showGrid: { type: Boolean, default: false },
  showAllLabels: { type: Boolean, default: false },
  showZoneGuides: { type: Boolean, default: false },
  interactive: { type: Boolean, default: true },
  sourceImageUrl: { type: String, default: '' },
  keepOriginal: { type: Boolean, default: false },
})

const emit = defineEmits(['pick-coord', 'topic-measured'])
const hover = ref(null)
const boardRef = ref(null)
const topicContentRef = ref(null)
const grid = buildGridLines()
let topicObserver = null

const plan = computed(() => {
  if (props.boardPlan?.topicLabel || props.boardPlan?.question) return props.boardPlan
  const q = props.topicLayout?.question || BOARD_LAYOUT.question
  return {
    topicLabel: props.topicLayout?.topicLabel || BOARD_LAYOUT.topicLabel,
    question: q,
    image: props.topicLayout?.image || null,
    analysisLabel: BOARD_LAYOUT.analysisLabel,
    analysis: BOARD_LAYOUT.analysis,
    solutionLabel: BOARD_LAYOUT.solutionLabel,
    solution: BOARD_LAYOUT.solution,
    summaryLabel: BOARD_LAYOUT.summaryLabel,
    summary: BOARD_LAYOUT.summary,
  }
})

const problemHtml = computed(() => renderProblemHtml(props.problemText || ''))
const showExtraLabels = computed(() => props.showAllLabels || Boolean(props.boardPlan?.analysisLabel))
const topicImageMaxHeight = computed(() => limitTopicImageHeightPct(plan.value.image))

function measureTopic() {
  const board = boardRef.value
  const topic = topicContentRef.value
  if (!board || !topic) return

  const boardRect = board.getBoundingClientRect()
  const topicRect = topic.getBoundingClientRect()
  if (!boardRect.height) return

  const bottomPct = ((topicRect.bottom - boardRect.top) / boardRect.height) * 100
  const heightPct = (topicRect.height / boardRect.height) * 100
  emit('topic-measured', {
    bottomPct: Number(bottomPct.toFixed(2)),
    heightPct: Number(heightPct.toFixed(2)),
  })
}

function observeTopic() {
  topicObserver?.disconnect()
  topicObserver = null
  if (!topicContentRef.value) return

  topicObserver = new ResizeObserver(measureTopic)
  topicObserver.observe(topicContentRef.value)
  measureTopic()
}

onMounted(() => nextTick(observeTopic))
watch(
  () => [props.problemText, props.sourceImageUrl, props.keepOriginal, props.topicLayout, props.boardPlan],
  () => nextTick(observeTopic),
  { deep: true },
)
onBeforeUnmount(() => topicObserver?.disconnect())

function onMove(e) {
  if (!props.interactive) return
  const rect = e.currentTarget.getBoundingClientRect()
  const xPct = ((e.clientX - rect.left) / rect.width) * 100
  const yPct = ((e.clientY - rect.top) / rect.height) * 100
  const px = Math.round((xPct / 100) * DESIGN_W)
  const py = Math.round((yPct / 100) * DESIGN_H)
  hover.value = {
    xPct: xPct.toFixed(1),
    yPct: yPct.toFixed(1),
    px,
    py,
    refX: Math.round((px / DESIGN_W) * TABLE_REF_W),
    refY: Math.round((py / DESIGN_H) * TABLE_REF_H),
  }
}
function onLeave() {
  hover.value = null
}
function onClick() {
  if (!props.interactive || !hover.value) return
  emit('pick-coord', { ...hover.value })
}
</script>

<template>
  <div class="real-board-wrap">
    <div
      ref="boardRef"
      class="board"
      :class="{ interactive }"
      data-board-canvas="true"
      :style="{ aspectRatio: `${DESIGN_W} / ${DESIGN_H}` }"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @click="onClick"
    >
      <img class="board-paper" src="/canvas.png" alt="甲方画布" draggable="false" />

      <!-- 题目标签：始终可有 -->
      <div v-if="problemText.trim() || showExtraLabels" class="board-item label" data-board-layer="L2" :style="pctBox(plan.topicLabel)">
        <img src="/topic.png" alt="题目" draggable="false" />
      </div>

      <!-- 原题图（仅 keepOriginal） -->
      <div
        v-if="keepOriginal && sourceImageUrl && plan.image"
        ref="topicContentRef"
        class="board-item topic-image"
        data-board-layer="L2"
        :style="{ ...pctBox(plan.image), maxHeight: topicImageMaxHeight + '%' }"
      >
        <img :src="sourceImageUrl" alt="原题" draggable="false" @load="measureTopic" />
      </div>

      <div
        v-if="problemText.trim() && !(keepOriginal && sourceImageUrl)"
        ref="topicContentRef"
        class="board-item topic-text"
        data-board-layer="L2"
        data-board-region="question"
        data-typography="approved-printed-question"
        :style="{
          ...pctBox(plan.question),
          fontSize: `calc(${plan.question.fontSize || 30} * 1cqw / 17.26)`,
        }"
        v-html="problemHtml"
      />

      <!-- L2 区域标签：分析/解答/总结（归入 L2，在板书层之前渲染） -->
      <template v-if="showExtraLabels">
        <div class="board-item label" data-board-layer="L2" :style="pctBox(plan.analysisLabel)">
          <img src="/analysis.png" alt="分析" draggable="false" />
        </div>
        <div class="board-item label" data-board-layer="L2" :style="pctBox(plan.solutionLabel)">
          <img src="/solution.png" alt="解答" draggable="false" />
        </div>
        <div class="board-item label" data-board-layer="L2" :style="pctBox(plan.summaryLabel)">
          <img src="/summary.png" alt="总结" draggable="false" />
        </div>
      </template>

      <template v-if="showZoneGuides && showExtraLabels">
        <div class="guide analysis" :style="pctBox(plan.analysis)" />
        <div class="guide solution" :style="pctBox(plan.solution)" />
        <div class="guide summary" :style="pctBox(plan.summary)" />
      </template>

      <!-- L3 板书层：容器透明，Agent C 在此层写字画图 -->
      <svg
        class="rough-drawing-layer"
        data-board-layer="L3"
        data-board-overlay="rough-drawings"
        :viewBox="`0 0 ${DESIGN_W} ${DESIGN_H}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      />

      <div
        class="annotation-layer"
        data-board-layer="L3"
        data-board-overlay="annotations"
        aria-hidden="true"
      />

      <div v-if="showGrid" class="grid-layer">
        <div v-for="g in grid.minor" :key="'vm'+g.p" class="grid-line v minor" :style="{ left: g.p + '%' }" />
        <div v-for="g in grid.major" :key="'vM'+g.p" class="grid-line v major" :style="{ left: g.p + '%' }">
          <span class="tick">{{ g.p }}</span>
        </div>
        <div v-for="g in grid.minor" :key="'hm'+g.p" class="grid-line h minor" :style="{ top: g.p + '%' }" />
        <div v-for="g in grid.major" :key="'hM'+g.p" class="grid-line h major" :style="{ top: g.p + '%' }">
          <span class="tick y">{{ g.p }}</span>
        </div>
      </div>

      <div v-if="hover" class="hover-readout">
        画布({{ hover.px }},{{ hover.py }})px / ({{ hover.xPct }},{{ hover.yPct }})%
        · 表约({{ hover.refX }},{{ hover.refY }})
        <span class="hint">点击复制</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.real-board-wrap { width: 100%; }
.board {
  container-type: inline-size;
  position: relative;
  width: min(100%, var(--board-preview-max, 860px));
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid #9ccfd9;
  background: #fff;
  box-shadow: 0 10px 28px rgba(24, 40, 42, 0.12);
  user-select: none;
}
.board.interactive { cursor: crosshair; }
.board-paper {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none;
}
.board-item { position: absolute; z-index: 3; }
.label img { display: block; width: 100%; height: auto; pointer-events: none; }
.topic-image { overflow: hidden; z-index: 3; background: transparent; }
.topic-image img {
  display: block; width: 100%; max-height: 100%; object-fit: contain;
  object-position: left top;
  filter: grayscale(1) contrast(1.05); pointer-events: none;
}
.topic-text {
  z-index: 4; color: #1f1f1f; line-height: 1.65; white-space: pre-wrap; word-break: break-word;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-weight: 500;
}
.topic-text :deep(.katex) { font-size: 1.05em; }
.rough-drawing-layer {
  position: absolute; inset: 0; z-index: 4; width: 100%; height: 100%;
  overflow: visible; pointer-events: none;
}
.annotation-layer {
  position: absolute; inset: 0; z-index: 5; pointer-events: none;
}
.guide {
  position: absolute; z-index: 2; border: 1px dashed rgba(14,165,233,.35);
  background: transparent; border-radius: 8px; pointer-events: none;
}
.guide.solution { border-color: rgba(16,185,129,.35); background: transparent; }
.guide.summary { border-color: rgba(168,85,247,.35); background: transparent; }
.grid-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.grid-line { position: absolute; }
.grid-line.v { top: 0; bottom: 0; width: 0; border-left: 1px solid rgba(15,23,42,.05); }
.grid-line.h { left: 0; right: 0; height: 0; border-top: 1px solid rgba(15,23,42,.05); }
.grid-line.major.v { border-left-color: rgba(22,119,255,.22); }
.grid-line.major.h { border-top-color: rgba(22,119,255,.22); }
.tick {
  position: absolute; top: 2px; left: 2px; font-size: 9px; color: #2563eb;
  background: rgba(255,255,255,.7); padding: 0 2px;
}
.tick.y { top: auto; }
.hover-readout {
  position: absolute; z-index: 6; left: 8px; right: 8px; bottom: 8px;
  background: rgba(15,23,42,.88); color: #e2e8f0; font-size: 11px;
  padding: 6px 8px; border-radius: 8px; pointer-events: none;
}
.hover-readout .hint { float: right; color: #93c5fd; }
</style>
