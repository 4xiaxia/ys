/**
 * useBoardCapture — 真画布 toPng 截图 composable
 * 消除 Step1Entry.captureConfirmedPreview 与 AgentBDirect.capturePreview 的重复
 */
import { ref, nextTick } from 'vue'
import { toPng } from 'html-to-image'

const DEFAULT_OPTIONS = Object.freeze({
  cacheBust: true,
  pixelRatio: 1,
  backgroundColor: '#ffffff',
})

/**
 * @param {import('vue').Ref} elRef — 指向要截图的 DOM 元素的 ref
 * @returns {{ capture, captureStatus, captureError }}
 */
export function useBoardCapture(elRef) {
  const captureStatus = ref('idle') // 'idle' | 'capturing' | 'error'
  const captureError = ref('')

  /**
   * @param {{ quiet?: boolean, options?: object }} opts
   * @returns {Promise<string>} dataUrl，失败返回空串
   */
  async function capture({ quiet = false, options = {} } = {}) {
    if (!elRef.value) return ''
    captureStatus.value = 'capturing'
    captureError.value = ''
    try {
      await nextTick()               // 等 Vue 完成本次 DOM patch
      await nextTick()               // 第二帧：让浏览器完成 layout/paint 再截图
      await document.fonts?.ready
      const dataUrl = await toPng(elRef.value, { ...DEFAULT_OPTIONS, ...options })
      captureStatus.value = 'idle'
      return dataUrl
    } catch (error) {
      captureStatus.value = 'error'
      captureError.value = error?.message || String(error)
      // quiet 只压 UI 提示，不压日志——根本原因必须可见
      console.error('[useBoardCapture] toPng 失败，错误原因：', error)
      return ''
    }
  }

  return { capture, captureStatus, captureError }
}
