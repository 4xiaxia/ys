<script setup>
import { computed } from 'vue'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue'

const props = defineProps({
  solutionCheck: { type: Object, default: null },
  modelValue: { type: Object, default: null },
  confirmedSolution: { type: Object, default: null },
  resolutionNote: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  canConfirm: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:modelValue',
  'update:resolutionNote',
  'confirm',
  'regenerate',
  'generate-script',
  'back-to-step1',
])

const editableDraft = computed(() => props.modelValue || props.solutionCheck || {})

const uncertainItems = computed(() => {
  const originalItems = props.modelValue?.originalUncertainItems
  if (Array.isArray(originalItems) && originalItems.length) return originalItems
  if (Array.isArray(editableDraft.value.uncertainItems) && editableDraft.value.uncertainItems.length) {
    return editableDraft.value.uncertainItems
  }
  return Array.isArray(props.solutionCheck?.uncertainItems)
    ? props.solutionCheck.uncertainItems
    : []
})

const needsResolution = computed(() => uncertainItems.value.length > 0)

const stepsText = computed({
  get() {
    return Array.isArray(editableDraft.value.steps)
      ? editableDraft.value.steps.join('\n')
      : ''
  },
  set(value) {
    updateDraftField(
      'steps',
      String(value ?? '')
        .split(/\r?\n/)
        .map((step) => step.trim())
        .filter(Boolean),
    )
  },
})

function updateDraftField(field, value) {
  const nextDraft = {
    ...editableDraft.value,
    [field]: value,
  }
  if (!Array.isArray(nextDraft.originalUncertainItems)) {
    nextDraft.originalUncertainItems = [...uncertainItems.value]
  }
  emit('update:modelValue', nextDraft)
}

function updateResolutionNote(value) {
  emit('update:resolutionNote', String(value ?? ''))
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '未填写'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
</script>

<template>
  <section class="solution-review" aria-labelledby="solution-review-title">
    <template v-if="confirmedSolution">
      <header class="panel-header">
        <div class="panel-heading">
          <a-typography-title id="solution-review-title" :level="4">解法已确认</a-typography-title>
          <a-typography-text type="secondary">确认快照已锁定</a-typography-text>
        </div>
        <a-tag color="success">只读</a-tag>
      </header>

      <section class="content-section" aria-label="已确认答案">
        <div class="readonly-grid">
          <div class="readonly-field readonly-field-wide">
            <span class="field-label">最终答案</span>
            <p>{{ displayValue(confirmedSolution.answer) }}</p>
          </div>
          <div class="readonly-field">
            <span class="field-label">单位检查</span>
            <p>{{ displayValue(confirmedSolution.unitCheck) }}</p>
          </div>
          <div class="readonly-field">
            <span class="field-label">验算</span>
            <p>{{ displayValue(confirmedSolution.verification) }}</p>
          </div>
        </div>
      </section>

      <section class="content-section" aria-labelledby="confirmed-steps-title">
        <h3 id="confirmed-steps-title" class="section-title">解题步骤</h3>
        <ol v-if="confirmedSolution.steps?.length" class="step-list">
          <li v-for="(step, index) in confirmedSolution.steps" :key="index">
            {{ displayValue(step) }}
          </li>
        </ol>
        <a-typography-text v-else type="secondary">未填写</a-typography-text>
      </section>

      <section
        v-if="confirmedSolution.reviewMeta?.originalUncertainItems?.length || confirmedSolution.reviewMeta?.resolutionNote"
        class="content-section resolution-record"
        aria-labelledby="resolution-record-title"
      >
        <h3 id="resolution-record-title" class="section-title">确认记录</h3>
        <ol v-if="confirmedSolution.reviewMeta?.originalUncertainItems?.length" class="uncertain-list compact-list">
          <li
            v-for="(item, index) in confirmedSolution.reviewMeta.originalUncertainItems"
            :key="index"
          >
            {{ displayValue(item) }}
          </li>
        </ol>
        <div v-if="confirmedSolution.reviewMeta?.resolutionNote" class="resolution-note">
          <span class="field-label">确认依据 / 采用的解释</span>
          <p>{{ confirmedSolution.reviewMeta.resolutionNote }}</p>
        </div>
      </section>

      <footer class="panel-actions confirmed-actions">
        <a-button
          type="primary"
          :loading="loading"
          :disabled="loading"
          @click="emit('generate-script')"
        >
          <template #icon><FileTextOutlined /></template>
          生成7列表剧本
        </a-button>
      </footer>
    </template>

    <template v-else>
      <header class="panel-header">
        <div class="panel-heading">
          <a-typography-title id="solution-review-title" :level="4">B 解题草案</a-typography-title>
          <a-typography-text type="secondary">逐项审核后确认</a-typography-text>
        </div>
        <a-tag :color="needsResolution ? 'warning' : 'processing'">
          {{ needsResolution ? '有待确认项' : '待确认' }}
        </a-tag>
      </header>

      <section v-if="uncertainItems.length" class="uncertain-section" aria-labelledby="uncertain-title">
        <h3 id="uncertain-title" class="section-title">待确认项</h3>
        <ol class="uncertain-list">
          <li v-for="(item, index) in uncertainItems" :key="index">
            <span class="uncertain-index">{{ index + 1 }}</span>
            <span>{{ displayValue(item) }}</span>
          </li>
        </ol>
      </section>

      <a-form class="review-form" layout="vertical">
        <section class="content-section form-section" aria-label="答案审核">
          <a-form-item label="最终答案" required>
            <a-textarea
              :value="editableDraft.answer"
              :auto-size="{ minRows: 2, maxRows: 6 }"
              placeholder="填写最终答案"
              @update:value="updateDraftField('answer', $event)"
            />
          </a-form-item>

          <div class="form-grid">
            <a-form-item label="单位检查" required>
              <a-textarea
                :value="editableDraft.unitCheck"
                :auto-size="{ minRows: 2, maxRows: 5 }"
                placeholder="核对单位与答语"
                @update:value="updateDraftField('unitCheck', $event)"
              />
            </a-form-item>
            <a-form-item label="验算" required>
              <a-textarea
                :value="editableDraft.verification"
                :auto-size="{ minRows: 2, maxRows: 5 }"
                placeholder="填写验算过程或结论"
                @update:value="updateDraftField('verification', $event)"
              />
            </a-form-item>
          </div>
        </section>

        <section class="content-section form-section" aria-label="步骤审核">
          <a-form-item label="解题步骤" required>
            <a-textarea
              v-model:value="stepsText"
              :auto-size="{ minRows: 7, maxRows: 14 }"
              placeholder="每行一个步骤"
            />
          </a-form-item>
        </section>

        <section class="content-section form-section" aria-label="审核说明">
          <a-form-item
            :label="needsResolution ? '确认依据 / 采用哪种解释' : '补充说明'"
            :required="needsResolution"
            :validate-status="needsResolution && !resolutionNote.trim() ? 'error' : undefined"
            :help="needsResolution && !resolutionNote.trim() ? '存在待确认项，必须填写后才能确认' : undefined"
          >
            <a-textarea
              :value="resolutionNote"
              :auto-size="{ minRows: 3, maxRows: 8 }"
              :placeholder="needsResolution ? '说明确认依据，或明确采用哪种解释' : '需要重新解题时，可在这里补充题意或要求'"
              @update:value="updateResolutionNote"
            />
          </a-form-item>
        </section>
      </a-form>

      <footer class="panel-actions">
        <a-button :disabled="loading" @click="emit('back-to-step1')">
          <template #icon><ArrowLeftOutlined /></template>
          返回第1步修正题目
        </a-button>
        <a-button :loading="loading" @click="emit('regenerate')">
          <template #icon><ReloadOutlined /></template>
          补充说明后重新解题
        </a-button>
        <a-button
          type="primary"
          :disabled="!canConfirm || loading"
          @click="emit('confirm')"
        >
          <template #icon><CheckCircleOutlined /></template>
          确认解法
        </a-button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.solution-review {
  width: 100%;
  min-width: 0;
  color: #243242;
}

.panel-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e4e9ef;
}

.panel-heading {
  min-width: 0;
}

.panel-heading :deep(.ant-typography) {
  margin: 0;
  letter-spacing: 0;
}

.panel-heading :deep(.ant-typography-secondary) {
  display: block;
  margin-top: 4px;
  font-size: 13px;
}

.content-section,
.uncertain-section {
  padding: 20px 0;
  border-bottom: 1px solid #edf0f3;
}

.section-title {
  margin: 0 0 12px;
  color: #334155;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: 0;
}

.uncertain-section {
  padding: 16px;
  border: 1px solid #f1cf8b;
  border-radius: 8px;
  margin-top: 20px;
  background: #fffaf0;
}

.uncertain-list,
.step-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.uncertain-list {
  display: grid;
  gap: 10px;
}

.uncertain-list li {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 10px;
  color: #5f4b20;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.uncertain-index {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  place-items: center;
  border-radius: 50%;
  background: #f4d58d;
  color: #5c4515;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.review-form {
  min-width: 0;
}

.form-section :deep(.ant-form-item) {
  min-width: 0;
  margin-bottom: 0;
}

.form-section :deep(.ant-form-item-label > label) {
  color: #475569;
  font-size: 13px;
  font-weight: 500;
}

.form-grid,
.readonly-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.form-grid {
  margin-top: 16px;
}

.readonly-field {
  min-width: 0;
}

.readonly-field-wide {
  grid-column: 1 / -1;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  color: #667085;
  font-size: 12px;
  font-weight: 500;
}

.readonly-field p,
.resolution-note p {
  margin: 0;
  color: #243242;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.step-list {
  counter-reset: solution-step;
  display: grid;
  gap: 12px;
}

.step-list li {
  counter-increment: solution-step;
  position: relative;
  min-width: 0;
  padding-left: 32px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.step-list li::before {
  position: absolute;
  top: 1px;
  left: 0;
  width: 22px;
  color: #2f6fac;
  content: counter(solution-step) '.';
  font-weight: 600;
}

.compact-list {
  margin-bottom: 16px;
}

.resolution-record .uncertain-list li {
  color: #475569;
}

.resolution-note {
  padding-top: 12px;
  border-top: 1px dashed #d8dee6;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 20px;
}

.panel-actions :deep(.ant-btn) {
  height: auto;
  min-height: 40px;
  max-width: 100%;
  white-space: normal;
  text-align: center;
}

.confirmed-actions {
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .panel-header {
    gap: 12px;
  }

  .form-grid,
  .readonly-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .readonly-field-wide {
    grid-column: auto;
  }

  .content-section {
    padding: 16px 0;
  }

  .uncertain-section {
    padding: 14px;
    margin-top: 16px;
  }

  .panel-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .panel-actions :deep(.ant-btn) {
    width: 100%;
  }
}
</style>
