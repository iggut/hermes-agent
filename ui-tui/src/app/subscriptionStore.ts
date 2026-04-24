import { atom } from 'nanostores'

import {
  disconnectSubscription,
  makeHistoryEntry,
  normalizeSubscription,
  recordManualOverride,
  recordSyncResult,
  type SubscriptionDraft,
  type SubscriptionHistoryDraft,
  type SubscriptionHistoryEntry,
  type SubscriptionRecord,
  type SubscriptionSummary,
  type SubscriptionValue,
  summarizeSubscriptions
} from '../domain/subscriptions.js'

const HISTORY_LIMIT = 25

export const $subscriptions = atom<SubscriptionRecord[]>([])
export const $subscriptionHistory = atom<Record<string, SubscriptionHistoryEntry[]>>({})

export const clearSubscriptionState = () => {
  $subscriptions.set([])
  $subscriptionHistory.set({})
}

export const getSubscriptions = () => $subscriptions.get()
export const getSubscriptionHistory = (providerId: string) => $subscriptionHistory.get()[providerId] ?? []
export const getSubscriptionSummary = (now = Date.now()): SubscriptionSummary => summarizeSubscriptions($subscriptions.get(), now)

export const setSubscriptions = (drafts: readonly SubscriptionDraft[], now = Date.now()) => {
  $subscriptions.set(drafts.map(draft => normalizeSubscription(draft, now)))
}

export const upsertSubscription = (draft: SubscriptionDraft, now = Date.now()) => {
  const next = normalizeSubscription(draft, now)
  const current = $subscriptions.get()
  const index = current.findIndex(item => item.providerId === next.providerId)

  if (index === -1) {
    $subscriptions.set([next, ...current])

    return next
  }

  const copy = current.slice()
  copy[index] = next
  $subscriptions.set(copy)

  return next
}

export const removeSubscription = (providerId: string) => {
  const remaining = $subscriptions.get().filter(item => item.providerId !== providerId)
  $subscriptions.set(remaining)
  const history = $subscriptionHistory.get()

  if (history[providerId]) {
    const nextHistory = { ...history }
    delete nextHistory[providerId]
    $subscriptionHistory.set(nextHistory)
  }
}

export const recordSubscriptionEvent = (draft: SubscriptionHistoryDraft, now = Date.now()) => {
  const entry = makeHistoryEntry(draft, now)
  const history = $subscriptionHistory.get()
  const next = [entry, ...(history[entry.providerId] ?? [])].slice(0, HISTORY_LIMIT)
  $subscriptionHistory.set({ ...history, [entry.providerId]: next })

  return entry
}

export const applyManualOverride = (
  providerId: string,
  manualValue: SubscriptionValue,
  history?: Omit<SubscriptionHistoryDraft, 'afterValue' | 'beforeValue' | 'providerId' | 'sourceType'>,
  now = Date.now()
) => {
  const current = $subscriptions.get().find(item => item.providerId === providerId)

  if (!current) {
    return null
  }

  const next = recordManualOverride(current, manualValue, now)
  upsertSubscription(next, now)
  recordSubscriptionEvent(
    {
      afterValue: manualValue,
      beforeValue: current.manualValue,
      eventType: 'manual_update',
      providerId,
      sourceType: manualValue.sourceType,
      summary: history?.summary ?? 'Manual value updated',
      ...history
    },
    now
  )

  return next
}

export const applySyncResult = (
  providerId: string,
  syncedValue: SubscriptionValue,
  history?: Omit<SubscriptionHistoryDraft, 'afterValue' | 'beforeValue' | 'providerId' | 'sourceType'>,
  now = Date.now()
) => {
  const current = $subscriptions.get().find(item => item.providerId === providerId)

  if (!current) {
    return null
  }

  const next = recordSyncResult(current, syncedValue, now)
  upsertSubscription(next, now)
  recordSubscriptionEvent(
    {
      afterValue: syncedValue,
      beforeValue: current.syncedValue,
      eventType: 'sync',
      providerId,
      sourceType: syncedValue.sourceType,
      summary: history?.summary ?? 'Synced subscription value',
      ...history
    },
    now
  )

  return next
}

export const disconnectSubscriptionRecord = (providerId: string, now = Date.now()) => {
  const current = $subscriptions.get().find(item => item.providerId === providerId)

  if (!current) {
    return null
  }

  const next = disconnectSubscription(current, now)
  upsertSubscription(next, now)
  recordSubscriptionEvent(
    {
      afterValue: null,
      beforeValue: current.syncedValue,
      eventType: 'disconnect',
      providerId,
      sourceType: current.connection.connectorKind,
      summary: 'Disconnected subscription connector'
    },
    now
  )

  return next
}

export const markSubscriptionError = (providerId: string, message: string, now = Date.now()) => {
  const current = $subscriptions.get().find(item => item.providerId === providerId)

  if (!current) {
    return null
  }

  const next = normalizeSubscription(
    {
      ...current,
      connection: { ...current.connection, lastCheckedAt: now, lastError: message },
      lastError: message,
      status: 'error'
    },
    now
  )

  upsertSubscription(next, now)
  recordSubscriptionEvent(
    {
      afterValue: null,
      beforeValue: current.syncedValue ?? current.manualValue,
      details: message,
      eventType: 'error',
      providerId,
      sourceType: current.connection.connectorKind,
      summary: 'Subscription sync failed'
    },
    now
  )

  return next
}
