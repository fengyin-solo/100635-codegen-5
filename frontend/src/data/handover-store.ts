import { saveRows } from './local-store'
import { buildSeedHandoverDB } from './handover-seed'
import type { HandoverDB, HandoverForm } from './handover-types'
import type { EntryRow } from './types'

// 投运前验收移交台账的独立持久化：与通用台账分开存，但任何落库都会镜像一份到
// 通用 "handover" 模块，保证概览/看板与移交台账页面读的是同一次写入的同一份数据。
const HANDOVER_KEY = 'urban-utility-tunnel:handover'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readDB(): HandoverDB {
  const fallback = buildSeedHandoverDB()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(HANDOVER_KEY)
  if (!raw) {
    window.localStorage.setItem(HANDOVER_KEY, JSON.stringify(fallback))
    // 首次打开：立即把种子台账镜像进通用库，概览/看板第一次读就是同一个数。
    publishMirror(fallback.forms)
    return fallback
  }
  try {
    const db = { ...clone(fallback), ...(JSON.parse(raw) as HandoverDB) }
    // 老缓存（本台账上线前）里没有镜像行，每次载入补发一次，保证概览不漏模块。
    publishMirror(db.forms)
    return db
  } catch {
    window.localStorage.setItem(HANDOVER_KEY, JSON.stringify(fallback))
    publishMirror(fallback.forms)
    return fallback
  }
}

let dbCache: HandoverDB | null = null

export function handoverDB(): HandoverDB {
  if (dbCache === null) {
    dbCache = readDB()
  }
  return dbCache
}

// 唯一落库口：页面、服务都不能直接写 localStorage，保证每笔数据都过归属校验。
export function persistHandover(db: HandoverDB): void {
  dbCache = db
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(HANDOVER_KEY, JSON.stringify(db))
  }
  publishMirror(db.forms)
}

// 镜像到通用台账：概览的 created/pending/abnormal 全部由这里的同一份 forms 计算，
// 看板条数与移交台账不可能对不上。
function publishMirror(forms: HandoverForm[]): void {
  const rows: EntryRow[] = forms.map((form) => {
    const start = form.liabilityStart ?? form.takeoverDate ?? form.acceptDate ?? ''
    return {
      id: form.id,
      status: form.status,
      pending: form.status !== '已移交',
      abnormal: form.conclusion === '不合格' || form.status === '已驳回' || form.factTakeover,
      移交单编号: form.handoverNo,
      管廊名称: form.tunnelName,
      建设单位: form.consUnit,
      接收单位: form.recvUnit,
      验收日期: form.acceptDate ?? (form.takeoverDate ? `事实接管 ${form.takeoverDate}` : ''),
      验收结论: form.conclusion,
      缺陷责任期: form.liabilityEnd ? `${start} ~ ${form.liabilityEnd}` : '',
      移交状态: form.status,
    }
  })
  saveRows('handover', rows)
}

export function handoverStorageKey(): string {
  return HANDOVER_KEY
}

// 应用启动时调用：读一次受控库（首次会发布镜像），保证任何入口先打开，概览读数都不缺移交模块。
export function bootstrapHandover(): HandoverDB {
  return handoverDB()
}

export function resetHandoverDB(): HandoverDB {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(HANDOVER_KEY)
  }
  dbCache = null
  return handoverDB()
}
