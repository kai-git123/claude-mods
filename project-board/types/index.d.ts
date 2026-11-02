export type NodeStatus = 'done' | 'doing' | 'todo'

export type BoardNode = {
  icon: string
  name: string
  desc?: string
  status?: NodeStatus
}

export type BoardLayer = { name: string; nodes: BoardNode[] }

export type BoardLink = { from: string; to: string; label?: string }

export type Board = {
  name: string
  summary?: string
  layers: BoardLayer[]
  links?: BoardLink[]
  todo: string[]
  done: string[]
}

export type BoardState = { board: Board | null; error?: string }

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type PlanItem = { id: string; text: string; status: PlanStatus }

export type Activity = {
  now: string
  isBusy: boolean
  task: string
  recent: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'project-board': {
      board: Shaped<BoardState>
      plan: Shaped<PlanItem[]>
      activity: Shaped<Activity>
      collapsed: Shaped<string[]>
    }
  }
}
