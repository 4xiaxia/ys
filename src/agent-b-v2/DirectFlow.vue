<script setup>
/* @qh-core LANE=B-V2 POINT=FLOW step1<->agentB page switch */
import { ref, watch } from 'vue'
import Step1Entry from '../components/Step1Entry.vue'
import AgentBDirect from './AgentBDirect.vue'

const page = ref('step1')  // 始终从第1步开始，handoff 只恢复数据不做跳转

watch(page, (value) => {
  document.title = value === 'agent-b' ? '生成 · Agent B 七列表' : '教学板书 · 第1步 贴题识别'
}, { immediate: true })

function enterAgentB() {
  page.value = 'agent-b'
}

function backToStep1() {
  page.value = 'step1'
}
</script>

<template>
  <Step1Entry v-if="page === 'step1'" @enter-board-draft="enterAgentB" />
  <AgentBDirect v-else @back-to-step1="backToStep1" />
</template>
