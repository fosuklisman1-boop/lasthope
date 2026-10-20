import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }))

import { evaluateMfaGate, mfaDisabledByEnv } from './mfa'

const gate = (over: Partial<Parameters<typeof evaluateMfaGate>[0]> = {}) =>
    evaluateMfaGate({ required: true, disabledByEnv: false, currentLevel: 'aal1', hasVerifiedFactor: false, ...over })

describe('evaluateMfaGate', () => {
    it('allows everyone when two-factor is not required', () => {
        expect(gate({ required: false })).toBe('allow')
        expect(gate({ required: false, hasVerifiedFactor: true })).toBe('allow')
    })

    it('allows when the emergency env switch is on', () => {
        expect(gate({ disabledByEnv: true })).toBe('allow')
    })

    it('allows a session that already proved a second factor', () => {
        expect(gate({ currentLevel: 'aal2', hasVerifiedFactor: true })).toBe('allow')
    })

    it('asks an enrolled admin to verify', () => {
        expect(gate({ currentLevel: 'aal1', hasVerifiedFactor: true })).toBe('verify')
    })

    it('asks an admin with no authenticator to enroll one', () => {
        expect(gate({ currentLevel: 'aal1', hasVerifiedFactor: false })).toBe('enroll')
        expect(gate({ currentLevel: null, hasVerifiedFactor: false })).toBe('enroll')
        expect(gate({ currentLevel: undefined, hasVerifiedFactor: false })).toBe('enroll')
    })
})

describe('mfaDisabledByEnv', () => {
    afterEach(() => { delete process.env.ADMIN_2FA_DISABLE })

    it('is true only when ADMIN_2FA_DISABLE is exactly "true"', () => {
        expect(mfaDisabledByEnv()).toBe(false)
        process.env.ADMIN_2FA_DISABLE = 'true'
        expect(mfaDisabledByEnv()).toBe(true)
        process.env.ADMIN_2FA_DISABLE = '1'
        expect(mfaDisabledByEnv()).toBe(false)
    })
})
