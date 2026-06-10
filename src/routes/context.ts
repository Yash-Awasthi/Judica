import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'

interface FileResult {
  path: string
  name: string
  size: number
}

interface SymbolResult {
  name: string
  type: string
  file: string
  line: number
  signature: string
}

interface WebResult {
  title: string
  url: string
  snippet: string
}

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'out', '.cache'])
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.md'])

function walkFiles(dir: string, results: FileResult[] = [], depth = 0): FileResult[] {
  if (depth > 6) return results
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, results, depth + 1)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (CODE_EXTS.has(ext) || ext === '.json' || ext === '.yaml' || ext === '.yml') {
        try {
          const stat = fs.statSync(full)
          results.push({ path: full, name: entry.name, size: stat.size })
        } catch {}
      }
    }
  }
  return results
}

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  if (h.includes(n)) return true
  // basic fuzzy: all chars of needle appear in order in haystack
  let hi = 0
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni], hi)
    if (idx === -1) return false
    hi = idx + 1
  }
  return true
}

const SYMBOL_RE = /export\s+(function|const|class|type|interface|enum|abstract class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/

function extractSymbols(filePath: string, q: string): SymbolResult[] {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }
  const results: SymbolResult[] = []
  const lines = content.split('\n')
  lines.forEach((line, i) => {
    const m = SYMBOL_RE.exec(line)
    if (m) {
      const name = m[2]
      if (!q || fuzzyMatch(name, q)) {
        results.push({
          name,
          type: m[1],
          file: filePath,
          line: i + 1,
          signature: line.trim().slice(0, 120),
        })
      }
    }
  })
  return results
}

export async function contextRoutes(fastify: FastifyInstance) {
  // GET /api/context/files?q=
  fastify.get<{ Querystring: { q?: string } }>('/api/context/files', async (req, reply) => {
    const q = req.query.q ?? ''
    const root = process.cwd()
    const all = walkFiles(root)
    const filtered = q
      ? all.filter((f) => fuzzyMatch(f.name, q) || fuzzyMatch(f.path, q))
      : all
    // Make paths relative
    const results = filtered.slice(0, 50).map((f) => ({
      path: path.relative(root, f.path),
      name: f.name,
      size: f.size,
    }))
    return reply.send(results)
  })

  // GET /api/context/symbols?q=&file=
  fastify.get<{ Querystring: { q?: string; file?: string } }>('/api/context/symbols', async (req, reply) => {
    const q = req.query.q ?? ''
    const fileFilter = req.query.file

    const root = process.cwd()
    let files: FileResult[]

    if (fileFilter) {
      const resolved = path.resolve(root, fileFilter)
      try {
        const stat = fs.statSync(resolved)
        files = [{ path: resolved, name: path.basename(resolved), size: stat.size }]
      } catch {
        files = []
      }
    } else {
      files = walkFiles(root).filter((f) => ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(f.name)))
    }

    const results: SymbolResult[] = []
    for (const f of files.slice(0, 200)) {
      const syms = extractSymbols(f.path, q)
      for (const s of syms) {
        results.push({ ...s, file: path.relative(root, s.file) })
      }
      if (results.length >= 50) break
    }

    return reply.send(results)
  })

  // GET /api/context/web?q=
  fastify.get<{ Querystring: { q?: string } }>('/api/context/web', async (req, reply) => {
    const q = req.query.q ?? ''
    // Returns mock results — real implementation routes through Onyx web search connector
    const mock: WebResult[] = [
      {
        title: `Web search: "${q}" — connect web search connector`,
        url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        snippet: 'Connect the web search connector in Settings → Connectors to enable live results.',
      },
    ]
    return reply.send(mock)
  })

  // POST /api/context/resolve
  fastify.post<{
    Body: { mentions: Array<{ type: 'file' | 'symbol' | 'web'; value: string }> }
  }>('/api/context/resolve', async (req, reply) => {
    const { mentions } = req.body ?? { mentions: [] }
    const root = process.cwd()
    const MAX_CHARS = 4000

    const resolved = await Promise.all(
      mentions.map(async (m) => {
        if (m.type === 'file') {
          try {
            const full = path.resolve(root, m.value)
            const content = fs.readFileSync(full, 'utf-8').slice(0, MAX_CHARS)
            const tokens = Math.ceil(content.length / 4)
            return { ...m, content, tokens }
          } catch {
            return { ...m, content: `[File not found: ${m.value}]`, tokens: 10 }
          }
        }

        if (m.type === 'symbol') {
          // Find the symbol across codebase
          const files = walkFiles(root).filter((f) =>
            ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(f.name))
          )
          for (const f of files.slice(0, 300)) {
            const syms = extractSymbols(f.path, m.value)
            const match = syms.find((s) => s.name === m.value)
            if (match) {
              let fileContent: string
              try {
                fileContent = fs.readFileSync(f.path, 'utf-8')
              } catch {
                continue
              }
              const lines = fileContent.split('\n')
              const body = lines.slice(Math.max(0, match.line - 1), match.line + 30).join('\n').slice(0, MAX_CHARS)
              return { ...m, content: body, tokens: Math.ceil(body.length / 4) }
            }
          }
          return { ...m, content: `[Symbol not found: ${m.value}]`, tokens: 10 }
        }

        // web — return as-is (snippet already fetched client-side)
        return { ...m, content: m.value, tokens: Math.ceil(m.value.length / 4) }
      })
    )

    return reply.send({ resolved })
  })
}
