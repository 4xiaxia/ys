/* @qh-core LANE=SERVER POINT=VITE_MIDDLEWARE recognition + old agent-b + agent-b-v2 proxies
 * 注意：本服务端代理不再读取 .env 中的 API Key。
 * 所有 apiKey / endpoint / model 均由前端用户在前端填写，
 * 通过请求体传到本代理，再由代理转发给上游 LLM 服务。
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { parseAgentBDraftText } from './src/services/agentBDraftResult.js'
import { validateAgentBRowsContract } from './src/services/agentBContract.js'
import { agentBV2ProxyPlugin } from './server/agentBV2ProxyPlugin.js'

const AGENT_B_UPSTREAM_TIMEOUT_MS = 60000

/**
 * 从请求体里读取用户自填的 apiKey/endpoint/model，做最小校验后返回标准三件套。
 * 不再提供 fallback 默认值——前端必须传齐三件套，否则报错。
 * 这样避免：(1) 用错服务 (2) 用 gpt-5.4 等纯文本模型导致多模态失败。
 */
function resolveUserCredentials(body) {
  const apiKey = String(body?.apiKey || '').trim()
  const endpoint = String(body?.endpoint || '').trim()
  const model = String(body?.model || '').trim()
  if (!apiKey) {
    const err = new Error('缺少 apiKey：请在前端「Agent 配置」里填写用户自己的 API Key')
    err.code = 'MISSING_API_KEY'
    throw err
  }
  if (!endpoint) {
    const err = new Error('缺少 endpoint：请在前端「Agent 配置」里填写上游 API URL')
    err.code = 'MISSING_ENDPOINT'
    throw err
  }
  if (!model) {
    const err = new Error('缺少 model：请在前端「Agent 配置」里填写支持多模态的模型名（如 gpt-5.6-terra）')
    err.code = 'MISSING_MODEL'
    throw err
  }
  let endpointURL
  try {
    endpointURL = new URL(endpoint)
  } catch {
    throw new Error('Endpoint 不是合法 URL')
  }
  if (!['http:', 'https:'].includes(endpointURL.protocol)) {
    throw new Error('Endpoint 只支持 http/https')
  }
  const baseURL = endpointURL.toString().replace(/\/$/, '')
  return { apiKey, baseURL, model }
}

function recognitionProxyPlugin() {
  return {
    name: 'step1-recognition-proxy',
    configureServer(server) {
      server.middlewares.use('/api/recognition/problem', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const bodyText = Buffer.concat(chunks).toString('utf8')
          const body = bodyText ? JSON.parse(bodyText) : {}

          let apiKey, baseURL, model
          try {
            ;({ apiKey, baseURL, model } = resolveUserCredentials(body))
          } catch (err) {
            res.statusCode = String(err.code || '').startsWith('MISSING_') ? 400 : 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: err.message }))
            return
          }

          const content = []
          const prompt = [
            '你是小学/初中板书答疑的题目识别助手。',
            '任务：先读懂题目内容，再判断题型、板书侧重，以及图片是否该贴原图。',
            '只返回 JSON，不要 markdown，不要解释。',
            'JSON 字段：',
            '{',
            '  "problemText": "完整题干，保留数字单位符号问法",',
            '  "problemType": "geometry|calculation|word|other",',
            '  "boardFocus": "geometry_diagram|calculation_process|relation_understanding|mixed",',
            '  "imageKind": "text_only|has_diagram",',
            '  "keepOriginal": true/false,',
            '  "uncertainItems": ["不确定项"]',
            '}',
            '题型判断（当前先粗判；明细分类库由夏夏后续整理后再细接）：',
            '1) geometry 优先。几何题特征：面积、长、宽、边长、角度/求角、周长、体积、高、底边等几何量；',
            '   或图形主体：梯形、平行四边形、三角形、圆等；或作图/证明/如图。',
            '   即使出现「原来/增加/减少/多少/变成」，只要在讲图形与面积/边长/角度，仍判 geometry。',
            '2) calculation：纯数与式计算（四则、方程求值、化简），无明显几何量/图形/生活场景。',
            '3) word 应用题：一般有生活/故事场景，如小船顺逆水、鸡兔同笼、行程、工程、买卖、人数钱数等。',
            '   有场景且无几何主体 → word；不要只因“多少”就判应用题。',
            'boardFocus 绑定：geometry→geometry_diagram；calculation→calculation_process；word→relation_understanding。',
            'imageKind/keepOriginal 规则：',
            '- 纯图：图片里存在图形事实；即使同时有题干文字、算式、手写字、尺寸标注或讲解文字，也仍判 imageKind=has_diagram，keepOriginal=true。',
            '- 非纯图：图片里没有任何图形事实，只有文字、题干、算式、分数或符号，才判 imageKind=text_only，keepOriginal=false。',
            '- 图形事实包括几何图、示意图、立体图、实物图、结构线、手绘解题图、图形标注和不可丢失的图像关系；不能因为文字占大多数就判成 text_only。',
            '- 例：梯形题干+手绘解题图=has_diagram；礼盒题干+立体图=has_diagram；只有文字题干=text_only；只有算式=text_only。',
            '- 不确定时优先保留原图并写 uncertainItems，不要把可能有图的图片吞成纯文本。',
            '布局建议（画布 1726x980，全部用百分比，原点左上，左右边距 6%，底线 95%）：',
            '必须在 JSON 返回 suggestedLayout 字段，根据图片宽高比和 imageKind 选模式：',
            '模式 portrait：无图形或竖图(宽/高<=1.4)。题目左列 x:6 y:7 w:44；分析左列下 x:6 y:35 w:44；解答右列 x:54 y:7 w:40；总结右列下 x:54 y:62 w:40。',
            '模式 landscape_diagram：横图(宽/高>1.4)且有图形。上下布局：原题图贴顶 x:6 y:7 w:88，高度自适应不超出画布；图片底部以下三区横排：分析 x:6 y:动态 w:27；解答 x:37 y:动态 w:27；总结 x:68 y:动态 w:26。',
            '模式 portrait_diagram：竖图(宽/高<=1.4)且有图形。左右布局：原题图左列 x:6 y:7 w:44，高度自适应到画布底（不写死 maxH）；右列三区纵排：分析 x:54 y:7 w:40；解答 x:54 y:37 w:40；总结 x:54 y:67 w:40。',
            'suggestedLayout 格式示例(portrait)：{"mode":"portrait","topic":{"x":6,"y":7,"w":44},"analysis":{"x":6,"y":35,"w":44},"solution":{"x":54,"y":7,"w":40},"summary":{"x":54,"y":62,"w":40}}',
            '只给 x/y/w，不写死 h 或 maxH，高度由内容自适应决定。图片宽高比无法判断时默认 portrait。'
          ].join('\n')

          content.push({ type: 'text', text: prompt })

          if (body.problemText && String(body.problemText).trim()) {
            content.push({
              type: 'text',
              text: `用户已有题文（可校正）：\n${String(body.problemText).trim()}`,
            })
          }

          if (body.imageDataUrl) {
            content.push({
              type: 'image_url',
              image_url: { url: body.imageDataUrl },
            })
          }

          if (!body.imageDataUrl && !(body.problemText && String(body.problemText).trim())) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: '需要图片或题文' }))
            return
          }

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 30000)
          let upstream
          try {
            upstream = await fetch(`${baseURL}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              signal: controller.signal,
              body: JSON.stringify({
                model,
                temperature: 0.1,
                messages: [{ role: 'user', content }],
              }),
            })
          } catch (error) {
            if (error?.name === 'AbortError') {
              res.statusCode = 504
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ ok: false, error: '识别上游请求超过 30 秒，已取消' }))
              return
            }
            throw error
          } finally {
            clearTimeout(timeoutId)
          }
          const raw = await upstream.text()
          let data
          try {
            data = raw ? JSON.parse(raw) : {}
          } catch {
            data = { raw }
          }

          if (!upstream.ok) {
            res.statusCode = upstream.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(
              JSON.stringify({
                ok: false,
                error: data?.error?.message || data?.message || `上游识别失败 ${upstream.status}`,
                detail: data,
              }),
            )
            return
          }

          const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning_content || ''
          const parsed = extractJson(text)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(
            JSON.stringify({
              ok: true,
              model,
              rawText: text,
              result: parsed,
            }),
          )
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }))
        }
      })
    },
  }
}

function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] || text).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return { problemText: candidate }
      }
    }
    return { problemText: candidate }
  }
}


function agentBDraftProxyPlugin() {
  return {
    name: 'step2-agent-b-draft-proxy',
    configureServer(server) {
      server.middlewares.use('/api/agent-b/board-draft', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          next()
          return
        }
        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          let apiKey, baseURL, model
          try {
            ;({ apiKey, baseURL, model } = resolveUserCredentials(body))
          } catch (err) {
            res.statusCode = String(err.code || '').startsWith('MISSING_') ? 400 : 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: err.message }))
            return
          }
          if (!body.previewDataUrl) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: 'Agent B 需要 previewDataUrl（真画布预览图）' }))
            return
          }

          const systemPrompt = body.systemPrompt || ''
          const userPayload = body.userPayload || {}
          const content = [
            {
              type: 'text',
              text: '【结构化输入】\n' + JSON.stringify(userPayload, null, 2),
            },
            {
              type: 'text',
              text: '【真画布预览图如下，请严格按 taskStage 使用；已确认内容不得改写】',
            },
            {
              type: 'image_url',
              image_url: { url: body.previewDataUrl },
            },
          ]

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), AGENT_B_UPSTREAM_TIMEOUT_MS)
          let upstream
          let raw
          try {
            upstream = await fetch(`${baseURL}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              signal: controller.signal,
              body: JSON.stringify({
                model,
                temperature: body.temperature ?? 0.2,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content },
                ],
              }),
            })
            raw = await upstream.text()
          } catch (error) {
            if (error?.name === 'AbortError') {
              res.statusCode = 504
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({
                ok: false,
                code: 'AGENT_B_UPSTREAM_TIMEOUT',
                error: 'Agent B 上游请求超过60秒，已取消',
                retryable: true,
              }))
              return
            }
            throw error
          } finally {
            clearTimeout(timeoutId)
          }
          let data
          try { data = raw ? JSON.parse(raw) : {} } catch { data = { raw } }
          if (!upstream.ok) {
            res.statusCode = upstream.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({
              ok: false,
              error: data?.error?.message || data?.message || `上游失败 ${upstream.status}`,
            }))
            return
          }
          const text = data?.choices?.[0]?.message?.content || ''
          const draft = parseAgentBDraftText(text)
          const finishReason = data?.choices?.[0]?.finish_reason || ''
          const reasoningContent = data?.choices?.[0]?.message?.reasoning_content || ''
          if (userPayload.taskStage === 'board_script') {
            const contractResult = draft.contractError
              ? { ok: false, error: draft.contractError }
              : validateAgentBRowsContract(draft.rows)
            if (!contractResult.ok) {
              res.statusCode = 422
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({
                ok: false,
                code: 'AGENT_B_CONTRACT_INVALID',
                error: contractResult.error,
                retryable: true,
                upstreamStatus: upstream.status,
                finishReason,
                responseId: data?.id || '',
                usage: data?.usage || null,
                diagnostic: { rawTextHead: text.slice(0, 500) },
              }))
              return
            }
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            ok: true,
            model,
            rawText: text,
            finishReason,
            responseId: data?.id || '',
            usage: data?.usage || null,
            reasoningContent,
            ...draft,
          }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }))
        }
      })
    },
  }
}

export default defineConfig(() => {
  return {
    plugins: [vue(), recognitionProxyPlugin(), agentBDraftProxyPlugin(), agentBV2ProxyPlugin()],
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
    // ─── qh-step1 lib build（激活时取消注释，dev模式不需要）───
    // build: {
    //   lib: {
    //     entry: '../packages/qh-step1/index.js',
    //     name: 'QhStep1',
    //     fileName: (format) => `qh-step1.${format}.js`,
    //   },
    //   rollupOptions: {
    //     external: ['vue', 'ant-design-vue'],
    //     output: { globals: { vue: 'Vue', 'ant-design-vue': 'antd' } },
    //   },
    // },
    // ─────────────────────────────────────────────────────────
  }
})
