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
      memories: {
        Row: {
          category: string
          content: string
          created_at: string
          id: string
          pinned: boolean
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          content: string
          created_at?: string
          id?: string
          pinned?: boolean
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          id?: string
          pinned?: boolean
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: Json
          created_at: string
          id: string
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      missions: {
        Row: {
          audience: string
          contact_gap_seconds: number
          country: string
          created_at: string
          duration_minutes: number
          id: string
          max_contacts: number
          pace_per_minute: number
          product_name: string
          product_url: string
          recency_minutes: number
          scans: number
          specifications: string
          subreddits: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          audience?: string
          contact_gap_seconds?: number
          country?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          max_contacts?: number
          pace_per_minute?: number
          product_name?: string
          product_url?: string
          recency_minutes?: number
          scans?: number
          specifications?: string
          subreddits?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          audience?: string
          contact_gap_seconds?: number
          country?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          max_contacts?: number
          pace_per_minute?: number
          product_name?: string
          product_url?: string
          recency_minutes?: number
          scans?: number
          specifications?: string
          subreddits?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prospects: {
        Row: {
          approved_at: string | null
          author: string | null
          country_signal: string | null
          created_at: string
          drafted_at: string | null
          excerpt: string | null
          id: string
          intent_score: number | null
          message: string | null
          post_url: string
          posted_at: string | null
          problem: string | null
          qualification_reason: string | null
          rejected: boolean
          rejection_reason: string | null
          run_id: string | null
          source: string
          status: string
          subreddit: string | null
          summary: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          author?: string | null
          country_signal?: string | null
          created_at?: string
          drafted_at?: string | null
          excerpt?: string | null
          id?: string
          intent_score?: number | null
          message?: string | null
          post_url: string
          posted_at?: string | null
          problem?: string | null
          qualification_reason?: string | null
          rejected?: boolean
          rejection_reason?: string | null
          run_id?: string | null
          source?: string
          status?: string
          subreddit?: string | null
          summary?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          approved_at?: string | null
          author?: string | null
          country_signal?: string | null
          created_at?: string
          drafted_at?: string | null
          excerpt?: string | null
          id?: string
          intent_score?: number | null
          message?: string | null
          post_url?: string
          posted_at?: string | null
          problem?: string | null
          qualification_reason?: string | null
          rejected?: boolean
          rejection_reason?: string | null
          run_id?: string | null
          source?: string
          status?: string
          subreddit?: string | null
          summary?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_events: {
        Row: {
          created_at: string
          data: Json
          id: string
          kind: string
          run_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          kind: string
          run_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          kind?: string
          run_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          command: string
          created_at: string
          error: string | null
          id: string
          result: Json | null
          status: string
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          command: string
          created_at?: string
          error?: string | null
          id?: string
          result?: Json | null
          status?: string
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          command?: string
          created_at?: string
          error?: string | null
          id?: string
          result?: Json | null
          status?: string
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      worker_settings: {
        Row: {
          created_at: string
          last_error: string | null
          render_service_id: string | null
          status: string
          updated_at: string
          user_id: string
          worker_url: string | null
        }
        Insert: {
          created_at?: string
          last_error?: string | null
          render_service_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          worker_url?: string | null
        }
        Update: {
          created_at?: string
          last_error?: string | null
          render_service_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          worker_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
