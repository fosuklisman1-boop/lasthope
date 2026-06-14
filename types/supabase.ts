export interface SystemAnnouncement {
    id: string
    title: string
    message: string
    is_active: boolean
    created_at: string
    updated_at: string
}

export interface Complaint {
    id: string
    user_id: string
    order_id: string
    title: string
    description: string
    status: 'pending' | 'in_review' | 'resolved' | 'rejected'
    admin_response?: string
    resolution_notes?: string
    created_at: string
    updated_at: string
    users?: {
        first_name: string
        last_name: string
        email: string
    }
    orders?: {
        reference_code: string
        created_at?: string
        phone_number: string
        network: string
        size: string
        price?: number
        status?: string
    } | null
}

export interface DataPackage {
    id: string
    network: 'MTN' | 'Telecel' | 'AT-iShare' | 'AT-BigTime'
    size: string
    price: number
    agent_price?: number
    super_agent_price?: number
    premium_agent_price?: number
    dealer_price?: number
    cost_price?: number
    description?: string
    is_available: boolean
    sort_order: number
    created_at: string
    updated_at: string
}

export interface Order {
    id: string
    user_id?: string
    reference_code: string
    phone_number: string
    network: string
    size: string
    price: number
    status: 'pending' | 'processing' | 'completed' | 'failed'
    payment_status: 'paid' | 'unpaid' | 'refunded'
    created_at: string
    updated_at: string
    complaints?: Complaint[]
}

export interface Notification {
    id: string
    user_id: string
    title: string
    message: string
    type: 'order_update' | 'payment_success' | 'complaint_resolved' | 'balance_updated' | 'system' | string
    is_read: boolean
    action_url?: string
    created_at: string
}

export interface WalletTransaction {
    id: string
    wallet_id: string
    user_id: string
    type: 'credit' | 'debit'
    amount: number
    description: string
    reference?: string
    source: string
    status: 'pending' | 'completed' | 'failed'
    created_at: string
}

export interface User {
    id: string
    email: string
    first_name: string
    last_name: string
    phone_number: string
    role: 'admin' | 'sub-admin' | 'agent' | 'user'
    status: 'active' | 'suspended' | 'inactive'
    agent_expires_at?: string
    created_at: string
    updated_at: string
}



export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums, CompositeTypes } from './database.types'
