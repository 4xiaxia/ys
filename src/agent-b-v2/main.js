/* @qh-core LANE=B-V2 POINT=BOOT entry=agent-b-v2.html */
import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import '../style.css'
import '../board-tools/boardTypography.css'
import DirectFlow from './DirectFlow.vue'

createApp(DirectFlow).use(Antd).mount('#agent-b-v2-app')
