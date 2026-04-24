import type { Confidence, SourceType, SubscriptionDraft, SubscriptionValue } from './subscriptions.js'

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

export type ProviderId = 'chatgpt_plus' | 'cursor' | 'google_ai' | 'xiaomi_mimo'

export interface ProviderSnapshotBase {
  connected?: boolean
  connectedAt?: number
  lastError?: string
  notes?: readonly string[]
  providerId: string
  providerName: string
  sourceType?: SourceType
  sourceUpdatedAt?: number
  staleAfterMs?: number
}

export interface ProviderConnectorGuide {
  connectorKind: SourceType
  exampleState: string
  requiredCredentials: string[]
  setupNotes: string[]
  title: string
}

export interface ProviderAdapterCapabilities {
  manualFallback: boolean
  supportedConnectorKinds: readonly SourceType[]
  syncAvailable: boolean
}

export interface ProviderAdapterResult {
  capabilities: ProviderAdapterCapabilities
  connectorGuides: ProviderConnectorGuide[]
  subscription: SubscriptionDraft
}

export interface XiaomiMiMoSnapshot extends ProviderSnapshotBase {
  apiKeyLabel?: string
  planCapTokens?: number
  remainingTokens?: number
  usedTokens?: number
}

export interface ChatGPTPlusSnapshot extends ProviderSnapshotBase {
  messageCap?: number
  messagesUsed?: number
  remainingAllowance?: number
  remainingMessages?: number
}

export interface CursorSnapshot extends ProviderSnapshotBase {
  creditCap?: number
  creditsUsed?: number
  remainingCredits?: number
  requestCap?: number
  requestsUsed?: number
  remainingRequests?: number
}

export interface GoogleAISnapshot extends ProviderSnapshotBase {
  quotaCapTokens?: number
  quotaRemaining?: number
  tokensUsed?: number
  remainingTokens?: number
  resetAt?: string
  renewalAt?: string
}

export interface ProviderAdapterDefinition<TSnapshot extends ProviderSnapshotBase> {
  capabilities: ProviderAdapterCapabilities
  connectorGuides: ProviderConnectorGuide[]
  providerId: ProviderId
  providerName: string
  adapt: (snapshot: TSnapshot, now?: number) => ProviderAdapterResult
}

function confidenceForSource(sourceType: SourceType, hasError = false): Confidence {
  if (hasError) {
    return 'low'
  }

  if (sourceType === 'manual') {
    return 'low'
  }

  if (sourceType === 'browser-import') {
    return 'medium'
  }

  return 'high'
}

function isStale(sourceUpdatedAt: number, staleAfterMs: number, now: number): boolean {
  return Number.isFinite(sourceUpdatedAt) ? now - sourceUpdatedAt >= staleAfterMs : true
}

function inferStatus(sourceType: SourceType, sourceUpdatedAt: number, staleAfterMs: number, now: number, hasError: boolean) {
  if (hasError) {
    return 'error' as const
  }

  if (sourceType === 'manual') {
    return 'manual' as const
  }

  if (isStale(sourceUpdatedAt, staleAfterMs, now)) {
    return 'stale' as const
  }

  return 'synced' as const
}

function normalizeConnectorKind(sourceType?: SourceType): SourceType {
  return sourceType ?? 'manual'
}

function normalizeNotes(notes: readonly string[] | undefined, extras: readonly string[]): string[] {
  return Array.from(new Set([...(notes ?? []), ...extras]))
}

function buildValue(input: {
  confidence: Confidence
  displayUnit: string
  lastError?: string
  limit?: number
  metricKind: SubscriptionValue['metricKind']
  notes: readonly string[]
  remaining: number
  sourceType: SourceType
  sourceUpdatedAt: number
  used?: number
}): SubscriptionValue {
  return {
    confidence: input.confidence,
    displayUnit: input.displayUnit,
    limit: input.limit,
    lastError: input.lastError,
    metricKind: input.metricKind,
    notes: [...input.notes],
    remaining: input.remaining,
    sourceType: input.sourceType,
    sourceUpdatedAt: input.sourceUpdatedAt,
    used: input.used
  }
}

function buildSubscriptionDraft(input: {
  connectionLabel?: string
  confidence: Confidence
  connectorKind: SourceType
  displayUnit: string
  lastError?: string
  manualValue?: null | SubscriptionValue
  metricKind: SubscriptionValue['metricKind']
  notes: readonly string[]
  providerId: string
  providerName: string
  remaining: number
  sourceUpdatedAt: number
  staleAfterMs: number
  status: 'disconnected' | 'error' | 'manual' | 'stale' | 'synced'
  syncedValue?: null | SubscriptionValue
}) : SubscriptionDraft {
  return {
    activeSource: input.manualValue ? 'manual' : 'synced',
    confidence: input.confidence,
    connection: {
      connected: input.connectorKind !== 'manual',
      connectedAt: input.connectorKind !== 'manual' ? input.sourceUpdatedAt : undefined,
      connectorKind: input.connectorKind,
      label: input.connectionLabel,
      lastCheckedAt: input.sourceUpdatedAt,
      lastError: input.lastError
    },
    displayUnit: input.displayUnit,
    lastError: input.lastError,
    manualValue: input.manualValue ?? null,
    metricKind: input.metricKind,
    notes: [...input.notes],
    providerId: input.providerId,
    providerName: input.providerName,
    sourceUpdatedAt: input.sourceUpdatedAt,
    staleAfterMs: input.staleAfterMs,
    status: input.status,
    syncedValue: input.syncedValue ?? null
  }
}

function buildResult(subscription: SubscriptionDraft, capabilities: ProviderAdapterCapabilities, connectorGuides: ProviderConnectorGuide[]): ProviderAdapterResult {
  return { capabilities, connectorGuides, subscription }
}

function resolveRemaining(input: { limit?: number; remaining?: number; used?: number }): { limit?: number; remaining: number; used?: number } {
  const limit = input.limit
  const used = input.used
  const remaining = input.remaining ?? (limit != null && used != null ? Math.max(0, limit - used) : 0)

  return { limit, remaining, used }
}

function buildApiValue(input: {
  confidence: Confidence
  displayUnit: string
  lastError?: string
  limit?: number
  metricKind: SubscriptionValue['metricKind']
  notes: readonly string[]
  remaining: number
  sourceUpdatedAt: number
  sourceType: SourceType
  used?: number
}): SubscriptionValue {
  return buildValue({
    confidence: input.confidence,
    displayUnit: input.displayUnit,
    lastError: input.lastError,
    limit: input.limit,
    metricKind: input.metricKind,
    notes: input.notes,
    remaining: input.remaining,
    sourceType: input.sourceType,
    sourceUpdatedAt: input.sourceUpdatedAt,
    used: input.used
  })
}

export function adaptXiaomiMiMoSubscription(snapshot: XiaomiMiMoSnapshot, now = Date.now()): ProviderAdapterResult {
  const staleAfterMs = snapshot.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const sourceUpdatedAt = snapshot.sourceUpdatedAt ?? now
  const sourceType = normalizeConnectorKind(snapshot.sourceType)
  const status = inferStatus(sourceType, sourceUpdatedAt, staleAfterMs, now, Boolean(snapshot.lastError))

  const { limit, remaining, used } = resolveRemaining({
    limit: snapshot.planCapTokens,
    remaining: snapshot.remainingTokens,
    used: snapshot.usedTokens
  })

  const confidence = confidenceForSource(sourceType, Boolean(snapshot.lastError))

  const notes = normalizeNotes(snapshot.notes, [
    'Tracks remaining tokens and plan cap when the provider exposes them.',
    sourceType === 'browser-import' ? 'Imported browser session snapshot.' : 'API connector available.'
  ])

  const value = buildApiValue({
    confidence,
    displayUnit: 'tokens',
    lastError: snapshot.lastError,
    limit,
    metricKind: 'tokens',
    notes,
    remaining,
    sourceUpdatedAt,
    sourceType,
    used
  })

  return buildResult(
    buildSubscriptionDraft({
      connectionLabel: snapshot.apiKeyLabel ?? 'MiMo account connection',
      confidence,
      connectorKind: sourceType,
      displayUnit: 'tokens',
      lastError: snapshot.lastError,
      metricKind: 'tokens',
      notes,
      providerId: snapshot.providerId,
      providerName: snapshot.providerName,
      remaining,
      sourceUpdatedAt,
      staleAfterMs,
      status,
      syncedValue: sourceType === 'manual' ? null : value,
      manualValue: sourceType === 'manual' ? value : null
    }),
    {
      manualFallback: true,
      supportedConnectorKinds: ['api', 'manual'],
      syncAvailable: sourceType !== 'manual'
    },
    [
      {
        connectorKind: 'api',
        exampleState: 'Connected via API key; sync returns remaining tokens and plan cap.',
        requiredCredentials: ['API key', 'account identifier'],
        setupNotes: ['Store the secret separately from the public subscription payload.', 'Retry sync on demand if the account token rotates.'],
        title: 'Connect with API key'
      },
      {
        connectorKind: 'manual',
        exampleState: 'Manual tracking only; keep a local remaining-token estimate.',
        requiredCredentials: [],
        setupNotes: ['Use this when the provider endpoint is unavailable or disabled.'],
        title: 'Manual fallback'
      }
    ]
  )
}

export function adaptChatGPTPlusSubscription(snapshot: ChatGPTPlusSnapshot, now = Date.now()): ProviderAdapterResult {
  const staleAfterMs = snapshot.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const sourceUpdatedAt = snapshot.sourceUpdatedAt ?? now
  const sourceType = normalizeConnectorKind(snapshot.sourceType)
  const status = inferStatus(sourceType, sourceUpdatedAt, staleAfterMs, now, Boolean(snapshot.lastError))
  const metricKind = snapshot.remainingMessages != null || snapshot.messageCap != null ? 'messages' : 'allowance'

  const { limit, remaining, used } = resolveRemaining({
    limit: snapshot.messageCap,
    remaining: snapshot.remainingMessages ?? snapshot.remainingAllowance,
    used: snapshot.messagesUsed
  })

  const confidence = confidenceForSource(sourceType, Boolean(snapshot.lastError))

  const notes = normalizeNotes(snapshot.notes, [
    'Shows the effective allowance honestly when a raw token balance is unavailable.',
    sourceType === 'browser-import' ? 'Browser-import snapshot.' : 'Manual tracking remains supported.'
  ])

  const value = buildValue({
    confidence,
    displayUnit: metricKind === 'messages' ? 'messages' : 'allowance',
    lastError: snapshot.lastError,
    limit,
    metricKind,
    notes,
    remaining,
    sourceType,
    sourceUpdatedAt,
    used
  })

  return buildResult(
    buildSubscriptionDraft({
      connectionLabel: 'ChatGPT Plus usage',
      confidence,
      connectorKind: sourceType,
      displayUnit: metricKind === 'messages' ? 'messages' : 'allowance',
      lastError: snapshot.lastError,
      metricKind,
      notes,
      providerId: snapshot.providerId,
      providerName: snapshot.providerName,
      remaining,
      sourceUpdatedAt,
      staleAfterMs,
      status,
      syncedValue: sourceType === 'manual' ? null : value,
      manualValue: sourceType === 'manual' ? value : null
    }),
    {
      manualFallback: true,
      supportedConnectorKinds: ['browser-import', 'manual', 'oauth'],
      syncAvailable: sourceType !== 'manual'
    },
    [
      {
        connectorKind: 'browser-import',
        exampleState: 'Imported browser usage snapshot with message-window remaining.',
        requiredCredentials: ['Browser session approval'],
        setupNotes: ['Treat imported session data as revocable user-approved state.'],
        title: 'Import from browser session'
      },
      {
        connectorKind: 'manual',
        exampleState: 'Manual message-cap tracker when no connector is available.',
        requiredCredentials: [],
        setupNotes: ['Useful as the baseline when public usage APIs are unavailable.'],
        title: 'Manual tracking'
      },
      {
        connectorKind: 'oauth',
        exampleState: 'Future OAuth connector with a synced usage window.',
        requiredCredentials: ['OAuth consent'],
        setupNotes: ['Keep secret material out of logs and UI payloads.'],
        title: 'OAuth connector'
      }
    ]
  )
}

export function adaptCursorSubscription(snapshot: CursorSnapshot, now = Date.now()): ProviderAdapterResult {
  const staleAfterMs = snapshot.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const sourceUpdatedAt = snapshot.sourceUpdatedAt ?? now
  const sourceType = normalizeConnectorKind(snapshot.sourceType)
  const status = inferStatus(sourceType, sourceUpdatedAt, staleAfterMs, now, Boolean(snapshot.lastError))
  const metricKind = snapshot.remainingCredits != null || snapshot.creditCap != null ? 'credits' : 'requests'

  const { limit, remaining, used } = resolveRemaining({
    limit: snapshot.creditCap ?? snapshot.requestCap,
    remaining: snapshot.remainingCredits ?? snapshot.remainingRequests,
    used: snapshot.creditsUsed ?? snapshot.requestsUsed
  })

  const confidence = confidenceForSource(sourceType, Boolean(snapshot.lastError))

  const notes = normalizeNotes(snapshot.notes, [
    'Can represent request-based or credit-based allowance depending on the available source data.',
    sourceType === 'browser-import' ? 'Imported local usage record.' : 'Supports account metadata or API sync.'
  ])

  const value = buildValue({
    confidence,
    displayUnit: metricKind,
    lastError: snapshot.lastError,
    limit,
    metricKind,
    notes,
    remaining,
    sourceType,
    sourceUpdatedAt,
    used
  })

  return buildResult(
    buildSubscriptionDraft({
      connectionLabel: 'Cursor account',
      confidence,
      connectorKind: sourceType,
      displayUnit: metricKind,
      lastError: snapshot.lastError,
      metricKind,
      notes,
      providerId: snapshot.providerId,
      providerName: snapshot.providerName,
      remaining,
      sourceUpdatedAt,
      staleAfterMs,
      status,
      syncedValue: sourceType === 'manual' ? null : value,
      manualValue: sourceType === 'manual' ? value : null
    }),
    {
      manualFallback: true,
      supportedConnectorKinds: ['api', 'browser-import', 'manual', 'oauth'],
      syncAvailable: sourceType !== 'manual'
    },
    [
      {
        connectorKind: 'api',
        exampleState: 'API-backed cursor usage snapshot with request or credit allowance.',
        requiredCredentials: ['API key', 'workspace identifier'],
        setupNotes: ['Prefer metadata-only sync so no secrets are surfaced in UI payloads.'],
        title: 'Connect with API key'
      },
      {
        connectorKind: 'browser-import',
        exampleState: 'Imported local account record or usage snapshot.',
        requiredCredentials: ['Browser session approval'],
        setupNotes: ['Good fallback when the provider connection is not stable.'],
        title: 'Import usage snapshot'
      },
      {
        connectorKind: 'manual',
        exampleState: 'Manual request or credit tracker for offline management.',
        requiredCredentials: [],
        setupNotes: ['Choose this when no direct connector can be established.'],
        title: 'Manual tracking'
      }
    ]
  )
}

export function adaptGoogleAISubscription(snapshot: GoogleAISnapshot, now = Date.now()): ProviderAdapterResult {
  const staleAfterMs = snapshot.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const sourceUpdatedAt = snapshot.sourceUpdatedAt ?? now
  const sourceType = normalizeConnectorKind(snapshot.sourceType)
  const status = inferStatus(sourceType, sourceUpdatedAt, staleAfterMs, now, Boolean(snapshot.lastError))
  const metricKind = snapshot.remainingTokens != null || snapshot.quotaCapTokens != null ? 'tokens' : 'allowance'

  const { limit, remaining, used } = resolveRemaining({
    limit: snapshot.quotaCapTokens,
    remaining: snapshot.remainingTokens ?? snapshot.quotaRemaining,
    used: snapshot.tokensUsed
  })

  const confidence = confidenceForSource(sourceType, Boolean(snapshot.lastError))

  const notes = normalizeNotes(snapshot.notes, [
    'Best suited to project quota and API usage snapshots.',
    sourceType === 'browser-import' ? 'Imported browser or local session state.' : 'API or OAuth connector available.'
  ])

  const value = buildValue({
    confidence,
    displayUnit: metricKind === 'tokens' ? 'tokens' : 'quota',
    lastError: snapshot.lastError,
    limit,
    metricKind,
    notes,
    remaining,
    sourceType,
    sourceUpdatedAt,
    used
  })

  return buildResult(
    buildSubscriptionDraft({
      connectionLabel: 'Google AI project quota',
      confidence,
      connectorKind: sourceType,
      displayUnit: metricKind === 'tokens' ? 'tokens' : 'quota',
      lastError: snapshot.lastError,
      metricKind,
      notes,
      providerId: snapshot.providerId,
      providerName: snapshot.providerName,
      remaining,
      sourceUpdatedAt,
      staleAfterMs,
      status,
      syncedValue: sourceType === 'manual' ? null : value,
      manualValue: sourceType === 'manual' ? value : null
    }),
    {
      manualFallback: true,
      supportedConnectorKinds: ['api', 'manual', 'oauth'],
      syncAvailable: sourceType !== 'manual'
    },
    [
      {
        connectorKind: 'api',
        exampleState: 'Project quota sync with tokens used and remaining.',
        requiredCredentials: ['API key', 'project id'],
        setupNotes: ['Keep quota credentials separate from the display model.'],
        title: 'Connect with API key'
      },
      {
        connectorKind: 'oauth',
        exampleState: 'OAuth-linked project quota snapshot.',
        requiredCredentials: ['OAuth consent'],
        setupNotes: ['Use OAuth when project-scoped access is preferred.'],
        title: 'Connect with OAuth'
      },
      {
        connectorKind: 'manual',
        exampleState: 'Manual quota tracker with a reset window.',
        requiredCredentials: [],
        setupNotes: ['Fallback when no direct quota API is exposed.'],
        title: 'Manual tracking'
      }
    ]
  )
}

export const providerSubscriptionAdapters: Record<ProviderId, ProviderAdapterDefinition<any>> = {
  chatgpt_plus: {
    adapt: adaptChatGPTPlusSubscription,
    capabilities: {
      manualFallback: true,
      supportedConnectorKinds: ['browser-import', 'manual', 'oauth'],
      syncAvailable: true
    },
    connectorGuides: [
      {
        connectorKind: 'browser-import',
        exampleState: 'Imported browser usage snapshot with message-window remaining.',
        requiredCredentials: ['Browser session approval'],
        setupNotes: ['Treat imported session data as revocable user-approved state.'],
        title: 'Import from browser session'
      },
      {
        connectorKind: 'manual',
        exampleState: 'Manual message-cap tracker when no connector is available.',
        requiredCredentials: [],
        setupNotes: ['Useful as the baseline when public usage APIs are unavailable.'],
        title: 'Manual tracking'
      },
      {
        connectorKind: 'oauth',
        exampleState: 'Future OAuth connector with a synced usage window.',
        requiredCredentials: ['OAuth consent'],
        setupNotes: ['Keep secret material out of logs and UI payloads.'],
        title: 'OAuth connector'
      }
    ],
    providerId: 'chatgpt_plus',
    providerName: 'ChatGPT Plus'
  },
  cursor: {
    adapt: adaptCursorSubscription,
    capabilities: {
      manualFallback: true,
      supportedConnectorKinds: ['api', 'browser-import', 'manual', 'oauth'],
      syncAvailable: true
    },
    connectorGuides: [
      {
        connectorKind: 'api',
        exampleState: 'API-backed cursor usage snapshot with request or credit allowance.',
        requiredCredentials: ['API key', 'workspace identifier'],
        setupNotes: ['Prefer metadata-only sync so no secrets are surfaced in UI payloads.'],
        title: 'Connect with API key'
      },
      {
        connectorKind: 'browser-import',
        exampleState: 'Imported local account record or usage snapshot.',
        requiredCredentials: ['Browser session approval'],
        setupNotes: ['Good fallback when the provider connection is not stable.'],
        title: 'Import usage snapshot'
      },
      {
        connectorKind: 'manual',
        exampleState: 'Manual request or credit tracker for offline management.',
        requiredCredentials: [],
        setupNotes: ['Choose this when no direct connector can be established.'],
        title: 'Manual tracking'
      }
    ],
    providerId: 'cursor',
    providerName: 'Cursor'
  },
  google_ai: {
    adapt: adaptGoogleAISubscription,
    capabilities: {
      manualFallback: true,
      supportedConnectorKinds: ['api', 'manual', 'oauth'],
      syncAvailable: true
    },
    connectorGuides: [
      {
        connectorKind: 'api',
        exampleState: 'Project quota sync with tokens used and remaining.',
        requiredCredentials: ['API key', 'project id'],
        setupNotes: ['Keep quota credentials separate from the display model.'],
        title: 'Connect with API key'
      },
      {
        connectorKind: 'oauth',
        exampleState: 'OAuth-linked project quota snapshot.',
        requiredCredentials: ['OAuth consent'],
        setupNotes: ['Use OAuth when project-scoped access is preferred.'],
        title: 'Connect with OAuth'
      },
      {
        connectorKind: 'manual',
        exampleState: 'Manual quota tracker with a reset window.',
        requiredCredentials: [],
        setupNotes: ['Fallback when no direct quota API is exposed.'],
        title: 'Manual tracking'
      }
    ],
    providerId: 'google_ai',
    providerName: 'Google AI'
  },
  xiaomi_mimo: {
    adapt: adaptXiaomiMiMoSubscription,
    capabilities: {
      manualFallback: true,
      supportedConnectorKinds: ['api', 'manual'],
      syncAvailable: true
    },
    connectorGuides: [
      {
        connectorKind: 'api',
        exampleState: 'Connected via API key; sync returns remaining tokens and plan cap.',
        requiredCredentials: ['API key', 'account identifier'],
        setupNotes: ['Store the secret separately from the public subscription payload.', 'Retry sync on demand if the account token rotates.'],
        title: 'Connect with API key'
      },
      {
        connectorKind: 'manual',
        exampleState: 'Manual tracking only; keep a local remaining-token estimate.',
        requiredCredentials: [],
        setupNotes: ['Use this when the provider endpoint is unavailable or disabled.'],
        title: 'Manual fallback'
      }
    ],
    providerId: 'xiaomi_mimo',
    providerName: 'Xiaomi MiMo'
  }
}

export function getSubscriptionAdapter(providerId: ProviderId): ProviderAdapterDefinition<any> {
  return providerSubscriptionAdapters[providerId]
}

export function adaptProviderSubscription(providerId: ProviderId, snapshot: ProviderSnapshotBase, now = Date.now()): ProviderAdapterResult {
  return getSubscriptionAdapter(providerId).adapt(snapshot as never, now)
}
