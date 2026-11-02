import { expect, mock, test } from 'claude-code/testing'

import { applyPlan, architectureSvg, nodesPerRow, parseBoard } from './register'

const PANE = {
  plugin: 'project-board',
  component: 'Pane',
  requestId: 'project-board',
  props: {
    title: '專案看板',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BOARD = JSON.stringify({
  name: '記帳 App',
  summary: '個人記帳工具',
  layers: [
    { name: '介面', nodes: [{ icon: '🖥️', name: '網頁前端', desc: 'React', status: 'doing' }] },
    { name: '資料', nodes: [{ icon: '🗄️', name: '資料庫', status: 'todo' }] },
  ],
  links: [{ from: '網頁前端', to: '資料庫', label: 'SQL' }],
  todo: ['登入功能'],
  done: ['專案初始化'],
})

test('the pane shows the board, status and chips, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'project-board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: BOARD }))
  on('session.cwd', () => ({ value: '/' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: '寫測試', status: 'in_progress', activeForm: '寫測試中' },
    { content: '建立專案', status: 'completed', activeForm: '建立中' },
  ] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'terminal') {
      // The lists start folded; unfolding them holds for the rest of the session.
      expect(await ui.find({ type: 'Text', text: /○ 登入功能/ })).toBeFalsy()
      await ui.press({ key: 'fold-todo' })
      await ui.press({ key: 'fold-done' })
    }

    expect((await ui.find({ type: 'Text', text: /記帳 App/ }))?.text).toContain('記帳 App')
    expect(await ui.find({ type: 'Text', text: /更新待辦清單/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /▶ 寫測試/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /○ 登入功能/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /✓ 建立專案/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /✓ 專案初始化/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('the command opens the pane and asks for a board where none exists', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[] = []
  const prompts: string[] = []
  on('command.register', () => ({ value: { command: 'project-board' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened).toEqual([])
  const answer = await $.command.run({ command: 'project-board', args: '' })
  await clock.advance(500)

  expect(opened).toEqual(['project-board'])
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('.claude/project-board.json')
  expect(JSON.stringify(answer)).toContain('專案看板已開啟')
})

test('window launches the program and keeps the live file for it', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  const runs: string[][] = []
  on('command.register', () => ({ value: { command: 'project-board' } }))
  on('fs.read', () => ({ value: BOARD }))
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    runs.push([...e.argv])

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.cwd', () => ({ value: 'C:\\proj' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'a.py' })
  expect(writes.length).toBe(0)

  const answer = await $.command.run({ command: 'project-board', args: 'window' })
  expect(JSON.stringify(answer)).toContain('已開啟專案看板視窗')
  expect(runs[0][0]).toBe('powershell')
  expect(runs[0].join(' ')).toContain('ProjectBoard.exe')
  expect(runs[0].join(' ')).toContain('C:\\proj')

  await $.tool.call({ tool: 'Read', file_path: 'b.py' })
  const last = writes[writes.length - 1]
  expect(last.path).toBe('C:\\proj\\.claude\\project-board-live.json')
  expect(JSON.parse(last.text).activity.now).toBe('讀取 b.py')
})

test('update_plan items, advance and done move the list along', () => {
  let list = applyPlan([], 'mcp__ccd_turn__update_plan', {
    items: [
      { content: 'A', status: 'in_progress' },
      { content: 'B', status: 'pending' },
      { content: 'C', status: 'pending' },
    ],
  })
  list = applyPlan(list, 'mcp__ccd_turn__update_plan', { advance: true })
  expect(list.map(item => item.status)).toEqual(['completed', 'in_progress', 'pending'])
  list = applyPlan(list, 'mcp__ccd_turn__update_plan', { done: [2], start: 3 })
  expect(list.map(item => item.status)).toEqual(['completed', 'completed', 'in_progress'])
})

test('the architecture SVG names every node', () => {
  const svg = architectureSvg(parseBoard(BOARD))
  expect(svg).toContain('網頁前端')
  expect(svg).toContain('資料庫')
  expect(svg).toContain('marker-end')
})

test('the drawing follows the pane width', () => {
  expect(nodesPerRow(40)).toBe(1)
  expect(nodesPerRow(70)).toBe(2)
  expect(nodesPerRow(120)).toBe(3)
  expect(architectureSvg(parseBoard(BOARD), 120)).toContain('viewBox="0 0 960 ')
})

test('a folded section hides its chips, and the zoom button opens the large pane', async ($, on) => {
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'project-board' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('fs.read', () => ({ value: BOARD }))
  on('session.cwd', () => ({ value: '/' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /待辦事項（1）/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /○ 登入功能/ })).toBeFalsy()
  await ui.press({ key: 'fold-todo' })
  expect(await ui.find({ type: 'Text', text: /○ 登入功能/ })).toBeTruthy()
  await ui.press({ key: 'fold-todo' })
  expect(await ui.find({ type: 'Text', text: /○ 登入功能/ })).toBeFalsy()
  await ui.press({ key: 'zoom' })
  expect(opened).toContain('project-board-architecture')
  await ui.unmount()

  const big = await $.ui.mount({ ...PANE, requestId: 'project-board-architecture', surface: 'desktop' })
  expect(await big.find({ type: 'Text', text: /記帳 App 架構/ })).toBeTruthy()
  await big.unmount()
})
