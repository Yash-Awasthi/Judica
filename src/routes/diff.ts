import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'

interface HunkLine {
  type: 'added' | 'removed' | 'context'
  content: string
  oldLine?: number
  newLine?: number
}

interface Hunk {
  id: string
  filename: string
  oldStart: number
  newStart: number
  lines: HunkLine[]
  status: 'pending' | 'accepted' | 'rejected'
}

interface Snapshot {
  id: string
  files: Array<{ path: string; content: string }>
  created_at: string
}

// In-memory snapshot store (swap for filesystem/DB in production)
const snapshots = new Map<string, Snapshot>()

function applyHunksToContent(original: string, hunks: Hunk[]): string {
  const lines = original.split('\n')
  const result = [...lines]
  let offset = 0

  for (const hunk of hunks) {
    const removedCount = hunk.lines.filter(l => l.type === 'removed').length
    const addedLines   = hunk.lines.filter(l => l.type === 'added').map(l => l.content)
    const startIdx     = hunk.oldStart - 1 + offset

    result.splice(startIdx, removedCount, ...addedLines)
    offset += addedLines.length - removedCount
  }

  return result.join('\n')
}

export async function diffRoutes(fastify: FastifyInstance) {
  // POST /api/diff/parse
  // Returns structured hunk array from original + modified strings
  fastify.post<{
    Body: { original: string; modified: string; filename: string }
  }>('/api/diff/parse', async (req, reply) => {
    const { original = '', modified = '', filename = 'untitled' } = req.body ?? {}

    // Simple line-diff using longest common subsequence (LCS)
    const origLines = original.split('\n')
    const modLines  = modified.split('\n')

    // Build diff via DP LCS
    const n = origLines.length, m = modLines.length
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] = origLines[i - 1] === modLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }

    // Backtrack
    type Op = { type: 'equal' | 'insert' | 'delete'; value: string }
    const ops: Op[] = []
    let i = n, j = m
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
        ops.unshift({ type: 'equal', value: origLines[i - 1] }); i--; j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.unshift({ type: 'insert', value: modLines[j - 1] }); j--
      } else {
        ops.unshift({ type: 'delete', value: origLines[i - 1] }); i--
      }
    }

    // Group into hunks with 3-line context
    const CONTEXT = 3
    const changes = ops.map((op, idx) => ({ ...op, idx })).filter(o => o.type !== 'equal')
    if (changes.length === 0) return reply.send([])

    const groups: typeof changes[] = [[changes[0]]]
    for (let ci = 1; ci < changes.length; ci++) {
      const last = groups[groups.length - 1]
      if (changes[ci].idx - last[last.length - 1].idx > CONTEXT * 2 + 1) {
        groups.push([changes[ci]])
      } else {
        last.push(changes[ci])
      }
    }

    const hunks: Hunk[] = []
    let oldLineNum = 1, newLineNum = 1

    for (const group of groups) {
      const startIdx = Math.max(0, group[0].idx - CONTEXT)
      const endIdx   = Math.min(ops.length - 1, group[group.length - 1].idx + CONTEXT)

      const lines: HunkLine[] = []
      let lo = oldLineNum, ln = newLineNum

      // Advance counters
      for (let ci = 0; ci < startIdx; ci++) {
        if (ops[ci].type !== 'insert') lo++
        if (ops[ci].type !== 'delete') ln++
      }
      const hunkOld = lo, hunkNew = ln

      for (let ci = startIdx; ci <= endIdx; ci++) {
        const op = ops[ci]
        if (op.type === 'equal')  lines.push({ type: 'context', content: op.value, oldLine: lo++, newLine: ln++ })
        else if (op.type === 'delete') lines.push({ type: 'removed', content: op.value, oldLine: lo++ })
        else lines.push({ type: 'added', content: op.value, newLine: ln++ })
      }

      hunks.push({
        id: `hunk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        filename,
        oldStart: hunkOld,
        newStart: hunkNew,
        lines,
        status: 'pending',
      })
    }

    return reply.send(hunks)
  })

  // POST /api/diff/apply
  fastify.post<{
    Body: { patches: Array<{ filename: string; hunks: Hunk[] }> }
  }>('/api/diff/apply', async (req, reply) => {
    const { patches = [] } = req.body ?? {}
    const rollbackId = `rb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const snapshot: Snapshot = { id: rollbackId, files: [], created_at: new Date().toISOString() }
    const applied: string[] = []
    const failed: Array<{ filename: string; error: string }> = []

    for (const patch of patches) {
      const filePath = path.resolve(process.cwd(), patch.filename)
      try {
        let original = ''
        try { original = fs.readFileSync(filePath, 'utf-8') } catch {}
        snapshot.files.push({ path: patch.filename, content: original })

        const newContent = applyHunksToContent(original, patch.hunks)
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, newContent, 'utf-8')
        applied.push(patch.filename)
      } catch (e) {
        failed.push({ filename: patch.filename, error: String(e) })
      }
    }

    if (snapshot.files.length > 0) {
      snapshots.set(rollbackId, snapshot)
    }

    return reply.send({ applied, failed, rollbackId })
  })

  // POST /api/diff/rollback
  fastify.post<{ Body: { rollbackId: string } }>('/api/diff/rollback', async (req, reply) => {
    const { rollbackId } = req.body ?? {}
    const snapshot = snapshots.get(rollbackId)
    if (!snapshot) return reply.status(404).send({ error: 'Snapshot not found' })

    const restored: string[] = []
    for (const file of snapshot.files) {
      try {
        const full = path.resolve(process.cwd(), file.path)
        fs.writeFileSync(full, file.content, 'utf-8')
        restored.push(file.path)
      } catch {}
    }

    snapshots.delete(rollbackId)
    return reply.send({ restored })
  })

  // GET /api/diff/snapshot/:id
  fastify.get<{ Params: { id: string } }>('/api/diff/snapshot/:id', async (req, reply) => {
    const s = snapshots.get(req.params.id)
    if (!s) return reply.status(404).send({ error: 'Not found' })
    return reply.send({ id: s.id, files: s.files.map(f => f.path), created_at: s.created_at })
  })
}
