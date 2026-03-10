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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_tools: {
        Row: {
          agent_id: string
          created_at: string
          description: string
          http_body_template: Json | null
          http_headers: Json | null
          http_method: string
          http_url: string
          id: string
          is_active: boolean
          name: string
          parameters: Json | null
          tool_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          description: string
          http_body_template?: Json | null
          http_headers?: Json | null
          http_method?: string
          http_url: string
          id?: string
          is_active?: boolean
          name: string
          parameters?: Json | null
          tool_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          description?: string
          http_body_template?: Json | null
          http_headers?: Json | null
          http_method?: string
          http_url?: string
          id?: string
          is_active?: boolean
          name?: string
          parameters?: Json | null
          tool_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tools_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          created_at: string
          first_speaker: string
          id: string
          is_active: boolean
          language_hint: string | null
          max_duration: number | null
          model: string
          name: string
          phone_number_id: string | null
          system_prompt: string
          temperature: number
          updated_at: string
          user_id: string
          voice: string
        }
        Insert: {
          created_at?: string
          first_speaker?: string
          id?: string
          is_active?: boolean
          language_hint?: string | null
          max_duration?: number | null
          model?: string
          name: string
          phone_number_id?: string | null
          system_prompt?: string
          temperature?: number
          updated_at?: string
          user_id: string
          voice?: string
        }
        Update: {
          created_at?: string
          first_speaker?: string
          id?: string
          is_active?: boolean
          language_hint?: string | null
          max_duration?: number | null
          model?: string
          name?: string
          phone_number_id?: string | null
          system_prompt?: string
          temperature?: number
          updated_at?: string
          user_id?: string
          voice?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_integrations: {
        Row: {
          access_token: string | null
          api_key: string | null
          calendar_id: string | null
          config: Json | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          provider: string
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          api_key?: string | null
          calendar_id?: string | null
          config?: Json | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          provider: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          api_key?: string | null
          calendar_id?: string | null
          config?: Json | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          provider?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          agent_id: string | null
          caller_number: string | null
          created_at: string
          direction: string
          duration: number | null
          ended_at: string | null
          id: string
          recipient_number: string | null
          started_at: string
          status: string
          transcript: Json | null
          twilio_call_sid: string | null
          ultravox_call_id: string | null
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          caller_number?: string | null
          created_at?: string
          direction: string
          duration?: number | null
          ended_at?: string | null
          id?: string
          recipient_number?: string | null
          started_at?: string
          status?: string
          transcript?: Json | null
          twilio_call_sid?: string | null
          ultravox_call_id?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string | null
          caller_number?: string | null
          created_at?: string
          direction?: string
          duration?: number | null
          ended_at?: string | null
          id?: string
          recipient_number?: string | null
          started_at?: string
          status?: string
          transcript?: Json | null
          twilio_call_sid?: string | null
          ultravox_call_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      call_outcomes: {
        Row: {
          attempt_number: number
          call_timestamp: string | null
          campaign_id: string
          child_names: string | null
          contact_id: string | null
          created_at: string
          id: string
          outcome: string
          parent_name: string | null
          phone_number: string
          summary: string | null
          transcript: string | null
          user_id: string
          venue_name: string | null
        }
        Insert: {
          attempt_number?: number
          call_timestamp?: string | null
          campaign_id: string
          child_names?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          outcome?: string
          parent_name?: string | null
          phone_number: string
          summary?: string | null
          transcript?: string | null
          user_id: string
          venue_name?: string | null
        }
        Update: {
          attempt_number?: number
          call_timestamp?: string | null
          campaign_id?: string
          child_names?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          outcome?: string
          parent_name?: string | null
          phone_number?: string
          summary?: string | null
          transcript?: string | null
          user_id?: string
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_outcomes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_outcomes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          age_range: string | null
          booking_target: number | null
          created_at: string
          elevenlabs_campaign_id: string | null
          end_date: string | null
          id: string
          notes: string | null
          round: number
          start_date: string | null
          status: string
          times: string | null
          twilio_phone_number: string | null
          updated_at: string
          user_id: string
          venue_location: string | null
          venue_name: string
        }
        Insert: {
          age_range?: string | null
          booking_target?: number | null
          created_at?: string
          elevenlabs_campaign_id?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          round?: number
          start_date?: string | null
          status?: string
          times?: string | null
          twilio_phone_number?: string | null
          updated_at?: string
          user_id: string
          venue_location?: string | null
          venue_name: string
        }
        Update: {
          age_range?: string | null
          booking_target?: number | null
          created_at?: string
          elevenlabs_campaign_id?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          round?: number
          start_date?: string | null
          status?: string
          times?: string | null
          twilio_phone_number?: string | null
          updated_at?: string
          user_id?: string
          venue_location?: string | null
          venue_name?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          age_range: string | null
          campaign_id: string
          child_names: string | null
          created_at: string
          end_date: string | null
          first_message: string | null
          first_name: string
          id: string
          language: string | null
          phone_number: string
          sheet_reference: string | null
          start_date: string | null
          times: string | null
          user_id: string
          venue_location: string | null
          venue_name: string | null
          voice_id: string | null
        }
        Insert: {
          age_range?: string | null
          campaign_id: string
          child_names?: string | null
          created_at?: string
          end_date?: string | null
          first_message?: string | null
          first_name: string
          id?: string
          language?: string | null
          phone_number: string
          sheet_reference?: string | null
          start_date?: string | null
          times?: string | null
          user_id: string
          venue_location?: string | null
          venue_name?: string | null
          voice_id?: string | null
        }
        Update: {
          age_range?: string | null
          campaign_id?: string
          child_names?: string | null
          created_at?: string
          end_date?: string | null
          first_message?: string | null
          first_name?: string
          id?: string
          language?: string | null
          phone_number?: string
          sheet_reference?: string | null
          start_date?: string | null
          times?: string | null
          user_id?: string
          venue_location?: string | null
          venue_name?: string | null
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      do_not_call: {
        Row: {
          added_at: string
          id: string
          parent_name: string | null
          phone_number: string
          reason: string
          user_id: string
          venue_name: string | null
        }
        Insert: {
          added_at?: string
          id?: string
          parent_name?: string | null
          phone_number: string
          reason: string
          user_id: string
          venue_name?: string | null
        }
        Update: {
          added_at?: string
          id?: string
          parent_name?: string | null
          phone_number?: string
          reason?: string
          user_id?: string
          venue_name?: string | null
        }
        Relationships: []
      }
      knowledge_base_items: {
        Row: {
          agent_id: string
          content: string | null
          created_at: string
          file_path: string | null
          id: string
          title: string
          type: string
          updated_at: string
          user_id: string
          website_url: string | null
        }
        Insert: {
          agent_id: string
          content?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          title: string
          type?: string
          updated_at?: string
          user_id: string
          website_url?: string | null
        }
        Update: {
          agent_id?: string
          content?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_items_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_configs: {
        Row: {
          created_at: string
          friendly_name: string | null
          id: string
          is_active: boolean
          phone_number: string
          twilio_account_sid: string
          twilio_auth_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          friendly_name?: string | null
          id?: string
          is_active?: boolean
          phone_number: string
          twilio_account_sid: string
          twilio_auth_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          friendly_name?: string | null
          id?: string
          is_active?: boolean
          phone_number?: string
          twilio_account_sid?: string
          twilio_auth_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_name: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scheduled_calls: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          notes: string | null
          recipient_name: string | null
          recipient_number: string
          scheduled_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          recipient_name?: string | null
          recipient_number: string
          scheduled_at: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          recipient_name?: string | null
          recipient_number?: string
          scheduled_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhooks: {
        Row: {
          agent_id: string | null
          created_at: string
          events: string[]
          id: string
          is_active: boolean
          name: string
          secret: string | null
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          name: string
          secret?: string | null
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          name?: string
          secret?: string | null
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
