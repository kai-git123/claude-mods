import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Activity,
  Board,
  BoardLayer,
  BoardNode,
  BoardState,
  NodeStatus,
  PlanItem,
  PlanStatus,
} from '../types'

const PANE = 'project-board'
const ARCH_PANE = 'project-board-architecture'
const TITLE = '專案看板'
const BOARD_FILE = '.claude/project-board.json'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const board = atom(
  { plugin: 'project-board', key: 'board' } as const,
  { board: null } as BoardState,
  { shape: 'board-1' },
)
const plan = atom({ plugin: 'project-board', key: 'plan' } as const, [] as PlanItem[], {
  shape: 'plan-1',
})
const activity = atom(
  { plugin: 'project-board', key: 'activity' } as const,
  { now: '等待開始', isBusy: false, task: '', recent: [] } as Activity,
  { shape: 'activity-1' },
)
// The ids of the sections folded shut in the board pane; the lists start shut.
const collapsed = atom(
  { plugin: 'project-board', key: 'collapsed' } as const,
  ['todo', 'done'] as string[],
  { shape: 'collapsed-2' },
)

const GENERATE_PROMPT = `請幫我建立或更新這個專案的「專案看板」檔案 \`${BOARD_FILE}\`。

步驟：
1. 閱讀專案的規劃資料：README、docs/、任何規劃／需求／設計文件（.md、.txt）、package.json / pyproject.toml 等設定檔，以及主要程式碼的目錄結構。若專案還沒有程式碼，就完全依規劃文件整理。
2. 整理出專案架構，依下列 JSON 格式寫入 \`${BOARD_FILE}\`（已有檔案就更新它，保留仍然正確的內容）：

{
  "name": "專案名稱",
  "summary": "一句話說明這個專案在做什麼",
  "layers": [
    { "name": "使用者介面", "nodes": [ { "icon": "🖥️", "name": "網頁前端", "desc": "React + Vite", "status": "doing" } ] },
    { "name": "服務", "nodes": [ { "icon": "⚙️", "name": "API 伺服器", "desc": "Express", "status": "todo" } ] },
    { "name": "資料", "nodes": [ { "icon": "🗄️", "name": "資料庫", "desc": "PostgreSQL", "status": "todo" } ] }
  ],
  "links": [ { "from": "網頁前端", "to": "API 伺服器", "label": "REST" } ],
  "todo": ["登入功能", "部署設定"],
  "done": ["專案初始化"]
}

規則：
- layers 由使用者端往資料端排列（介面 → 服務 → 資料／外部服務），每層 1–6 個節點。
- icon 用一個 emoji；name 簡短（10 字內）；desc 寫技術或用途（15 字內）。
- status 依目前實作進度：done（已完成）、doing（進行中）、todo（尚未開始）。
- links 只列重要的資料流，from / to 要對應節點的 name。
- todo、done 用簡短名詞片語（10 字內），來自規劃中的工作項目與實際完成情況。
3. 寫完後用一兩句話說明整理結果。`

const GUIDE = `本專案有專案看板檔 \`${BOARD_FILE}\`，畫面旁的「專案看板」面板會即時顯示它。完成一項看板 todo 中的工作時，把它從 todo 移到 done；架構有變動（新增或移除模組、服務、資料庫、外部服務）或元件進度改變時，同步更新 layers、links 與節點 status。維持 JSON 格式正確。`

// The board file's last text, so a poll that finds it unchanged writes nothing.
let lastText: string | undefined

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

const toStatus = (value: unknown): NodeStatus =>
  value === 'done' || value === 'doing' ? value : 'todo'

const toList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText).filter(Boolean) : []

export function parseBoard(text: string): Board {
  const raw = JSON.parse(text) as Record<string, unknown>
  const layers: BoardLayer[] = (Array.isArray(raw.layers) ? raw.layers : []).map(
    (layer: Record<string, unknown>) => ({
      name: asText(layer?.name),
      nodes: (Array.isArray(layer?.nodes) ? layer.nodes : []).map(
        (node: Record<string, unknown>): BoardNode => ({
          icon: asText(node?.icon) || '📦',
          name: asText(node?.name) || '(未命名)',
          desc: asText(node?.desc) || undefined,
          status: toStatus(node?.status),
        }),
      ),
    }),
  )
  const links = (Array.isArray(raw.links) ? raw.links : [])
    .map((link: Record<string, unknown>) => ({
      from: asText(link?.from),
      to: asText(link?.to),
      label: asText(link?.label) || undefined,
    }))
    .filter(link => link.from && link.to)

  return {
    name: asText(raw.name) || '未命名專案',
    summary: asText(raw.summary) || undefined,
    layers,
    links,
    todo: toList(raw.todo),
    done: toList(raw.done),
  }
}

// A file of the project the session runs in, by its absolute path.
async function projectPath($: EngineInterface, file: string): Promise<string> {
  const cwd = await $.session.cwd()

  return `${cwd.replace(/[\\/]+$/, '')}/${file}`
}

async function loadBoard($: EngineInterface): Promise<void> {
  let text: string | undefined
  try {
    text = await $.fs.read(await projectPath($, BOARD_FILE))
  } catch {
    text = undefined
  }
  if (text === lastText) return
  lastText = text
  let next: BoardState
  if (text === undefined) {
    next = { board: null }
  } else {
    try {
      next = { board: parseBoard(text) }
    } catch (err) {
      next = { board: null, error: `看板檔格式錯誤：${String(err)}` }
    }
  }
  await update($, board, () => next)
}

const baseName = (path: unknown): string => asText(path).split(/[\\/]/).pop() ?? ''

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

export function describeTool(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `讀取 ${baseName(args.file_path)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `編輯 ${baseName(args.file_path ?? args.notebook_path)}`
    case 'Write':
      return `寫入 ${baseName(args.file_path)}`
    case 'Bash':
    case 'PowerShell':
      return `執行指令：${clip(asText(args.description) || asText(args.command), 40)}`
    case 'Grep':
    case 'Glob':
      return `搜尋 ${clip(asText(args.pattern), 30)}`
    case 'WebSearch':
      return `上網查詢：${clip(asText(args.query), 30)}`
    case 'WebFetch':
      return '讀取網頁'
    case 'Agent':
    case 'Task':
      return `派出子代理：${clip(asText(args.description), 30)}`
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return '更新待辦清單'
    case 'Skill':
      return `載入技能 ${asText(args.skill)}`
  }
  if (tool.endsWith('update_plan')) return '更新待辦清單'
  if (tool.startsWith('mcp__')) return `使用 ${tool.split('__')[1] ?? tool} 工具`

  return `使用 ${tool}`
}

const PLAN_STATUSES: PlanStatus[] = ['pending', 'in_progress', 'completed']
const toPlanStatus = (value: unknown): PlanStatus =>
  PLAN_STATUSES.includes(value as PlanStatus) ? (value as PlanStatus) : 'pending'

// The live task list, read from the calls Claude makes to keep one: TodoWrite,
// TaskCreate / TaskUpdate, and the desktop app's update_plan.
export function applyPlan(
  list: PlanItem[],
  tool: string,
  args: Record<string, unknown>,
): PlanItem[] {
  if (tool === 'TodoWrite' && Array.isArray(args.todos)) {
    return args.todos.map((todo: Record<string, unknown>, i) => ({
      id: String(i + 1),
      text: asText(todo?.content),
      status: toPlanStatus(todo?.status),
    }))
  }
  if (tool === 'TaskCreate') {
    const id = String(list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1)

    return [...list, { id, text: asText(args.subject), status: 'pending' }]
  }
  if (tool === 'TaskUpdate') {
    const id = asText(args.taskId)
    if (args.status === 'deleted') return list.filter(item => item.id !== id)

    return list.map(item =>
      item.id === id
        ? {
            ...item,
            text: asText(args.subject) || item.text,
            status: args.status === undefined ? item.status : toPlanStatus(args.status),
          }
        : item,
    )
  }
  if (!tool.endsWith('update_plan')) return list

  let next = list
  if (Array.isArray(args.items)) {
    next = args.items.map((item: Record<string, unknown>, i) => ({
      id: String(i + 1),
      text: asText(item?.content),
      status: toPlanStatus(item?.status),
    }))
  }
  if (Array.isArray(args.done)) {
    const done = new Set(args.done.map(Number))
    next = next.map((item, i) => (done.has(i + 1) ? { ...item, status: 'completed' } : item))
  }
  if (typeof args.start === 'number') {
    const start = args.start
    next = next.map((item, i) => (i + 1 === start ? { ...item, status: 'in_progress' } : item))
  }
  if (args.advance === true) {
    const current = next.findIndex(item => item.status === 'in_progress')
    next = next.map((item, i) => (i === current ? { ...item, status: 'completed' } : item))
    const following = next.findIndex((item, i) => i > current && item.status === 'pending')
    next = next.map((item, i) => (i === following ? { ...item, status: 'in_progress' } : item))
  }

  return next
}

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

// Cuts a label to a width counted in half-width units: CJK and emoji take two.
const fit = (text: string, units: number): string => {
  let used = 0
  let out = ''
  for (const ch of text) {
    const w = /[\u0000-ÿ]/.test(ch) ? 1 : 2
    if (used + w > units) return `${out}…`
    used += w
    out += ch
  }

  return out
}

type Placed = { node: BoardNode; x: number; y: number; w: number; h: number }

// A pane's cell is about this many CSS pixels wide on a graphical surface.
const CELL_PX = 8

// How many nodes sit side by side in a pane this many cells wide.
export const nodesPerRow = (columns: number): number => (columns < 50 ? 1 : columns < 90 ? 2 : 3)

const STATUS_TEXT: Record<NodeStatus, string> = { done: '完成', doing: '進行中', todo: '未開始' }

// Half-width units of a text: CJK and emoji take two.
const units = (text: string): number => {
  let n = 0
  for (const ch of text) n += /[\u0000-ÿ]/.test(ch) ? 1 : 2

  return n
}

type Point = { x: number; y: number }

// Points along a link's curve, to tell whether it passes behind a card.
const curvePoints = (p1: Point, c1: Point, c2: Point, p2: Point): Point[] => {
  const out: Point[] = []
  for (let t = 0.04; t < 0.97; t += 0.04) {
    const u = 1 - t
    out.push({
      x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
      y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
    })
  }

  return out
}

// A path through `pts` in straight legs with rounded corners.
const elbow = (pts: Point[], radius = 6): string => {
  let d = `M${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [prev, cur, next] = [pts[i - 1], pts[i], pts[i + 1]]
    const lenIn = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const lenOut = Math.hypot(next.x - cur.x, next.y - cur.y)
    if (lenIn === 0 || lenOut === 0) continue
    const r = Math.min(radius, lenIn / 2, lenOut / 2)
    const p1 = { x: cur.x - ((cur.x - prev.x) / lenIn) * r, y: cur.y - ((cur.y - prev.y) / lenIn) * r }
    const p2 = { x: cur.x + ((next.x - cur.x) / lenOut) * r, y: cur.y + ((next.y - cur.y) / lenOut) * r }
    d += ` L${p1.x} ${p1.y} Q${cur.x} ${cur.y} ${p2.x} ${p2.y}`
  }
  const last = pts[pts.length - 1]

  return `${d} L${last.x} ${last.y}`
}

// The curve a link takes between two cards that are not in one row.
const linkCurve = (a: Placed, b: Placed): [Point, Point, Point, Point] => {
  const down = b.y > a.y
  const p1 = { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y }
  const p2 = { x: b.x + b.w / 2, y: down ? b.y - 3 : b.y + b.h + 3 }
  const bend = (p2.y - p1.y) / 2

  return [p1, { x: p1.x, y: p1.y + bend }, { x: p2.x, y: p2.y - bend }, p2]
}

// The architecture in the Notion look: a heading per layer with its progress,
// plain cards with an emoji, a status tag, and thin curved links.
export function architectureSvg(data: Board, columns = 40): string {
  // Drawn at the pane's own width, so the text keeps its size instead of
  // shrinking with a fixed-width picture.
  const W = Math.max(300, Math.round(columns * CELL_PX))
  const PER_ROW = nodesPerRow(columns)
  const PAD = 14
  const GAP = 10
  const NODE_H = 92
  const HEAD_H = 60
  const LAYER_GAP = 30
  const cols = (n: number) => Math.max(1, Math.min(PER_ROW, n))

  // Lays the cards out with `gutter` pixels kept free at the right for links.
  const build = (gutter: number) => {
    const nodeW = (W - 2 * PAD - gutter - (PER_ROW - 1) * GAP) / PER_ROW
    const placed: Placed[] = []
    const headings: string[] = []
    let y = PAD
    for (const layer of data.layers) {
      const n = layer.nodes.length
      const rows = Math.max(1, Math.ceil(n / cols(n)))
      const done = layer.nodes.filter(node => node.status === 'done').length
      const meta = `${n} 個元件 · ${done}/${n} 完成`
      const barX = PAD + units(meta) * 6.2 + 14
      const barW = Math.min(140, W - PAD - gutter - barX)
      headings.push(
        `<text class="h" x="${PAD}" y="${y + 20}">${esc(layer.name)}</text>` +
          `<text class="meta" x="${PAD}" y="${y + 41}">${esc(meta)}</text>` +
          (barW > 30
            ? `<rect class="track" x="${barX}" y="${y + 35}" width="${barW}" height="4" rx="2"/>` +
              (n > 0 && done > 0
                ? `<rect class="fill" x="${barX}" y="${y + 35}" width="${(barW * done) / n}" height="4" rx="2"/>`
                : '')
            : '') +
          `<line class="rule" x1="${PAD}" y1="${y + 51.5}" x2="${W - PAD}" y2="${y + 51.5}"/>`,
      )
      layer.nodes.forEach((node, i) => {
        placed.push({
          node,
          x: PAD + (i % cols(n)) * (nodeW + GAP),
          y: y + HEAD_H + Math.floor(i / cols(n)) * (NODE_H + GAP),
          w: nodeW,
          h: NODE_H,
        })
      })
      y += HEAD_H + rows * NODE_H + (rows - 1) * GAP + LAYER_GAP
    }

    return { placed, headings, H: Math.max(y - LAYER_GAP + PAD + 24, 60) }
  }

  const pairs = (placed: Placed[]) => {
    const byName = new Map(placed.map(p => [p.node.name, p]))

    return (data.links ?? []).flatMap(link => {
      const a = byName.get(link.from)
      const b = byName.get(link.to)

      return a && b ? [{ link, a, b }] : []
    })
  }

  // A link whose curve would pass behind another card goes round by the
  // channel at the right instead.
  const blocked = (placed: Placed[], a: Placed, b: Placed): boolean => {
    if (Math.abs(a.y - b.y) < 1) return false
    const [p1, c1, c2, p2] = linkCurve(a, b)

    return curvePoints(p1, c1, c2, p2).some(pt =>
      placed.some(
        card =>
          card !== a &&
          card !== b &&
          pt.x > card.x + 2 &&
          pt.x < card.x + card.w - 2 &&
          pt.y > card.y + 2 &&
          pt.y < card.y + card.h - 2,
      ),
    )
  }

  const first = build(0)
  const lanes = pairs(first.placed).filter(({ a, b }) => blocked(first.placed, a, b)).length
  const { placed, headings, H } = lanes > 0 ? build(14 + lanes * 10) : first

  const links: string[] = []
  const labels: string[] = []
  const pill = (text: string, cx: number, cy: number) => {
    const label = fit(text, 16)
    const lw = units(label) * 6 + 14

    return (
      `<rect class="lbg" x="${cx - lw / 2}" y="${cy - 9}" width="${lw}" height="18" rx="9"/>` +
      `<text class="ltext" x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(label)}</text>`
    )
  }
  let lane = 0
  for (const { link, a, b } of pairs(placed)) {
    if (Math.abs(a.y - b.y) < 1) {
      // Same row: dip below the cards and come back up, past none of them.
      const ax = a.x + a.w / 2
      const bx = b.x + b.w / 2
      const dip = 26
      links.push(
        `<path class="link" d="M${ax} ${a.y + a.h} C${ax} ${a.y + a.h + dip * 1.3} ${bx} ${b.y + b.h + dip * 1.3} ${bx} ${b.y + b.h + 3}" marker-end="url(#arrow)"/>`,
      )
      if (link.label) labels.push(pill(link.label, (ax + bx) / 2, a.y + a.h + dip))
    } else if (blocked(placed, a, b)) {
      // Round by the right-hand channel, every leg in a gap between cards: out
      // of the source, along the gap beside it to the channel, along the
      // channel, along the gap beside the target, and into it.
      const gx = W - PAD - 6 - lane * 10
      lane += 1
      const down = b.y > a.y
      const ax = a.x + a.w - 24
      const bx = b.x + b.w - 24
      const aEdge = down ? a.y + a.h : a.y
      const bEdge = down ? b.y - 3 : b.y + b.h + 3
      const ya = down ? a.y + a.h + 5 : a.y - 5
      const yb = down ? b.y - 5 : b.y + b.h + 5
      links.push(
        `<path class="link" d="${elbow([
          { x: ax, y: aEdge },
          { x: ax, y: ya },
          { x: gx, y: ya },
          { x: gx, y: yb },
          { x: bx, y: yb },
          { x: bx, y: bEdge },
        ])}" marker-end="url(#arrow)"/>`,
      )
      if (link.label) {
        // In the empty right end of the source card's tag row, over where the
        // line leaves it.
        const label = fit(link.label, 16)
        const lw = units(label) * 6 + 14
        labels.push(pill(link.label, a.x + a.w - 10 - lw / 2, a.y + a.h - 19))
      }
    } else {
      const [p1, c1, c2, p2] = linkCurve(a, b)
      links.push(
        `<path class="link" d="M${p1.x} ${p1.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}" marker-end="url(#arrow)"/>`,
      )
      if (link.label) labels.push(pill(link.label, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2))
    }
  }

  const cards = placed.map(({ node, x, y: ny, w, h }) => {
    const status = node.status ?? 'todo'
    const tag = STATUS_TEXT[status]
    const tagW = units(tag) * 6 + 16

    return (
      `<g class="card"><title>${esc(`${node.name}${node.desc ? `：${node.desc}` : ''}（${tag}）`)}</title>` +
      `<rect class="box" x="${x}" y="${ny}" width="${w}" height="${h}" rx="6"/>` +
      `<text x="${x + 12}" y="${ny + 30}" font-size="20">${esc(node.icon)}</text>` +
      `<text class="name" x="${x + 42}" y="${ny + 27}">${esc(fit(node.name, Math.floor((w - 54) / 7.5)))}</text>` +
      (node.desc
        ? `<text class="desc" x="${x + 12}" y="${ny + 53}">${esc(fit(node.desc, Math.floor((w - 24) / 6.3)))}</text>`
        : '') +
      `<rect class="tag ${status}" x="${x + 12}" y="${ny + h - 28}" width="${tagW}" height="18" rx="4"/>` +
      `<text class="tagt ${status}" x="${x + 20}" y="${ny + h - 15}">${tag}</text>` +
      `</g>`
    )
  })

  return (
    // Real pixel sizes: with a percentage the surface has no size to show the
    // picture at, and draws it a few dozen pixels wide.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<style>` +
    `svg{--bg:#ffffff;--card:#ffffff;--cardh:#f7f7f5;--border:#e9e9e7;--text:#37352f;--muted:#787774;--rule:#ededeb;--track:#e9e9e7;--fill:#4dab9a;--link:#a5a29b;` +
    `--done-bg:#dbeddb;--done-fg:#1c3829;--doing-bg:#fdecc8;--doing-fg:#402c1b;--todo-bg:#e3e2e0;--todo-fg:#32302c}` +
    `@media (prefers-color-scheme: dark){svg{--bg:#191919;--card:#252525;--cardh:#2e2e2e;--border:#2f2f2f;--text:#ebebeb;--muted:#9b9b9b;--rule:#2f2f2f;--track:#323232;--fill:#71cc97;--link:#6b6b6b;` +
    `--done-bg:#233e2f;--done-fg:#71cc97;--doing-bg:#523d19;--doing-fg:#ecb85e;--todo-bg:#373737;--todo-fg:#b4b4b4}}` +
    `text{font-family:ui-sans-serif,-apple-system,"Segoe UI","Microsoft JhengHei",sans-serif;fill:var(--text)}` +
    `.h{font-size:17px;font-weight:700;paint-order:stroke;stroke:var(--bg);stroke-width:6px}` +
    `.meta{font-size:11.5px;fill:var(--muted);paint-order:stroke;stroke:var(--bg);stroke-width:6px}` +
    `.rule{stroke:var(--rule)}.track{fill:var(--track)}.fill{fill:var(--fill)}` +
    `.box{fill:var(--card);stroke:var(--border)}.card:hover .box{fill:var(--cardh)}` +
    `.name{font-size:14.5px;font-weight:600}.desc{font-size:12px;fill:var(--muted)}` +
    `.tag.done{fill:var(--done-bg)}.tag.doing{fill:var(--doing-bg)}.tag.todo{fill:var(--todo-bg)}` +
    `.tagt{font-size:11px}.tagt.done{fill:var(--done-fg)}.tagt.doing{fill:var(--doing-fg)}.tagt.todo{fill:var(--todo-fg)}` +
    `.link{fill:none;stroke:var(--link);stroke-width:1.4}` +
    `.lbg{fill:var(--bg);stroke:var(--border)}.ltext{font-size:10.5px;fill:var(--muted)}` +
    `#arrow path{fill:var(--link)}` +
    `</style>` +
    `<rect width="${W}" height="${H}" fill="var(--bg)"/>` +
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>` +
    links.join('') +
    headings.join('') +
    cards.join('') +
    labels.join('') +
    `</svg>`
  )
}

const STATUS_MARK: Record<NodeStatus, string> = { done: '✓', doing: '▶', todo: '○' }

type RenderEvent = Parameters<EngineInterface['ui']['resolve']>[0]

// The architecture in a pane `columns` cells wide: a picture where the
// surface draws SVG, an indented outline on the terminal.
async function drawArchitecture($: EngineInterface, e: RenderEvent, columns: number) {
  const { Box, Text } = $.ui.resolve(e)
  const { board: data, error } = await read($, board)
  if (!data) {
    return <Text dimColor>{error ?? '這個專案還沒有看板檔（.claude/project-board.json）。'}</Text>
  }
  if (e.surface === 'terminal') {
    return (
      <Box flexDirection="column">
        {data.layers.map((layer, i) => (
          <Box flexDirection="column">
            <Text weight="bold">【{layer.name}】</Text>
            {layer.nodes.map(node => (
              <Text>
                {'  '}
                {node.icon} {node.name} {STATUS_MARK[node.status ?? 'todo']}
                {node.desc ? <Text dimColor> {node.desc}</Text> : ''}
              </Text>
            ))}
            {i < data.layers.length - 1 && <Text dimColor>{'      ↓'}</Text>}
          </Box>
        ))}
      </Box>
    )
  }
  const { Svg } = $.ui.resolve(e as RenderEvent & { surface: 'desktop' })

  return (
    <Svg
      source={architectureSvg(data, columns)}
      alt={`${data.name} 的架構圖：${data.layers.map(l => `${l.name}（${l.nodes.map(n => n.name).join('、')}）`).join(' → ')}`}
      isInteractive
    />
  )
}

const LIVE_FILE = '.claude/project-board-live.json'

// Whether the window program reads this project; only then is the live file kept.
let liveOn = false

// The session's status and task list, for the window program, which cannot
// see the session.
async function writeLive($: EngineInterface): Promise<void> {
  if (!liveOn) return
  const live = {
    activity: await read($, activity),
    plan: await read($, plan),
    updatedAt: Date.now(),
  }
  try {
    await $.fs.write(await projectPath($, LIVE_FILE), JSON.stringify(live, null, 2))
  } catch {
    // A project folder that cannot be written leaves the window without live status.
  }
}

const psQuote = (text: string): string => text.replace(/'/g, "''")

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'project-board',
      description: '開關專案看板；init 依規劃產生架構；window 開啟大視窗',
    })
    await loadBoard($)
    $.clock.every(5000, () => void loadBoard($))
    try {
      await $.fs.stat(await projectPath($, LIVE_FILE))
      liveOn = true
    } catch {
      liveOn = false
    }

    return next(e)
  })

  on('command.run', { command: 'project-board' }, async ($, e) => {
    if (e.args.trim() === 'window') {
      liveOn = true
      await writeLive($)
      const exe = `${$.plugin.root}/window/ProjectBoard.exe`.replace(/\//g, '\\')
      const cwd = await $.session.cwd()
      try {
        await $.process.run(
          [
            'powershell',
            '-NoProfile',
            '-Command',
            `Start-Process -FilePath '${psQuote(exe)}' -ArgumentList '"${psQuote(cwd)}"'`,
          ],
          { timeoutMs: 15000 },
        )
      } catch (err) {
        return { text: `無法開啟視窗：${String(err)}` }
      }

      return { text: '已開啟專案看板視窗。' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    lastText = undefined
    await loadBoard($)
    const { board: data } = await read($, board)
    if (e.args.trim() === 'init' || !data) {
      // A command's own hook may not submit: the prompt would wait on the turn
      // this hook holds. Submit just after it answers.
      $.clock.after(300, () => void $.prompt.submit({ text: GENERATE_PROMPT }))

      return { text: '專案看板已開啟，正在請 Claude 依專案規劃產生架構。' }
    }

    return { text: '專案看板已開啟。' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, activity, a => ({
        ...a,
        isBusy: true,
        now: '思考中…',
        task: e.text ? clip(e.text.replace(/\s+/g, ' '), 80) : a.task,
      }))
      await writeLive($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, activity, a => ({ ...a, isBusy: false, now: '這一輪完成，等待下一個指示' }))
      await writeLive($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    const isMain = e.agentId === undefined
    if (isMain) {
      const text = describeTool(tool, args)
      await update($, activity, a => ({
        ...a,
        isBusy: true,
        now: text,
        recent: [text, ...a.recent].slice(0, 5),
      }))
      await writeLive($)
    }
    const ran = await next(e)
    const failed = 'deny' in ran || (ran as { isError?: boolean }).isError === true
    if (isMain && !failed) {
      await update($, plan, list => applyPlan(list, tool, args))
      await writeLive($)
    }
    if (baseName(args.file_path) === 'project-board.json') await loadBoard($)

    return ran
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const state = await read($, board)
    if (!state.board) return composed

    return {
      sections: [...composed.sections, { id: 'project-board:guide', text: GUIDE, scope: 'session' }],
    }
  })

  on('ui.render', { component: 'Pane', requestId: ARCH_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { board: data } = await read($, board)

    return (
      <Box flexDirection="column" gap={1}>
        <Text size="heading" weight="bold">
          🏗️ {data?.name ?? '專案'} 架構
        </Text>
        {await drawArchitecture($, e, e.props.bodyColumns)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { board: data } = await read($, board)
    const items = await read($, plan)
    const now = await read($, activity)
    const closed = await read($, collapsed)

    // A section's title is a Button that folds it; folded sections leave the
    // pane's room to the architecture.
    const section = (id: string, title: string, body: () => unknown) => (
      <Box flexDirection="column">
        <Button
          key={`fold-${id}`}
          plain
          onPress={() =>
            update($, collapsed, list =>
              list.includes(id) ? list.filter(one => one !== id) : [...list, id],
            )
          }
        >
          {closed.includes(id) ? '▸' : '▾'} <Text weight="semibold">{title}</Text>
        </Button>
        {!closed.includes(id) && body()}
      </Box>
    )

    const todo = [
      ...items.filter(item => item.status !== 'completed').map(item => ({
        text: item.text,
        isActive: item.status === 'in_progress',
      })),
      ...(data?.todo ?? []).map(text => ({ text, isActive: false })),
    ]
    const done = [
      ...items.filter(item => item.status === 'completed').map(item => item.text),
      ...(data?.done ?? []),
    ]

    const chip = (text: string, color: string, mark: string) => (
      <Box borderStyle="round" borderColor={color} paddingX={1}>
        <Text color={color}>
          {mark} {text}
        </Text>
      </Box>
    )

    const generate = () => void $.prompt.submit({ text: GENERATE_PROMPT })
    const architecture = await drawArchitecture($, e, e.props.bodyColumns)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text size="heading" weight="bold">
            🏷️ {data?.name ?? '專案看板'}
          </Text>
          {data?.summary && <Text dimColor>{data.summary}</Text>}
        </Box>

        {section('status', '🧭 目前狀況', () => (
          <Box flexDirection="column">
            <Text color={now.isBusy ? 'warning' : 'success'}>
              {now.isBusy ? '● 進行中' : '○ 閒置'}　{now.now}
            </Text>
            {now.task && <Text dimColor>任務：{now.task}</Text>}
            {now.recent.slice(1).map(line => (
              <Text dimColor size="caption">
                · {line}
              </Text>
            ))}
          </Box>
        ))}

        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text weight="semibold">🏗️ 架構</Text>
            {data && (
              <Button
                key="zoom"
                label="🔍 放大架構圖"
                onPress={() => void $.ui.open({ id: ARCH_PANE, title: '架構圖', columns: 120 })}
              />
            )}
          </Box>
          {architecture}
        </Box>

        {section('todo', `📋 待辦事項（${todo.length}）`, () =>
          todo.length === 0 ? (
            <Text dimColor>目前沒有待辦</Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" gap="xs">
              {todo.map(item =>
                item.isActive ? chip(item.text, 'warning', '▶') : chip(item.text, 'subtle', '○'),
              )}
            </Box>
          ),
        )}

        {section('done', `✅ 已完成（${done.length}）`, () =>
          done.length === 0 ? (
            <Text dimColor>尚無完成項目</Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" gap="xs">
              {done.map(text => chip(text, 'success', '✓'))}
            </Box>
          ),
        )}

        <Box flexDirection="row" gap="sm">
          <Button key="generate" variant="primary" label={data ? '依規劃更新架構' : '依專案規劃產生架構'} onPress={generate} />
          <Button
            key="refresh"
            label="重新整理"
            onPress={() => {
              lastText = undefined
              void loadBoard($)
            }}
          />
        </Box>
      </Box>
    )
  })
}
