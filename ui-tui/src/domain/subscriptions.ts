export type MetricKind = 'allowance' | 'credits' | 'messages' | 'requests' | 'tokens'
export type SyncStatus = 'disconnected' | 'error' | 'manual' | 'stale' | 'synced'
export type SourceType = 'api' | 'browser-import' | 'manual' | 'oauth'
export type Confidence = 'high' | 'low' | 'medium'
export type SubscriptionEventType = 'connect' | 'disconnect' | 'error' | 'manual_update' | 'sync'
export type SubscriptionActiveSource = 'manual' | 'synced'

export interface SubscriptionConnectionSummary {
  connected: boolean
  connectedAt?: number
  connectorKind: SourceType
  lastCheckedAt?: number
  lastError?: string
  label?: string
}

export interface SubscriptionValue {
  confidence: Confidence
  displayUnit: string
  limit?: number
  lastError?: string
  metricKind: MetricKind
  notes: string[]
  remaining: number
  sourceType: SourceType
  sourceUpdatedAt: number
  used?: number
}

export interface SubscriptionDraftValue {
  confidence?: Confidence
  displayUnit?: string
  limit?: number
  lastError?: string
  metricKind?: MetricKind
  notes?: readonly string[]
  remaining?: number
  sourceType?: SourceType
  sourceUpdatedAt?: number
  used?: number
}

export interface SubscriptionRecord {
  activeSource: SubscriptionActiveSource
  confidence: Confidence
  connection: SubscriptionConnectionSummary
  displayUnit: string
  lastError?: string
  metricKind: MetricKind
  notes: string[]
  providerId: string
  providerName: string
  renewalAt?: string
  resetAt?: string
  sourceUpdatedAt: number
  staleAfterMs: number
  status: SyncStatus
  syncedValue: null | SubscriptionValue
  manualValue: null | SubscriptionValue
}

export interface SubscriptionHistoryEntry {
  afterValue: null | SubscriptionValue
  beforeValue: null | SubscriptionValue
  createdAt: number
  details?: string
  eventType: SubscriptionEventType
  id: string
  providerId: string
  sourceType: SourceType
  summary: string
}

export interface SubscriptionSummary {
  connectedProviders: number
  lastSyncAt: null | number
  manualOnlyProviders: number
  staleProviders: number
  totalRemaining: number
}

export interface SubscriptionDraft {
  activeSource?: SubscriptionActiveSource
  confidence?: Confidence
  connection?: Partial<SubscriptionConnectionSummary>
  displayUnit?: string
  lastError?: string
  manualValue?: null | SubscriptionDraftValue
  metricKind?: MetricKind
  notes?: readonly string[]
  providerId: string
  providerName: string
  renewalAt?: string
  resetAt?: string
  sourceUpdatedAt?: number
  staleAfterMs?: number
  status?: SyncStatus
  syncedValue?: null | SubscriptionDraftValue
}

export interface SubscriptionHistoryDraft {
  afterValue?: null | SubscriptionDraftValue
  beforeValue?: null | SubscriptionDraftValue
  createdAt?: number
  details?: string
  eventType: SubscriptionEventType
  id?: string
  providerId: string
  sourceType?: SourceType
  summary: string
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000
const DEFAULT_CONFIDENCE: Confidence = 'medium'
const DEFAULT_CONNECTION_KIND: SourceType = 'manual'
const DEFAULT_METRIC_KIND: MetricKind = 'allowance'
const DEFAULT_STATUS: SyncStatus = 'manual'
const DEFAULT_UNIT = 'allowance'

export function normalizeSubscription(draft: SubscriptionDraft, now = Date.now()): SubscriptionRecord {
  const syncedValue = normalizeValue(draft.syncedValue ?? null, now)
  const manualValue = normalizeValue(draft.manualValue ?? null, now)

  const activeSource: SubscriptionActiveSource =
    draft.activeSource ?? (manualValue ? 'manual' : syncedValue ? 'synced' : 'manual')

  const connection = normalizeConnection(draft.connection, now)
  const status = draft.status ?? deriveStatus(activeSource, connection, syncedValue, manualValue)
  const chosen = activeSource === 'manual' ? manualValue ?? syncedValue : syncedValue ?? manualValue

  return {
    activeSource,
    confidence: draft.confidence ?? chosen?.confidence ?? DEFAULT_CONFIDENCE,
    connection,
    displayUnit: draft.displayUnit ?? chosen?.displayUnit ?? DEFAULT_UNIT,
    lastError: draft.lastError ?? syncedValue?.lastError ?? manualValue?.lastError,
    metricKind: draft.metricKind ?? chosen?.metricKind ?? DEFAULT_METRIC_KIND,
    notes: uniqStrings([...(draft.notes ?? []), ...(syncedValue?.notes ?? []), ...(manualValue?.notes ?? [])]),
    providerId: draft.providerId,
    providerName: draft.providerName,
    renewalAt: draft.renewalAt,
    resetAt: draft.resetAt,
    sourceUpdatedAt: draft.sourceUpdatedAt ?? chosen?.sourceUpdatedAt ?? now,
    staleAfterMs: draft.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    status,
    syncedValue,
    manualValue
  }
}

export function normalizeValue(value: null | SubscriptionDraftValue | undefined, now = Date.now()): null | SubscriptionValue {
  if (!value) {
    return null
  }

  const metricKind = value.metricKind ?? DEFAULT_METRIC_KIND
  const displayUnit = value.displayUnit ?? metricKind

  return {
    confidence: value.confidence ?? DEFAULT_CONFIDENCE,
    displayUnit,
    limit: value.limit,
    lastError: value.lastError,
    metricKind,
    notes: uniqStrings(value.notes ?? []),
    remaining: value.remaining ?? 0,
    sourceType: value.sourceType ?? DEFAULT_CONNECTION_KIND,
    sourceUpdatedAt: value.sourceUpdatedAt ?? now,
    used: value.used
  }
}

export function normalizeConnection(
  connection: undefined | Partial<SubscriptionConnectionSummary>,
  now = Date.now()
): SubscriptionConnectionSummary {
  return {
    connected: connection?.connected ?? false,
    connectedAt: connection?.connectedAt,
    connectorKind: connection?.connectorKind ?? DEFAULT_CONNECTION_KIND,
    lastCheckedAt: connection?.lastCheckedAt ?? now,
    lastError: connection?.lastError,
    label: connection?.label
  }
}

export function resolveActiveValue(record: SubscriptionRecord): null | SubscriptionValue {
  if (record.activeSource === 'manual') {
    return record.manualValue ?? record.syncedValue
  }

  return record.syncedValue ?? record.manualValue
}

export function isManualOnly(record: SubscriptionRecord): boolean {
  return !record.connection.connected && record.manualValue != null && record.syncedValue == null
}

export function isStale(record: SubscriptionRecord, now = Date.now()): boolean {
  if (record.status === 'stale') {
    return true
  }

  const lastSync = record.sourceUpdatedAt

  return Number.isFinite(lastSync) ? now - lastSync >= record.staleAfterMs : true
}

export function summarizeSubscriptions(records: readonly SubscriptionRecord[], now = Date.now()): SubscriptionSummary {
  return records.reduce<SubscriptionSummary>(
    (acc, record) => {
      const active = resolveActiveValue(record)
      acc.totalRemaining += active?.remaining ?? 0

      if (record.connection.connected) {
        acc.connectedProviders += 1
      }

      if (isManualOnly(record)) {
        acc.manualOnlyProviders += 1
      }

      if (isStale(record, now)) {
        acc.staleProviders += 1
      }

      const updatedAt = record.sourceUpdatedAt

      if (Number.isFinite(updatedAt)) {
        acc.lastSyncAt = acc.lastSyncAt == null ? updatedAt : Math.max(acc.lastSyncAt, updatedAt)
      }

      return acc
    },
    { connectedProviders: 0, lastSyncAt: null, manualOnlyProviders: 0, staleProviders: 0, totalRemaining: 0 }
  )
}

export function makeHistoryEntry(draft: SubscriptionHistoryDraft, now = Date.now()): SubscriptionHistoryEntry {
  return {
    afterValue: normalizeValue(draft.afterValue ?? null, now),
    beforeValue: normalizeValue(draft.beforeValue ?? null, now),
    createdAt: draft.createdAt ?? now,
    details: draft.details,
    eventType: draft.eventType,
    id: draft.id ?? `subevt-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    providerId: draft.providerId,
    sourceType: draft.sourceType ?? 'manual',
    summary: draft.summary
  }
}

export function recordManualOverride(
  record: SubscriptionRecord,
  manualValue: SubscriptionDraftValue,
  now = Date.now()
): SubscriptionRecord {
  const nextManual = normalizeValue({ ...manualValue, sourceType: manualValue.sourceType ?? 'manual' }, now)

  return normalizeSubscription(
    {
      ...record,
      activeSource: 'manual',
      manualValue: nextManual,
      sourceUpdatedAt: nextManual?.sourceUpdatedAt ?? now,
      status: 'manual'
    },
    now
  )
}

export function recordSyncResult(
  record: SubscriptionRecord,
  syncedValue: SubscriptionDraftValue,
  now = Date.now()
): SubscriptionRecord {
  const nextSynced = normalizeValue(syncedValue, now)
  const activeSource = record.activeSource === 'manual' && record.manualValue ? 'manual' : 'synced'

  return normalizeSubscription(
    {
      ...record,
      activeSource,
      lastError: nextSynced?.lastError,
      sourceUpdatedAt: nextSynced?.sourceUpdatedAt ?? now,
      status: activeSource === 'manual' ? record.status : 'synced',
      syncedValue: nextSynced
    },
    now
  )
}

export function disconnectSubscription(record: SubscriptionRecord, now = Date.now()): SubscriptionRecord {
  return normalizeSubscription(
    {
      ...record,
      connection: { ...record.connection, connected: false, lastCheckedAt: now },
      status: 'disconnected'
    },
    now
  )
}

export function setSubscriptionActiveSource(
  record: SubscriptionRecord,
  activeSource: SubscriptionActiveSource,
  now = Date.now()
): SubscriptionRecord {
  if (activeSource === 'synced' && !record.syncedValue) {
    return record
  }

  if (activeSource === 'manual' && !record.manualValue) {
    return record
  }

  return normalizeSubscription(
    {
      ...record,
      activeSource
    },
    now
  )
}

export function hasSubscriptionValueConflict(record: SubscriptionRecord): boolean {
  if (!record.manualValue || !record.syncedValue) {
    return false
  }

  return !valuesMatch(record.manualValue, record.syncedValue)
}

function valuesMatch(left: SubscriptionValue, right: SubscriptionValue): boolean {
  return (
    left.confidence === right.confidence &&
    left.displayUnit === right.displayUnit &&
    left.limit === right.limit &&
    left.lastError === right.lastError &&
    left.metricKind === right.metricKind &&
    left.remaining === right.remaining &&
    left.sourceType === right.sourceType &&
    left.sourceUpdatedAt === right.sourceUpdatedAt &&
    left.used === right.used &&
    left.notes.length === right.notes.length &&
    left.notes.every((note, index) => note === right.notes[index])
  )
}

function deriveStatus(
  activeSource: SubscriptionActiveSource,
  connection: SubscriptionConnectionSummary,
  syncedValue: null | SubscriptionValue,
  manualValue: null | SubscriptionValue
): SyncStatus {
  if (!connection.connected && !syncedValue && manualValue) {
    return 'manual'
  }

  if (!connection.connected && !syncedValue && !manualValue) {
    return 'disconnected'
  }

  if (syncedValue && !manualValue && connection.connected) {
    return 'synced'
  }

  if (activeSource === 'manual') {
    return connection.connected ? 'manual' : 'manual'
  }

  if (syncedValue && connection.connected) {
    return 'synced'
  }

  if (syncedValue || manualValue) {
    return 'stale'
  }

  return connection.connected ? 'stale' : 'disconnected'
}

function uniqStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))]
}
