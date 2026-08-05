// Word-level LCS diff for version comparison (Confluence-style green/red).
// Capped for very large documents; falls back to "everything changed".
export type DiffOp = { kind: 'same' | 'add' | 'del'; text: string }

export function wordDiff(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split(/(\s+)/).filter((w) => w !== '')
  const b = newText.split(/(\s+)/).filter((w) => w !== '')
  if (a.length * b.length > 4_000_000) {
    return [
      { kind: 'del', text: oldText },
      { kind: 'add', text: newText },
    ]
  }
  // LCS table
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  const push = (kind: DiffOp['kind'], text: string) => {
    const last = ops[ops.length - 1]
    if (last && last.kind === kind) last.text += text
    else ops.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < n) push('del', a[i++])
  while (j < m) push('add', b[j++])
  return ops
}
