import type { FastifyInstance } from 'fastify'

interface CodegenFile {
  name: string
  content: string
  language: string
}

interface CodegenSession {
  id: string
  prompt: string
  stack: string
  files: CodegenFile[]
  created_at: string
  user_id?: string
}

const sessions = new Map<string, CodegenSession>()

const STACK_LANGUAGES: Record<string, string> = {
  'html':       'html',
  'react':      'tsx',
  'vue':        'vue',
  'svelte':     'svelte',
  'node':       'typescript',
  'python':     'python',
  'go':         'go',
  'rust':       'rust',
}

const STACK_PROMPTS: Record<string, string> = {
  html:    'Generate clean semantic HTML5 with embedded CSS and vanilla JS. Return a single complete HTML file.',
  react:   'Generate a React component using TypeScript and inline styles. No imports except React. Return a single .tsx file with export default.',
  vue:     'Generate a Vue 3 SFC using <script setup> and TypeScript. Return a single .vue file.',
  svelte:  'Generate a Svelte component. Return a single .svelte file.',
  node:    'Generate a Node.js/TypeScript server. Return a single index.ts file.',
  python:  'Generate clean Python 3. Return a single main.py file.',
  go:      'Generate idiomatic Go. Return a single main.go file.',
  rust:    'Generate safe Rust. Return a single main.rs file.',
}

function getApiKey(req: any): string {
  return process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
}

async function streamFromLLM(
  prompt: string,
  stack: string,
  history: Array<{ role: string; content: string }>,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void
) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const mock = `// Generated ${stack} code for: ${prompt}\n\n// [API key not configured — set ANTHROPIC_API_KEY to enable]\n\nconsole.log("Hello from code gen!");\n`
    onChunk(mock)
    onDone(mock)
    return
  }

  const systemPrompt = STACK_PROMPTS[stack] ?? STACK_PROMPTS.html
  const messages = [
    ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: prompt },
  ]

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  })

  if (!res.ok || !res.body) {
    const err = `// Error: ${res.status} ${await res.text().catch(() => '')}`
    onChunk(err); onDone(err); return
  }

  let full = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const ev = JSON.parse(data)
        const text = ev.delta?.text ?? ev.delta?.content ?? ''
        if (text) { full += text; onChunk(text) }
      } catch {}
    }
  }
  onDone(full)
}

function extractCode(raw: string, stack: string): CodegenFile {
  // Strip markdown fences if present
  const fenceRe = /```(?:\w+)?\n([\s\S]*?)```/g
  const match = fenceRe.exec(raw)
  const content = match ? match[1] : raw

  const lang = STACK_LANGUAGES[stack] ?? 'text'
  const ext  = { tsx: 'tsx', ts: 'ts', html: 'html', vue: 'vue', svelte: 'svelte', python: 'py', go: 'go', rust: 'rs', typescript: 'ts' }[lang] ?? 'txt'

  const nameMap: Record<string, string> = {
    html: 'index.html', react: 'App.tsx', vue: 'App.vue', svelte: 'App.svelte',
    node: 'index.ts', python: 'main.py', go: 'main.go', rust: 'main.rs',
  }

  return { name: nameMap[stack] ?? `main.${ext}`, content, language: lang }
}

export async function codegenRoutes(fastify: FastifyInstance) {
  // POST /api/codegen/generate — SSE stream
  fastify.post<{
    Body: { prompt: string; stack: string; context_mentions?: any[]; history?: any[] }
  }>('/api/codegen/generate', async (req, reply) => {
    const { prompt, stack = 'html', context_mentions = [], history = [] } = req.body ?? {}
    if (!prompt?.trim()) return reply.status(400).send({ error: 'prompt required' })

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const sessionId = `cg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    let fullText = ''

    try {
      await streamFromLLM(prompt, stack, history, (chunk) => {
        fullText += chunk
        reply.raw.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`)
      }, (full) => {
        const file = extractCode(full, stack)
        const session: CodegenSession = {
          id: sessionId, prompt, stack,
          files: [file],
          created_at: new Date().toISOString(),
        }
        sessions.set(sessionId, session)
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', sessionId, files: [file] })}\n\n`)
        reply.raw.end()
      })
    } catch (e) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: String(e) })}\n\n`)
      reply.raw.end()
    }
  })

  // POST /api/codegen/iterate — SSE stream (generate diff from instruction)
  fastify.post<{
    Body: { session_id: string; instruction: string; current_code: string; stack: string }
  }>('/api/codegen/iterate', async (req, reply) => {
    const { session_id, instruction, current_code, stack = 'html' } = req.body ?? {}
    if (!instruction?.trim()) return reply.status(400).send({ error: 'instruction required' })

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const iterPrompt = `Here is the current code:\n\`\`\`\n${current_code}\n\`\`\`\n\nModification instruction: ${instruction}\n\nReturn the complete updated file.`

    try {
      await streamFromLLM(iterPrompt, stack, [], (chunk) => {
        reply.raw.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`)
      }, (full) => {
        const file = extractCode(full, stack)
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', files: [file] })}\n\n`)
        reply.raw.end()
      })
    } catch (e) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: String(e) })}\n\n`)
      reply.raw.end()
    }
  })

  // POST /api/codegen/compile — transpile JSX/TSX to plain HTML for preview iframe
  fastify.post<{ Body: { code: string; stack: string } }>('/api/codegen/compile', async (req, reply) => {
    const { code, stack } = req.body ?? {}

    if (['html'].includes(stack)) {
      return reply.send({ html: code })
    }

    if (['react', 'vue', 'svelte'].includes(stack)) {
      // Wrap React component in a self-contained HTML page using Babel standalone CDN
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>body { margin: 0; font-family: sans-serif; }</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
${code}
const rootEl = document.getElementById('root');
const root = ReactDOM.createRoot(rootEl);
root.render(React.createElement(typeof App !== 'undefined' ? App : () => React.createElement('div', null, 'Component loaded'), null));
  </script>
</body>
</html>`
      return reply.send({ html })
    }

    return reply.send({ html: `<pre style="padding:16px;font-family:monospace;background:#111;color:#abb2bf">${code.replace(/</g, '&lt;')}</pre>` })
  })

  // POST /api/research/related-questions (placed here as a convenience)
  fastify.post<{ Body: { query: string; report_summary: string } }>(
    '/api/research/related-questions',
    async (req, reply) => {
      const { query = '' } = req.body ?? {}
      // Generate related questions via LLM or return heuristics
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        const questions = [
          `What are the latest developments in ${query}?`,
          `How does ${query} compare to alternatives?`,
          `What are the limitations of ${query}?`,
          `Who are the key players in ${query}?`,
          `What is the future outlook for ${query}?`,
        ]
        return reply.send({ questions })
      }

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 300,
            messages: [{ role: 'user', content: `Generate 5 concise follow-up research questions for the topic: "${query}". Return as a JSON array of strings only.` }],
          }),
        })
        const data = await res.json() as any
        const text: string = data?.content?.[0]?.text ?? '[]'
        const questions: string[] = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
        return reply.send({ questions: questions.slice(0, 6) })
      } catch {
        return reply.send({ questions: [] })
      }
    }
  )

  // GET /api/codegen/sessions
  fastify.get('/api/codegen/sessions', async (_req, reply) => {
    const list = Array.from(sessions.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20)
    return reply.send(list)
  })

  // GET /api/codegen/sessions/:id
  fastify.get<{ Params: { id: string } }>('/api/codegen/sessions/:id', async (req, reply) => {
    const s = sessions.get(req.params.id)
    if (!s) return reply.status(404).send({ error: 'Not found' })
    return reply.send(s)
  })

  // DELETE /api/codegen/sessions/:id
  fastify.delete<{ Params: { id: string } }>('/api/codegen/sessions/:id', async (req, reply) => {
    sessions.delete(req.params.id)
    return reply.send({ deleted: true })
  })
}
