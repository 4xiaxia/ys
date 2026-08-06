<script setup>
import { computed } from 'vue'

const props = defineProps({
  phase: { type: String, default: 'solution-setup' },
})

const steps = [
  'B-A 解题',
  '审核解法',
  '解法确认',
  'B-B 剧本',
  '审核七列表',
]

const phaseMap = {
  'solution-setup': { index: 0, status: 'wait' },
  'solution-generating': { index: 0, status: 'process' },
  'solution-review': { index: 1, status: 'process' },
  'solution-confirmed': { index: 2, status: 'process' },
  'script-generating': { index: 3, status: 'process' },
  'script-review': { index: 4, status: 'process' },
}

const currentPhase = computed(() => phaseMap[props.phase] || phaseMap['solution-setup'])

function getStepStatus(index) {
  if (index < currentPhase.value.index) return 'finish'
  if (index === currentPhase.value.index) return currentPhase.value.status
  return 'wait'
}
</script>

<template>
  <nav class="step2-phase-bar" aria-label="第 2 步阶段">
    <ol class="phase-list">
      <li
        v-for="(label, index) in steps"
        :key="label"
        class="phase-item"
        :class="`is-${getStepStatus(index)}`"
        :aria-current="index === currentPhase.index ? 'step' : undefined"
      >
        <span class="phase-marker" aria-hidden="true">{{ index + 1 }}</span>
        <span class="phase-label">{{ label }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.step2-phase-bar {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 8px 0 6px;
  color: #5f6b7a;
}

.phase-list {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.phase-item {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: #8c96a3;
}

.phase-item:not(:first-child)::before {
  position: absolute;
  top: 11px;
  right: 50%;
  width: 100%;
  height: 1px;
  background: #d9dee5;
  content: '';
}

.phase-item.is-finish::before,
.phase-item.is-process::before {
  background: #8aa9cc;
}

.phase-marker {
  position: relative;
  z-index: 1;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid #c9d0d8;
  border-radius: 50%;
  background: #fff;
  color: #7b8794;
  font-size: 11px;
  line-height: 1;
}

.phase-label {
  min-width: 0;
  max-width: 100%;
  margin-top: 6px;
  padding: 0 4px;
  overflow-wrap: anywhere;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.35;
  letter-spacing: 0;
}

.phase-item.is-finish {
  color: #536579;
}

.phase-item.is-finish .phase-marker {
  border-color: #8aa9cc;
  background: #eef4fa;
  color: #466b94;
}

.phase-item.is-process {
  color: #1f4f82;
  font-weight: 500;
}

.phase-item.is-process .phase-marker {
  border-color: #2f6fac;
  background: #2f6fac;
  color: #fff;
}

.phase-item.is-wait[aria-current='step'] {
  color: #5d6f82;
}

.phase-item.is-wait[aria-current='step'] .phase-marker {
  border-color: #8fa4b8;
  background: #f7f9fb;
  color: #526a80;
}

@media (max-width: 520px) {
  .step2-phase-bar {
    padding-block: 6px 4px;
  }

  .phase-item:not(:first-child)::before {
    top: 10px;
  }

  .phase-marker {
    width: 20px;
    height: 20px;
    font-size: 10px;
  }

  .phase-label {
    margin-top: 5px;
    padding-inline: 2px;
    font-size: 11px;
  }
}
</style>
