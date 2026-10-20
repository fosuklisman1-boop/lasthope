export interface SettingUpdate {
    key: string
    value: string
}

export interface SettingChange {
    key: string
    from: string | null
    to: string
}

const KEY_PATTERN = /^[a-z0-9_]{1,80}$/
const MAX_VALUE = 500

/** Validate a client-supplied list of settings. Returns clean updates or an error message. */
export function parseSettingUpdates(input: unknown): { updates: SettingUpdate[] } | { error: string } {
    if (!Array.isArray(input) || input.length === 0) return { error: 'updates must be a non-empty array' }
    if (input.length > 100) return { error: 'Too many settings in one request' }

    const seen = new Set<string>()
    const updates: SettingUpdate[] = []
    for (const item of input) {
        const key = typeof item?.key === 'string' ? item.key : ''
        if (!KEY_PATTERN.test(key)) return { error: `Invalid setting key: ${String(item?.key).slice(0, 40)}` }
        if (seen.has(key)) return { error: `Duplicate setting key: ${key}` }
        seen.add(key)
        const value = item?.value === undefined || item?.value === null ? '' : String(item.value)
        if (value.length > MAX_VALUE) return { error: `Value for ${key} is too long` }
        updates.push({ key, value })
    }
    return { updates }
}

/** Only the settings whose value actually changes (new keys count as changes). */
export function diffSettings(current: Record<string, string>, updates: SettingUpdate[]): SettingChange[] {
    const changes: SettingChange[] = []
    for (const u of updates) {
        const from = Object.prototype.hasOwnProperty.call(current, u.key) ? current[u.key] : null
        if (from !== u.value) changes.push({ key: u.key, from, to: u.value })
    }
    return changes
}
