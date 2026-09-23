import { useEffect, useState } from 'react'

/**
 * 离线队列（重构 3.2 · 03 卷：现场弱网「拍完先存本地、有网再传」）
 * - IndexedDB 存 Blob（结构化克隆原生支持），零依赖
 * - 只承诺：暂存 + 联网自动重试；字段级冲突留真机试点（执行计划 3.2 范围声明）
 * - 本模块是纯存储层；上传/回传由调用方（MfgPhotoPicker）注入
 */

const DB_NAME = 'txgk-offline'
const STORE = 'queue'
const VERSION = 1

export interface QueuedPhoto {
  id: string
  kind: 'photo'
  projectNo: string
  refNo: string
  blob: Blob
  createdAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function queueAdd(item: Omit<QueuedPhoto, 'id' | 'createdAt'>): Promise<QueuedPhoto> {
  const db = await openDB()
  const row: QueuedPhoto = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() }
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(row)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  db.close()
  return row
}

export async function queueList(kind: QueuedPhoto['kind'] = 'photo'): Promise<QueuedPhoto[]> {
  const db = await openDB()
  const rows = await new Promise<QueuedPhoto[]>((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => res((req.result as QueuedPhoto[]).filter((r) => r.kind === kind).sort((a, b) => a.createdAt - b.createdAt))
    req.onerror = () => rej(req.error)
  })
  db.close()
  return rows
}

export async function queueRemove(id: string): Promise<void> {
  const db = await openDB()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  db.close()
}

/** 在线状态（online/offline 事件驱动）——供离线横幅与自动同步用 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** 网络类失败判定（业务 4xx/5xx 不入队） */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = e instanceof Error ? e.message : String(e)
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg)
}
