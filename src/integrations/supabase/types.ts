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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      app_releases: {
        Row: {
          build_number: number | null
          created_at: string
          download_url: string | null
          id: string
          ipfs_cid: string | null
          mandatory: boolean
          notes: string | null
          platform: string
          released_at: string
          version: string
        }
        Insert: {
          build_number?: number | null
          created_at?: string
          download_url?: string | null
          id?: string
          ipfs_cid?: string | null
          mandatory?: boolean
          notes?: string | null
          platform: string
          released_at?: string
          version: string
        }
        Update: {
          build_number?: number | null
          created_at?: string
          download_url?: string | null
          id?: string
          ipfs_cid?: string | null
          mandatory?: boolean
          notes?: string | null
          platform?: string
          released_at?: string
          version?: string
        }
        Relationships: []
      }
      exchange_compliance_log: {
        Row: {
          amount_sats: number
          created_at: string
          deposit_address: string | null
          dest_address: string | null
          dest_asset: string | null
          from_coin: string
          id: string
          ip_address: string | null
          lang_list: string | null
          order_id: string | null
          provider: string
          purge_after: string
          txid: string | null
          user_agent: string | null
        }
        Insert: {
          amount_sats: number
          created_at?: string
          deposit_address?: string | null
          dest_address?: string | null
          dest_asset?: string | null
          from_coin: string
          id?: string
          ip_address?: string | null
          lang_list?: string | null
          order_id?: string | null
          provider: string
          purge_after?: string
          txid?: string | null
          user_agent?: string | null
        }
        Update: {
          amount_sats?: number
          created_at?: string
          deposit_address?: string | null
          dest_address?: string | null
          dest_asset?: string | null
          from_coin?: string
          id?: string
          ip_address?: string | null
          lang_list?: string | null
          order_id?: string | null
          provider?: string
          purge_after?: string
          txid?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      nfc_card_keys: {
        Row: {
          card_id: string
          created_at: string
          enc_key: string
        }
        Insert: {
          card_id: string
          created_at?: string
          enc_key: string
        }
        Update: {
          card_id?: string
          created_at?: string
          enc_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfc_card_keys_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "nfc_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      nfc_card_payments: {
        Row: {
          amount_units: number
          card_id: string
          created_at: string
          decided_at: string | null
          id: string
          invoice_id: string
          merchant: string | null
          pay_to: string
          reason: string | null
          status: string
          txid: string | null
          usd: number
        }
        Insert: {
          amount_units: number
          card_id: string
          created_at?: string
          decided_at?: string | null
          id?: string
          invoice_id: string
          merchant?: string | null
          pay_to: string
          reason?: string | null
          status?: string
          txid?: string | null
          usd: number
        }
        Update: {
          amount_units?: number
          card_id?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          invoice_id?: string
          merchant?: string | null
          pay_to?: string
          reason?: string | null
          status?: string
          txid?: string | null
          usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "nfc_card_payments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "nfc_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      nfc_cards: {
        Row: {
          approver_chat_ids: number[]
          created_at: string
          daily_usd: number
          id: string
          label: string
          owner_address: string
          per_tap_usd: number
          pin_above_usd: number
          pin_hash: string | null
          pin_rule: string
          pin_salt: string | null
          pocket_account: number
          pocket_address: string
          return_address: string
          status: string
          telegram_code: string | null
          uid_hash: string
          updated_at: string
          wrong_pins: number
        }
        Insert: {
          approver_chat_ids?: number[]
          created_at?: string
          daily_usd?: number
          id?: string
          label?: string
          owner_address: string
          per_tap_usd?: number
          pin_above_usd?: number
          pin_hash?: string | null
          pin_rule?: string
          pin_salt?: string | null
          pocket_account: number
          pocket_address: string
          return_address: string
          status?: string
          telegram_code?: string | null
          uid_hash: string
          updated_at?: string
          wrong_pins?: number
        }
        Update: {
          approver_chat_ids?: number[]
          created_at?: string
          daily_usd?: number
          id?: string
          label?: string
          owner_address?: string
          per_tap_usd?: number
          pin_above_usd?: number
          pin_hash?: string | null
          pin_rule?: string
          pin_salt?: string | null
          pocket_account?: number
          pocket_address?: string
          return_address?: string
          status?: string
          telegram_code?: string | null
          uid_hash?: string
          updated_at?: string
          wrong_pins?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      card_check_pin: {
        Args: { p_card_id: string; p_hash: string }
        Returns: string
      }
      purge_exchange_compliance_log: { Args: never; Returns: number }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
