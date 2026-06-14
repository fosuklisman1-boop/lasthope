// Gateway-agnostic USSD request/response shapes + session state.
// Uzo-specific field mapping lives in lib/ussd/uzo-adapter.ts, so a future
// second gateway only needs a new adapter, not changes here.

export interface UssdRequest {
    sessionId: string
    msisdn: string
    input: string
    isNewSession: boolean
    isEnding: boolean
    networkMnc: string
    dialedCode: string
}

export interface UssdResponse {
    text: string
    endSession: boolean
}

export type UssdStep =
    | 'select_network'
    | 'select_package'
    | 'select_recipient'
    | 'enter_recipient'
    | 'confirm'

export interface UssdSessionData {
    network?: string
    package_id?: string
    price?: number
    size?: string
    cost_price?: number
    recipient?: string
    retries?: number
    order_reference?: string
}

export interface UssdSession {
    session_id: string
    shop_id: string
    msisdn: string
    step: UssdStep
    data: UssdSessionData
}
