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

type Placed = { node: BoardNode; layer: number; x: number; y: number; w: number; h: number }

// A pane's cell is about this many CSS pixels wide on a graphical surface.
const CELL_PX = 8

// Outer margin, a group's inner margin, and a node's column.
const PAD = 14
const INNER = 14
const NODE_W = 132
const NODE_GAP = 16

// How many nodes fit side by side in a drawing `width` pixels wide, with
// `gutter` pixels kept free at the right for links.
const fitPerRow = (width: number, gutter = 0): number =>
  Math.max(1, Math.floor((width - 2 * PAD - 2 * INNER - gutter + NODE_GAP) / (NODE_W + NODE_GAP)))

// How many nodes sit side by side in a pane this many cells wide.
export const nodesPerRow = (columns: number): number =>
  fitPerRow(Math.max(300, Math.round(columns * CELL_PX)))

const STATUS_TEXT: Record<NodeStatus, string> = { done: '完成', doing: '進行中', todo: '未開始' }
const STATUS_COLOR: Record<NodeStatus, string> = { done: '#34d399', doing: '#f5a524', todo: '#8a8d96' }

// One color per layer, in order, readable on light and dark.
const LAYER_COLORS = ['#4f8ef7', '#9b7cf6', '#2fbf8a', '#f0943a', '#e5609a', '#25a9c7']
const layerColor = (i: number): string => LAYER_COLORS[i % LAYER_COLORS.length]

// A #rrggbb color with an alpha.
const alpha = (color: string, a: number): string =>
  color + Math.round(a * 255).toString(16).padStart(2, '0')

// Half-width units of a text: CJK and emoji take two.
const units = (text: string): number => {
  let n = 0
  for (const ch of text) n += /[\u0000-ÿ]/.test(ch) ? 1 : 2

  return n
}

// A progress ring around (cx, cy).
const ring = (cx: number, cy: number, r: number, width: number, part: number, color: string): string => {
  const length = 2 * Math.PI * r

  return (
    `<circle class="track" cx="${cx}" cy="${cy}" r="${r}" stroke-width="${width}"/>` +
    (part > 0
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${length * part} ${length}" transform="rotate(-90 ${cx} ${cy})"/>`
      : '')
  )
}

type Point = { x: number; y: number }

// Points along a link's curve, to tell whether it passes behind a node.
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
const elbow = (pts: Point[], radius = 8): string => {
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

// The curve a link takes between two nodes that are not in one row: from the
// bottom of the source's text to the top of the target's tile, or back up.
const linkCurve = (a: Placed, b: Placed): [Point, Point, Point, Point] => {
  const down = b.y > a.y
  const p1 = { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y }
  const p2 = { x: b.x + b.w / 2, y: down ? b.y - 2 : b.y + b.h + 3 }
  const bend = (p2.y - p1.y) / 2

  return [p1, { x: p1.x, y: p1.y + bend }, { x: p2.x, y: p2.y - bend }, p2]
}

// The architecture as a system diagram: the project's progress ring at the
// top, each layer a dashed group with its own color and ring, each node a
// colored icon tile with a status dot, and curved links in the source's color.
export function architectureSvg(data: Board, columns = 40): string {
  // Drawn at the pane's own width, so the text keeps its size instead of
  // shrinking with a fixed-width picture.
  const W = Math.max(300, Math.round(columns * CELL_PX))
  const NODE_H = 126
  const ROW_GAP = 30
  const HERO_H = 58
  const GROUP_GAP = 46
  const TOP_PAD = 30
  const BOTTOM_PAD = 16
  const DIP = 22

  const sameRow = (a: Placed, b: Placed) => Math.abs(a.y - b.y) < 1
  const pairs = (placed: Placed[]) => {
    const byName = new Map(placed.map(p => [p.node.name, p]))

    return (data.links ?? []).flatMap(link => {
      const a = byName.get(link.from)
      const b = byName.get(link.to)

      return a && b ? [{ link, a, b }] : []
    })
  }

  // Lays the nodes out with `gutter` pixels kept free at the right for links.
  const build = (gutter: number) => {
    const avail = W - 2 * PAD - 2 * INNER - gutter
    const cap = fitPerRow(W, gutter)
    const placed: Placed[] = []
    const groups: { layer: number; y: number; h: number }[] = []
    let y = PAD + HERO_H + 16
    data.layers.forEach((layer, li) => {
      const n = layer.nodes.length
      const rows = Math.max(1, Math.ceil(n / cap))
      // Rows as even as they can be, each centred.
      const per = Math.max(1, Math.ceil(n / rows))
      layer.nodes.forEach((node, i) => {
        const row = Math.floor(i / per)
        const inRow = Math.min(per, n - row * per)
        const rowW = inRow * NODE_W + (inRow - 1) * NODE_GAP
        placed.push({
          node,
          layer: li,
          x: PAD + INNER + (avail - rowW) / 2 + (i % per) * (NODE_W + NODE_GAP),
          y: y + TOP_PAD + row * (NODE_H + ROW_GAP),
          w: NODE_W,
          h: NODE_H,
        })
      })
      groups.push({ layer: li, y, h: TOP_PAD + rows * NODE_H + (rows - 1) * ROW_GAP + BOTTOM_PAD })
      y += groups[groups.length - 1].h + GROUP_GAP
    })
    // Room under a group whose last row has a link within the row.
    let shift = 0
    for (const g of groups) {
      g.y += shift
      const mine = placed.filter(p => p.layer === g.layer)
      for (const p of mine) p.y += shift
      const lastY = Math.max(...mine.map(p => p.y), -1)
      const dips = pairs(placed).some(({ a, b }) => a.layer === g.layer && sameRow(a, b) && Math.abs(a.y - lastY) < 1)
      if (dips) {
        g.h += DIP + 6
        shift += DIP + 6
      }
    }
    const end = groups.length ? groups[groups.length - 1].y + groups[groups.length - 1].h : PAD + HERO_H

    return { placed, groups, H: end + PAD + 4 }
  }

  // A link whose curve would pass behind another node goes round by the
  // channel at the right instead.
  const blocked = (placed: Placed[], a: Placed, b: Placed): boolean => {
    if (sameRow(a, b)) return false
    const [p1, c1, c2, p2] = linkCurve(a, b)

    return curvePoints(p1, c1, c2, p2).some(pt =>
      placed.some(
        card =>
          card !== a &&
          card !== b &&
          pt.x > card.x + 4 &&
          pt.x < card.x + card.w - 4 &&
          pt.y > card.y &&
          pt.y < card.y + card.h,
      ),
    )
  }

  const first = build(0)
  const lanes = pairs(first.placed).filter(({ a, b }) => blocked(first.placed, a, b)).length
  const { placed, groups, H } = lanes > 0 ? build(INNER + lanes * 10) : first

  const links: string[] = []
  const labels: string[] = []
  const pill = (text: string, cx: number, cy: number, color: string) => {
    const label = fit(text, 16)
    const lw = units(label) * 6 + 16

    return (
      `<rect class="lbg" x="${cx - lw / 2}" y="${cy - 10}" width="${lw}" height="20" rx="10" stroke="${alpha(color, 0.6)}"/>` +
      `<text class="ltext" x="${cx}" y="${cy + 4}" text-anchor="middle" style="fill:${color}">${esc(label)}</text>`
    )
  }
  let lane = 0
  for (const { link, a, b } of pairs(placed)) {
    const color = layerColor(a.layer)
    const line = (d: string) =>
      `<path class="link" d="${d}" stroke="${color}" marker-end="url(#ar${a.layer % LAYER_COLORS.length})"/>`
    const ax = a.x + a.w / 2
    const bx = b.x + b.w / 2
    if (sameRow(a, b)) {
      // Same row: dip below the nodes and come back up, past none of them.
      const y1 = a.y + a.h
      links.push(line(`M${ax} ${y1} C${ax} ${y1 + DIP * 1.4} ${bx} ${y1 + DIP * 1.4} ${bx} ${y1 + 3}`))
      if (link.label) labels.push(pill(link.label, (ax + bx) / 2, y1 + DIP + 2, color))
    } else if (blocked(placed, a, b)) {
      // Round by the right-hand channel, every leg in a gap between nodes.
      const gx = W - PAD - INNER / 2 - 4 - lane * 10
      lane += 1
      const down = b.y > a.y
      const ya = down ? a.y + a.h + 10 : a.y - 10
      const yb = down ? b.y - 10 : b.y + b.h + 10
      links.push(
        line(
          elbow([
            { x: ax, y: down ? a.y + a.h : a.y },
            { x: ax, y: ya },
            { x: gx, y: ya },
            { x: gx, y: yb },
            { x: bx, y: yb },
            { x: bx, y: down ? b.y - 2 : b.y + b.h + 3 },
          ]),
        ),
      )
      if (link.label) labels.push(pill(link.label, (ax + gx) / 2, ya, color))
    } else {
      const [p1, c1, c2, p2] = linkCurve(a, b)
      links.push(line(`M${p1.x} ${p1.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`))
      if (link.label) labels.push(pill(link.label, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, color))
    }
  }

  // The project's own progress, over every node.
  const all = data.layers.flatMap(layer => layer.nodes)
  const allDone = all.filter(node => node.status === 'done').length
  const part = all.length ? allDone / all.length : 0
  const wide = W >= 420
  const textW = W - 2 * PAD - 58 - (wide ? 96 : 0)
  const hero =
    ring(PAD + 23, PAD + 23, 20, 4, part, '#7c9cff') +
    `<text class="title" x="${PAD + 56}" y="${PAD + 20}">${esc(fit(data.name, Math.floor(textW / 9)))}</text>` +
    (data.summary
      ? `<text class="muted" font-size="12" x="${PAD + 56}" y="${PAD + 40}">${esc(fit(data.summary, Math.floor(textW / 6.2)))}</text>`
      : '') +
    (wide
      ? `<text class="pct" x="${W - PAD}" y="${PAD + 22}" text-anchor="end">${Math.round(part * 100)}%</text>` +
        `<text class="muted" font-size="11.5" x="${W - PAD}" y="${PAD + 40}" text-anchor="end">${allDone}/${all.length} 元件完成</text>`
      : '')

  const frames = groups.map(
    g =>
      `<rect class="group" x="${PAD}" y="${g.y}" width="${W - 2 * PAD}" height="${g.h}" rx="14" stroke="${alpha(layerColor(g.layer), 0.45)}"/>`,
  )
  const tabs = groups.map(g => {
    const layer = data.layers[g.layer]
    const color = layerColor(g.layer)
    const n = layer.nodes.length
    const done = layer.nodes.filter(node => node.status === 'done').length
    const name = fit(layer.name, Math.floor((W - 2 * PAD - 120) / 6.6))
    const count = `${done}/${n}`
    const x = PAD + 16
    const w = 30 + units(name) * 6.6 + 8 + units(count) * 6.2 + 12

    return (
      `<rect class="tab" x="${x}" y="${g.y - 12}" width="${w}" height="24" rx="12" stroke="${alpha(color, 0.5)}"/>` +
      ring(x + 14, g.y, 7, 2.5, n ? done / n : 0, color) +
      `<text class="tabt" x="${x + 28}" y="${g.y + 4.5}" style="fill:${color}">${esc(name)}<tspan class="cnt" dx="7">${count}</tspan></text>`
    )
  })

  const nodes = placed.map(({ node, layer, x, y, w }) => {
    const status = node.status ?? 'todo'
    const cx = x + w / 2

    return (
      `<g class="node"><title>${esc(`${node.name}${node.desc ? `：${node.desc}` : ''}（${STATUS_TEXT[status]}）`)}</title>` +
      `<rect x="${cx - 30}" y="${y + 4}" width="60" height="60" rx="16" fill="url(#g${layer % LAYER_COLORS.length})" filter="url(#sh)"/>` +
      `<text x="${cx}" y="${y + 44}" font-size="28" text-anchor="middle">${esc(node.icon)}</text>` +
      `<circle cx="${cx + 28}" cy="${y + 6}" r="6" fill="${STATUS_COLOR[status]}" class="dot"/>` +
      `<text class="name" x="${cx}" y="${y + 86}" text-anchor="middle">${esc(fit(node.name, Math.floor(w / 7)))}</text>` +
      (node.desc
        ? `<text class="muted" font-size="11.5" x="${cx}" y="${y + 103}" text-anchor="middle">${esc(fit(node.desc, Math.floor(w / 6)))}</text>`
        : '') +
      `<text class="st" x="${cx}" y="${y + 120}" text-anchor="middle" style="fill:${status === 'todo' ? 'var(--muted)' : STATUS_COLOR[status]}">● ${STATUS_TEXT[status]}</text>` +
      `</g>`
    )
  })

  const defs =
    `<filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity=".3"/></filter>` +
    LAYER_COLORS.map(
      (c, i) =>
        `<linearGradient id="g${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".75"/><stop offset="1" stop-color="${c}" stop-opacity=".3"/></linearGradient>` +
        `<marker id="ar${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="${c}"/></marker>`,
    ).join('')

  return (
    // Real pixel sizes: with a percentage the surface has no size to show the
    // picture at, and draws it a few dozen pixels wide.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<style>` +
    `svg{--bg:#ffffff;--text:#2b2d33;--muted:#6b6f78;--track:#e3e5e9}` +
    `@media (prefers-color-scheme: dark){svg{--bg:#141517;--text:#ececf1;--muted:#8f929b;--track:#2c2e33}}` +
    `text{font-family:ui-sans-serif,-apple-system,"Segoe UI","Microsoft JhengHei",sans-serif;fill:var(--text)}` +
    `.title{font-size:18px;font-weight:700}.pct{font-size:21px;font-weight:700}.muted{fill:var(--muted)}` +
    `.track{fill:none;stroke:var(--track)}` +
    `.group{fill:none;stroke-width:1.4;stroke-dasharray:6 5}` +
    `.tab{fill:var(--bg);stroke-width:1.4}.tabt{font-size:12.5px;font-weight:700}.cnt{font-weight:400;opacity:.75}` +
    `.name{font-size:13.5px;font-weight:600}.st{font-size:10.5px}.dot{stroke:var(--bg);stroke-width:3}` +
    `.link{fill:none;stroke-width:1.6;stroke-opacity:.8}` +
    `.lbg{fill:var(--bg)}.ltext{font-size:11px}` +
    `</style>` +
    `<rect width="${W}" height="${H}" fill="var(--bg)"/>` +
    `<defs>${defs}</defs>` +
    hero +
    frames.join('') +
    links.join('') +
    tabs.join('') +
    nodes.join('') +
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
