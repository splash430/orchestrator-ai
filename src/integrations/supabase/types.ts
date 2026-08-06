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
      leads: {
        Row: {
          created_at: string
          date_discovered: string
          id: string
          notes: string
          post_url: string
          problem: string | null
          prospect_id: string | null
          reddit_username: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date_discovered?: string
          id?: string
          notes?: string
          post_url: string
          problem?: string | null
          prospect_id?: string | null
          reddit_username?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date_discovered?: string
          id?: string
          notes?: string
          post_url?: string
          problem?: string | null
          prospect_id?: string | null
          reddit_username?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
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
          industries: string[]
          keywords: string[]
          max_contacts: number
          pace_per_minute: number
          post_limit: number
          product_name: string
          product_url: string
          recency_minutes: number
          reddit_urls: string[]
          scans: number
          sort_order: string
          specifications: string
          subreddits: string[]
          updated_at: string
          user_id: string
          writing_style: string
        }
        Insert: {
          audience?: string
          contact_gap_seconds?: number
          country?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          industries?: string[]
          keywords?: string[]
          max_contacts?: number
          pace_per_minute?: number
          post_limit?: number
          product_name?: string
          product_url?: string
          recency_minutes?: number
          reddit_urls?: string[]
          scans?: number
          sort_order?: string
          specifications?: string
          subreddits?: string[]
          updated_at?: string
          user_id: string
          writing_style?: string
        }
        Update: {
          audience?: string
          contact_gap_seconds?: number
          country?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          industries?: string[]
          keywords?: string[]
          max_contacts?: number
          pace_per_minute?: number
          post_limit?: number
          product_name?: string
          product_url?: string
          recency_minutes?: number
          reddit_urls?: string[]
          scans?: number
          sort_order?: string
          specifications?: string
          subreddits?: string[]
          updated_at?: string
          user_id?: string
          writing_style?: string
        }
        Relationships: []
      }
      outreach_queue: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          logs: Json
          message: string
          prospect_id: string | null
          result: string | null
          scheduled_at: string
          screenshot_path: string | null
          started_at: string | null
          status: string
          target_url: string
          updated_at: string
          user_id: string
          website_lead_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          logs?: Json
          message: string
          prospect_id?: string | null
          result?: string | null
          scheduled_at?: string
          screenshot_path?: string | null
          started_at?: string | null
          status?: string
          target_url: string
          updated_at?: string
          user_id: string
          website_lead_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          logs?: Json
          message?: string
          prospect_id?: string | null
          result?: string | null
          scheduled_at?: string
          screenshot_path?: string | null
          started_at?: string | null
          status?: string
          target_url?: string
          updated_at?: string
          user_id?: string
          website_lead_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_queue_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_queue_website_lead_id_fkey"
            columns: ["website_lead_id"]
            isOneToOne: false
            referencedRelation: "website_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          ai_summary: string | null
          approved_at: string | null
          approved_reply: string | null
          author: string | null
          comments: Json
          contacted_at: string | null
          country_signal: string | null
          created_at: string
          drafted_at: string | null
          engagement: Json
          excerpt: string | null
          id: string
          ignored_at: string | null
          intent_level: string | null
          intent_score: number | null
          location: string | null
          message: string | null
          platform: string
          post_content: string | null
          post_url: string
          posted_at: string | null
          problem: string | null
          qualification_reason: string | null
          recommended_solution: string | null
          rejected: boolean
          rejection_reason: string | null
          reply_options: Json
          run_id: string | null
          saved: boolean
          scan_job_id: string | null
          source: string
          status: string
          subreddit: string | null
          suggested_offer: string | null
          summary: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          approved_at?: string | null
          approved_reply?: string | null
          author?: string | null
          comments?: Json
          contacted_at?: string | null
          country_signal?: string | null
          created_at?: string
          drafted_at?: string | null
          engagement?: Json
          excerpt?: string | null
          id?: string
          ignored_at?: string | null
          intent_level?: string | null
          intent_score?: number | null
          location?: string | null
          message?: string | null
          platform?: string
          post_content?: string | null
          post_url: string
          posted_at?: string | null
          problem?: string | null
          qualification_reason?: string | null
          recommended_solution?: string | null
          rejected?: boolean
          rejection_reason?: string | null
          reply_options?: Json
          run_id?: string | null
          saved?: boolean
          scan_job_id?: string | null
          source?: string
          status?: string
          subreddit?: string | null
          suggested_offer?: string | null
          summary?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          approved_at?: string | null
          approved_reply?: string | null
          author?: string | null
          comments?: Json
          contacted_at?: string | null
          country_signal?: string | null
          created_at?: string
          drafted_at?: string | null
          engagement?: Json
          excerpt?: string | null
          id?: string
          ignored_at?: string | null
          intent_level?: string | null
          intent_score?: number | null
          location?: string | null
          message?: string | null
          platform?: string
          post_content?: string | null
          post_url?: string
          posted_at?: string | null
          problem?: string | null
          qualification_reason?: string | null
          recommended_solution?: string | null
          rejected?: boolean
          rejection_reason?: string | null
          reply_options?: Json
          run_id?: string | null
          saved?: boolean
          scan_job_id?: string | null
          source?: string
          status?: string
          subreddit?: string | null
          suggested_offer?: string | null
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
          {
            foreignKeyName: "prospects_scan_job_id_fkey"
            columns: ["scan_job_id"]
            isOneToOne: false
            referencedRelation: "scan_jobs"
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
      scan_jobs: {
        Row: {
          actor_id: string
          apify_run_id: string | null
          config: Json
          created_at: string
          dataset_id: string | null
          error: string | null
          finished_at: string | null
          id: string
          items_collected: number
          opportunities_created: number
          source: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_id: string
          apify_run_id?: string | null
          config?: Json
          created_at?: string
          dataset_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          items_collected?: number
          opportunities_created?: number
          source?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_id?: string
          apify_run_id?: string | null
          config?: Json
          created_at?: string
          dataset_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          items_collected?: number
          opportunities_created?: number
          source?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      website_leads: {
        Row: {
          ai_summary: string | null
          approved_reply: string | null
          company_name: string | null
          contact_page: string | null
          created_at: string
          email: string | null
          excerpt: string | null
          id: string
          industry: string | null
          intent_level: string | null
          location: string | null
          phone: string | null
          problem: string | null
          recommended_solution: string | null
          reply_options: Json
          scan_job_id: string | null
          score: number | null
          social_links: Json
          status: string
          suggested_offer: string | null
          technologies: Json
          updated_at: string
          user_id: string
          website: string
        }
        Insert: {
          ai_summary?: string | null
          approved_reply?: string | null
          company_name?: string | null
          contact_page?: string | null
          created_at?: string
          email?: string | null
          excerpt?: string | null
          id?: string
          industry?: string | null
          intent_level?: string | null
          location?: string | null
          phone?: string | null
          problem?: string | null
          recommended_solution?: string | null
          reply_options?: Json
          scan_job_id?: string | null
          score?: number | null
          social_links?: Json
          status?: string
          suggested_offer?: string | null
          technologies?: Json
          updated_at?: string
          user_id: string
          website: string
        }
        Update: {
          ai_summary?: string | null
          approved_reply?: string | null
          company_name?: string | null
          contact_page?: string | null
          created_at?: string
          email?: string | null
          excerpt?: string | null
          id?: string
          industry?: string | null
          intent_level?: string | null
          location?: string | null
          phone?: string | null
          problem?: string | null
          recommended_solution?: string | null
          reply_options?: Json
          scan_job_id?: string | null
          score?: number | null
          social_links?: Json
          status?: string
          suggested_offer?: string | null
          technologies?: Json
          updated_at?: string
          user_id?: string
          website?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_leads_scan_job_id_fkey"
            columns: ["scan_job_id"]
            isOneToOne: false
            referencedRelation: "scan_jobs"
            referencedColumns: ["id"]
          },
        ]
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
