export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          created_at: string | null
          description: string | null
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      complaints: {
        Row: {
          admin_response: string | null
          created_at: string | null
          description: string | null
          id: string
          order_id: string | null
          status: string | null
          subject: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          admin_response?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          order_id?: string | null
          status?: string | null
          subject?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          admin_response?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          order_id?: string | null
          status?: string | null
          subject?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "complaints_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      data_packages: {
        Row: {
          agent_price: number | null
          cost_price: number | null
          created_at: string | null
          description: string | null
          id: string
          is_available: boolean | null
          network: string
          price: number
          size: string
          sort_order: number | null
        }
        Insert: {
          agent_price?: number | null
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_available?: boolean | null
          network: string
          price: number
          size: string
          sort_order?: number | null
        }
        Update: {
          agent_price?: number | null
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_available?: boolean | null
          network?: string
          price?: number
          size?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      download_batches: {
        Row: {
          created_at: string | null
          created_by: string | null
          filename: string
          id: string
          idempotency_key: string | null
          network: string | null
          order_count: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          filename: string
          id?: string
          idempotency_key?: string | null
          network?: string | null
          order_count?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          filename?: string
          id?: string
          idempotency_key?: string | null
          network?: string | null
          order_count?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount: number
          bundle_name: string | null
          cost_price: number | null
          created_at: string | null
          customer_phone: string | null
          download_batch_id: string | null
          email: string | null
          fulfillment_method: string | null
          id: string
          idempotency_key: string | null
          network: string | null
          package_id: string | null
          payment_metadata: Json | null
          payment_status: string | null
          phone_number: string
          price: number | null
          profit_amount: number | null
          provider_ref: string | null
          reference: string | null
          reference_code: string | null
          shop_id: string | null
          size: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          bundle_name?: string | null
          cost_price?: number | null
          created_at?: string | null
          customer_phone?: string | null
          download_batch_id?: string | null
          email?: string | null
          fulfillment_method?: string | null
          id?: string
          idempotency_key?: string | null
          network?: string | null
          package_id?: string | null
          payment_metadata?: Json | null
          payment_status?: string | null
          phone_number: string
          price?: number | null
          profit_amount?: number | null
          provider_ref?: string | null
          reference?: string | null
          reference_code?: string | null
          shop_id?: string | null
          size?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          bundle_name?: string | null
          cost_price?: number | null
          created_at?: string | null
          customer_phone?: string | null
          download_batch_id?: string | null
          email?: string | null
          fulfillment_method?: string | null
          id?: string
          idempotency_key?: string | null
          network?: string | null
          package_id?: string | null
          payment_metadata?: Json | null
          payment_status?: string | null
          phone_number?: string
          price?: number | null
          profit_amount?: number | null
          provider_ref?: string | null
          reference?: string | null
          reference_code?: string | null
          shop_id?: string | null
          size?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_batch_id_fkey"
            columns: ["download_batch_id"]
            isOneToOne: false
            referencedRelation: "download_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "data_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          bucket_key: string
          count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          count?: number
          window_start?: string
        }
        Update: {
          bucket_key?: string
          count?: number
          window_start?: string
        }
        Relationships: []
      }
      shop_packages: {
        Row: {
          created_at: string | null
          custom_price: number | null
          id: string
          is_enabled: boolean | null
          package_id: string
          profit_margin: number | null
          shop_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          custom_price?: number | null
          id?: string
          is_enabled?: boolean | null
          package_id: string
          profit_margin?: number | null
          shop_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          custom_price?: number | null
          id?: string
          is_enabled?: boolean | null
          package_id?: string
          profit_margin?: number | null
          shop_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_packages_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "data_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_packages_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          slug: string
          theme_color: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          slug: string
          theme_color?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          slug?: string
          theme_color?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_announcements: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          message: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          message: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          message?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          agent_expires_at: string | null
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone_number: string | null
          role: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          agent_expires_at?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          phone_number?: string | null
          role?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_expires_at?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone_number?: string | null
          role?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      wallet_payments: {
        Row: {
          amount: number
          created_at: string | null
          fee: number | null
          id: string
          metadata: Json | null
          provider: string | null
          provider_reference: string | null
          reference: string
          status: string | null
          total_amount: number | null
          updated_at: string | null
          user_id: string | null
          wallet_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          fee?: number | null
          id?: string
          metadata?: Json | null
          provider?: string | null
          provider_reference?: string | null
          reference: string
          status?: string | null
          total_amount?: number | null
          updated_at?: string | null
          user_id?: string | null
          wallet_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          fee?: number | null
          id?: string
          metadata?: Json | null
          provider?: string | null
          provider_reference?: string | null
          reference?: string
          status?: string | null
          total_amount?: number | null
          updated_at?: string | null
          user_id?: string | null
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_payments_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          id: string
          reference: string | null
          source: string | null
          status: string | null
          type: string
          user_id: string | null
          wallet_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          description?: string | null
          id?: string
          reference?: string | null
          source?: string | null
          status?: string | null
          type: string
          user_id?: string | null
          wallet_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          reference?: string | null
          source?: string | null
          status?: string | null
          type?: string
          user_id?: string | null
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number | null
          id: string
          total_credited: number | null
          total_spent: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          balance?: number | null
          id?: string
          total_credited?: number | null
          total_spent?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          balance?: number | null
          id?: string
          total_credited?: number | null
          total_spent?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          admin_notes: string | null
          amount: number
          created_at: string | null
          id: string
          payment_details: string | null
          payment_method: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          created_at?: string | null
          id?: string
          payment_details?: string | null
          payment_method?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          created_at?: string | null
          id?: string
          payment_details?: string | null
          payment_method?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: {
          p_key: string
          p_max_attempts: number
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after_seconds: number
        }[]
      }
      credit_wallet: {
        Args: { p_amount: number; p_wallet_id: string }
        Returns: {
          balance: number
          id: string
          total_credited: number
          total_spent: number
          user_id: string
        }[]
      }
      debit_wallet: {
        Args: { p_amount: number; p_wallet_id: string }
        Returns: {
          balance: number
          id: string
          total_credited: number
          total_spent: number
          user_id: string
        }[]
      }
      refund_wallet: {
        Args: { p_amount: number; p_wallet_id: string }
        Returns: {
          balance: number
          id: string
          total_credited: number
          total_spent: number
          user_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
