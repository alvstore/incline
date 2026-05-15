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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      access_devices: {
        Row: {
          branch_id: string
          config: Json | null
          created_at: string | null
          device_name: string
          device_type: string
          firmware_version: string | null
          id: string
          ip_address: unknown
          is_online: boolean | null
          last_heartbeat: string | null
          last_sync: string | null
          mac_address: string | null
          mips_device_id: number | null
          model: string | null
          public_ip: string | null
          relay_delay: number | null
          relay_mode: number | null
          serial_number: string | null
          updated_at: string | null
        }
        Insert: {
          branch_id: string
          config?: Json | null
          created_at?: string | null
          device_name: string
          device_type?: string
          firmware_version?: string | null
          id?: string
          ip_address: unknown
          is_online?: boolean | null
          last_heartbeat?: string | null
          last_sync?: string | null
          mac_address?: string | null
          mips_device_id?: number | null
          model?: string | null
          public_ip?: string | null
          relay_delay?: number | null
          relay_mode?: number | null
          serial_number?: string | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: string
          config?: Json | null
          created_at?: string | null
          device_name?: string
          device_type?: string
          firmware_version?: string | null
          id?: string
          ip_address?: unknown
          is_online?: boolean | null
          last_heartbeat?: string | null
          last_sync?: string | null
          mac_address?: string | null
          mips_device_id?: number | null
          model?: string | null
          public_ip?: string | null
          relay_delay?: number | null
          relay_mode?: number | null
          serial_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_devices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      access_logs: {
        Row: {
          branch_id: string | null
          captured_at: string | null
          created_at: string
          device_sn: string
          event_type: string
          hardware_device_id: string | null
          id: string
          member_id: string | null
          message: string | null
          payload: Json | null
          profile_id: string | null
          result: string | null
        }
        Insert: {
          branch_id?: string | null
          captured_at?: string | null
          created_at?: string
          device_sn: string
          event_type: string
          hardware_device_id?: string | null
          id?: string
          member_id?: string | null
          message?: string | null
          payload?: Json | null
          profile_id?: string | null
          result?: string | null
        }
        Update: {
          branch_id?: string | null
          captured_at?: string | null
          created_at?: string
          device_sn?: string
          event_type?: string
          hardware_device_id?: string | null
          id?: string
          member_id?: string | null
          message?: string | null
          payload?: Json | null
          profile_id?: string | null
          result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_logs_hardware_device_id_fkey"
            columns: ["hardware_device_id"]
            isOneToOne: false
            referencedRelation: "hardware_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_logs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_logs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "access_logs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_banners: {
        Row: {
          branch_id: string
          created_at: string | null
          display_order: number | null
          id: string
          image_url: string
          is_active: boolean | null
          redirect_url: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          image_url: string
          is_active?: boolean | null
          redirect_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          image_url?: string
          is_active?: boolean | null
          redirect_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_banners_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_call_logs: {
        Row: {
          branch_id: string | null
          completion_tokens: number | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          fallback_used: boolean
          id: string
          model: string | null
          prompt_tokens: number | null
          provider: string
          purpose: string | null
          scope: string | null
          status: string
        }
        Insert: {
          branch_id?: string | null
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          fallback_used?: boolean
          id?: string
          model?: string | null
          prompt_tokens?: number | null
          provider: string
          purpose?: string | null
          scope?: string | null
          status: string
        }
        Update: {
          branch_id?: string | null
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          fallback_used?: boolean
          id?: string
          model?: string | null
          prompt_tokens?: number | null
          provider?: string
          purpose?: string | null
          scope?: string | null
          status?: string
        }
        Relationships: []
      }
      ai_dashboard_insights: {
        Row: {
          branch_id: string | null
          created_at: string
          expires_at: string
          generated_at: string
          id: string
          insights: Json
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          expires_at?: string
          generated_at?: string
          id?: string
          insights: Json
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          expires_at?: string
          generated_at?: string
          id?: string
          insights?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_dashboard_insights_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge: {
        Row: {
          branch_id: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          tags: string[]
          title: string
          topic: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          tags?: string[]
          title: string
          topic: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          tags?: string[]
          title?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_memory: {
        Row: {
          asked_questions: string[]
          branch_id: string | null
          contact_key: string
          created_at: string
          current_intent: string | null
          do_not_ask: string[]
          facts: Json
          id: string
          last_seen_at: string
          platform: string
          profile: Json
          summary: string | null
          updated_at: string
        }
        Insert: {
          asked_questions?: string[]
          branch_id?: string | null
          contact_key: string
          created_at?: string
          current_intent?: string | null
          do_not_ask?: string[]
          facts?: Json
          id?: string
          last_seen_at?: string
          platform?: string
          profile?: Json
          summary?: string | null
          updated_at?: string
        }
        Update: {
          asked_questions?: string[]
          branch_id?: string | null
          contact_key?: string
          created_at?: string
          current_intent?: string | null
          do_not_ask?: string[]
          facts?: Json
          id?: string
          last_seen_at?: string
          platform?: string
          profile?: Json
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_memory_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_configs: {
        Row: {
          api_key_secret_name: string | null
          base_url: string | null
          created_at: string
          created_by: string | null
          default_model: string
          display_name: string
          enable_fallback: boolean
          extra_config: Json | null
          id: string
          is_active: boolean
          is_default: boolean
          provider: string
          scope: string
          updated_at: string
        }
        Insert: {
          api_key_secret_name?: string | null
          base_url?: string | null
          created_at?: string
          created_by?: string | null
          default_model: string
          display_name: string
          enable_fallback?: boolean
          extra_config?: Json | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          provider: string
          scope?: string
          updated_at?: string
        }
        Update: {
          api_key_secret_name?: string | null
          base_url?: string | null
          created_at?: string
          created_by?: string | null
          default_model?: string
          display_name?: string
          enable_fallback?: boolean
          extra_config?: Json | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          provider?: string
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_purposes: {
        Row: {
          branch_id: string | null
          created_at: string
          description: string | null
          enabled: boolean
          extra: Json
          guards: Json
          id: string
          max_tokens: number | null
          model: string | null
          provider_id: string | null
          purpose: string
          reply_delay_seconds: number
          system_prompt: string
          temperature: number | null
          tools_allowed: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          description?: string | null
          enabled?: boolean
          extra?: Json
          guards?: Json
          id?: string
          max_tokens?: number | null
          model?: string | null
          provider_id?: string | null
          purpose: string
          reply_delay_seconds?: number
          system_prompt?: string
          temperature?: number | null
          tools_allowed?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          description?: string | null
          enabled?: boolean
          extra?: Json
          guards?: Json
          id?: string
          max_tokens?: number | null
          model?: string | null
          provider_id?: string | null
          purpose?: string
          reply_delay_seconds?: number
          system_prompt?: string
          temperature?: number | null
          tools_allowed?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_purposes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_purposes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_provider_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_tool_logs: {
        Row: {
          arguments: Json | null
          branch_id: string | null
          chat_id: string | null
          created_at: string
          error_message: string | null
          execution_time_ms: number | null
          id: string
          message_id: string | null
          phone_number: string | null
          result: Json | null
          status: string
          tool_name: string
        }
        Insert: {
          arguments?: Json | null
          branch_id?: string | null
          chat_id?: string | null
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          message_id?: string | null
          phone_number?: string | null
          result?: Json | null
          status?: string
          tool_name: string
        }
        Update: {
          arguments?: Json | null
          branch_id?: string | null
          chat_id?: string | null
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          message_id?: string | null
          phone_number?: string | null
          result?: Json | null
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_tool_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          attachment_filename: string | null
          attachment_kind: string | null
          attachment_url: string | null
          audience_filter: Json
          branch_id: string | null
          channels: string[]
          content: string
          created_at: string
          created_by: string | null
          dispatch_summary: Json | null
          dispatched_at: string | null
          expire_at: string | null
          id: string
          is_active: boolean | null
          priority: number | null
          publish_at: string | null
          target_audience: string | null
          title: string
        }
        Insert: {
          attachment_filename?: string | null
          attachment_kind?: string | null
          attachment_url?: string | null
          audience_filter?: Json
          branch_id?: string | null
          channels?: string[]
          content: string
          created_at?: string
          created_by?: string | null
          dispatch_summary?: Json | null
          dispatched_at?: string | null
          expire_at?: string | null
          id?: string
          is_active?: boolean | null
          priority?: number | null
          publish_at?: string | null
          target_audience?: string | null
          title: string
        }
        Update: {
          attachment_filename?: string | null
          attachment_kind?: string | null
          attachment_url?: string | null
          audience_filter?: Json
          branch_id?: string | null
          channels?: string[]
          content?: string
          created_at?: string
          created_by?: string | null
          dispatch_summary?: Json | null
          dispatched_at?: string | null
          expire_at?: string | null
          id?: string
          is_active?: boolean | null
          priority?: number | null
          publish_at?: string | null
          target_audience?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_audit_archive: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          error_message: string | null
          id: string
          payload: Json
          request_id: string
          success: boolean
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          payload?: Json
          request_id: string
          success: boolean
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          payload?: Json
          request_id?: string
          success?: boolean
        }
        Relationships: []
      }
      approval_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          error_message: string | null
          id: string
          payload: Json
          request_id: string
          success: boolean
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          payload?: Json
          request_id: string
          success: boolean
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          payload?: Json
          request_id?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "approval_audit_log_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          approval_type: Database["public"]["Enums"]["approval_type"]
          branch_id: string
          created_at: string
          id: string
          reference_id: string
          reference_type: string
          request_data: Json
          requested_by: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          side_effects_committed_at: string | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          approval_type: Database["public"]["Enums"]["approval_type"]
          branch_id: string
          created_at?: string
          id?: string
          reference_id: string
          reference_type: string
          request_data: Json
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          side_effects_committed_at?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          approval_type?: Database["public"]["Enums"]["approval_type"]
          branch_id?: string
          created_at?: string
          id?: string
          reference_id?: string
          reference_type?: string
          request_data?: Json
          requested_by?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          side_effects_committed_at?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          action_description: string | null
          actor_name: string | null
          branch_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          target_name: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          action_description?: string | null
          actor_name?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          target_name?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          action_description?: string | null
          actor_name?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          target_name?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      automation_diagnostics: {
        Row: {
          branch_id: string | null
          channel: string
          conversation_key: string
          created_at: string
          id: string
          kind: string
          payload: Json
        }
        Insert: {
          branch_id?: string | null
          channel?: string
          conversation_key: string
          created_at?: string
          id?: string
          kind: string
          payload?: Json
        }
        Update: {
          branch_id?: string | null
          channel?: string
          conversation_key?: string
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automation_diagnostics_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          ai_tone: string | null
          branch_id: string | null
          category: string
          created_at: string
          cron_expression: string
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          last_dispatched_count: number | null
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          name: string
          next_run_at: string
          target_filter: Json
          updated_at: string
          use_ai: boolean
          worker: string
          worker_payload: Json
        }
        Insert: {
          ai_tone?: string | null
          branch_id?: string | null
          category?: string
          created_at?: string
          cron_expression?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          last_dispatched_count?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          name: string
          next_run_at?: string
          target_filter?: Json
          updated_at?: string
          use_ai?: boolean
          worker: string
          worker_payload?: Json
        }
        Update: {
          ai_tone?: string | null
          branch_id?: string | null
          category?: string
          created_at?: string
          cron_expression?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          last_dispatched_count?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          name?: string
          next_run_at?: string
          target_filter?: Json
          updated_at?: string
          use_ai?: boolean
          worker?: string
          worker_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          branch_id: string | null
          dispatched_count: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          payload: Json | null
          rule_id: string
          started_at: string
          status: string
        }
        Insert: {
          branch_id?: string | null
          dispatched_count?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          payload?: Json | null
          rule_id: string
          started_at?: string
          status?: string
        }
        Update: {
          branch_id?: string | null
          dispatched_count?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          payload?: Json | null
          rule_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_bookings: {
        Row: {
          booked_at: string
          booked_by_staff_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by_staff_id: string | null
          check_in_at: string | null
          created_at: string
          force_added: boolean
          force_reason: string | null
          id: string
          member_id: string
          membership_id: string
          no_show_marked_at: string | null
          notes: string | null
          slot_id: string
          source: string
          status: Database["public"]["Enums"]["benefit_booking_status"]
          updated_at: string
        }
        Insert: {
          booked_at?: string
          booked_by_staff_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_staff_id?: string | null
          check_in_at?: string | null
          created_at?: string
          force_added?: boolean
          force_reason?: string | null
          id?: string
          member_id: string
          membership_id: string
          no_show_marked_at?: string | null
          notes?: string | null
          slot_id: string
          source?: string
          status?: Database["public"]["Enums"]["benefit_booking_status"]
          updated_at?: string
        }
        Update: {
          booked_at?: string
          booked_by_staff_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_staff_id?: string | null
          check_in_at?: string | null
          created_at?: string
          force_added?: boolean
          force_reason?: string | null
          id?: string
          member_id?: string
          membership_id?: string
          no_show_marked_at?: string | null
          notes?: string | null
          slot_id?: string
          source?: string
          status?: Database["public"]["Enums"]["benefit_booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_bookings_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "benefit_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_packages: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id: string | null
          branch_id: string
          created_at: string
          description: string | null
          display_order: number | null
          gst_category: string
          hsn_code: string | null
          id: string
          is_active: boolean | null
          name: string
          price: number
          quantity: number
          tax_inclusive: boolean
          tax_rate: number
          updated_at: string
          validity_days: number
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          branch_id: string
          created_at?: string
          description?: string | null
          display_order?: number | null
          gst_category?: string
          hsn_code?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price: number
          quantity: number
          tax_inclusive?: boolean
          tax_rate?: number
          updated_at?: string
          validity_days?: number
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          branch_id?: string
          created_at?: string
          description?: string | null
          display_order?: number | null
          gst_category?: string
          hsn_code?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          quantity?: number
          tax_inclusive?: boolean
          tax_rate?: number
          updated_at?: string
          validity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "benefit_packages_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_packages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_settings: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id: string | null
          booking_opens_hours_before: number | null
          branch_id: string
          buffer_between_sessions_minutes: number | null
          cancellation_deadline_minutes: number | null
          capacity_per_slot: number | null
          created_at: string
          id: string
          is_slot_booking_enabled: boolean | null
          max_bookings_per_day: number | null
          no_show_penalty_amount: number | null
          no_show_policy: Database["public"]["Enums"]["no_show_policy"] | null
          operating_hours_end: string | null
          operating_hours_start: string | null
          slot_duration_minutes: number | null
          updated_at: string
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          booking_opens_hours_before?: number | null
          branch_id: string
          buffer_between_sessions_minutes?: number | null
          cancellation_deadline_minutes?: number | null
          capacity_per_slot?: number | null
          created_at?: string
          id?: string
          is_slot_booking_enabled?: boolean | null
          max_bookings_per_day?: number | null
          no_show_penalty_amount?: number | null
          no_show_policy?: Database["public"]["Enums"]["no_show_policy"] | null
          operating_hours_end?: string | null
          operating_hours_start?: string | null
          slot_duration_minutes?: number | null
          updated_at?: string
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          booking_opens_hours_before?: number | null
          branch_id?: string
          buffer_between_sessions_minutes?: number | null
          cancellation_deadline_minutes?: number | null
          capacity_per_slot?: number | null
          created_at?: string
          id?: string
          is_slot_booking_enabled?: boolean | null
          max_bookings_per_day?: number | null
          no_show_penalty_amount?: number | null
          no_show_policy?: Database["public"]["Enums"]["no_show_policy"] | null
          operating_hours_end?: string | null
          operating_hours_start?: string | null
          slot_duration_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_settings_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_slot_waitlist: {
        Row: {
          branch_id: string | null
          id: string
          joined_at: string
          member_id: string
          notified_at: string | null
          position: number
          promoted_at: string | null
          promoted_booking_id: string | null
          slot_id: string
          status: string
        }
        Insert: {
          branch_id?: string | null
          id?: string
          joined_at?: string
          member_id: string
          notified_at?: string | null
          position?: number
          promoted_at?: string | null
          promoted_booking_id?: string | null
          slot_id: string
          status?: string
        }
        Update: {
          branch_id?: string | null
          id?: string
          joined_at?: string
          member_id?: string
          notified_at?: string | null
          position?: number
          promoted_at?: string | null
          promoted_booking_id?: string | null
          slot_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_slot_waitlist_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_slot_waitlist_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "benefit_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_slots: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id: string | null
          booked_count: number | null
          branch_id: string
          capacity: number
          created_at: string
          end_time: string
          facility_id: string | null
          id: string
          is_active: boolean | null
          slot_date: string
          start_time: string
          updated_at: string
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          booked_count?: number | null
          branch_id: string
          capacity?: number
          created_at?: string
          end_time: string
          facility_id?: string | null
          id?: string
          is_active?: boolean | null
          slot_date: string
          start_time: string
          updated_at?: string
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          booked_count?: number | null
          branch_id?: string
          capacity?: number
          created_at?: string
          end_time?: string
          facility_id?: string | null
          id?: string
          is_active?: boolean | null
          slot_date?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_slots_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_slots_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_slots_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_types: {
        Row: {
          branch_id: string
          category: string | null
          code: string
          created_at: string
          default_duration_minutes: number | null
          description: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_bookable: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          category?: string | null
          code: string
          created_at?: string
          default_duration_minutes?: number | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_bookable?: boolean | null
          name: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          category?: string | null
          code?: string
          created_at?: string
          default_duration_minutes?: number | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_bookable?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_types_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_usage: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id: string | null
          created_at: string
          id: string
          membership_id: string
          notes: string | null
          recorded_by: string | null
          usage_count: number | null
          usage_date: string
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          created_at?: string
          id?: string
          membership_id: string
          notes?: string | null
          recorded_by?: string | null
          usage_count?: number | null
          usage_date?: string
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          created_at?: string
          id?: string
          membership_id?: string
          notes?: string | null
          recorded_by?: string | null
          usage_count?: number | null
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_usage_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_usage_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_usage_recorded_by_profiles_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "benefit_usage_recorded_by_profiles_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      biometric_sync_queue: {
        Row: {
          device_id: string | null
          error_message: string | null
          id: string
          member_id: string | null
          person_name: string
          person_uuid: string
          photo_url: string
          processed_at: string | null
          queued_at: string | null
          retry_count: number | null
          staff_id: string | null
          status: string | null
          sync_type: string
        }
        Insert: {
          device_id?: string | null
          error_message?: string | null
          id?: string
          member_id?: string | null
          person_name: string
          person_uuid: string
          photo_url: string
          processed_at?: string | null
          queued_at?: string | null
          retry_count?: number | null
          staff_id?: string | null
          status?: string | null
          sync_type: string
        }
        Update: {
          device_id?: string | null
          error_message?: string | null
          id?: string
          member_id?: string | null
          person_name?: string
          person_uuid?: string
          photo_url?: string
          processed_at?: string | null
          queued_at?: string | null
          retry_count?: number | null
          staff_id?: string | null
          status?: string | null
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "biometric_sync_queue_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "access_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biometric_sync_queue_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biometric_sync_queue_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_audit_log: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          booking_id: string
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json
          reason: string | null
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          booking_id: string
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          booking_id?: string
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_audit_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "benefit_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_managers: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_primary: boolean | null
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_primary?: boolean | null
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_managers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_managers_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "branch_managers_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_settings: {
        Row: {
          advance_booking_days: number | null
          auto_attendance_checkout: boolean | null
          block_access_on_overdue: boolean
          branch_id: string
          cancellation_fee_rate: number | null
          checkout_after_hours: number | null
          created_at: string
          currency: string | null
          freeze_fee: number | null
          freeze_max_days: number | null
          freeze_min_days: number | null
          id: string
          late_fee_rate: number | null
          overdue_grace_days: number
          tax_rate: number | null
          updated_at: string
          waitlist_enabled: boolean | null
        }
        Insert: {
          advance_booking_days?: number | null
          auto_attendance_checkout?: boolean | null
          block_access_on_overdue?: boolean
          branch_id: string
          cancellation_fee_rate?: number | null
          checkout_after_hours?: number | null
          created_at?: string
          currency?: string | null
          freeze_fee?: number | null
          freeze_max_days?: number | null
          freeze_min_days?: number | null
          id?: string
          late_fee_rate?: number | null
          overdue_grace_days?: number
          tax_rate?: number | null
          updated_at?: string
          waitlist_enabled?: boolean | null
        }
        Update: {
          advance_booking_days?: number | null
          auto_attendance_checkout?: boolean | null
          block_access_on_overdue?: boolean
          branch_id?: string
          cancellation_fee_rate?: number | null
          checkout_after_hours?: number | null
          created_at?: string
          currency?: string | null
          freeze_fee?: number | null
          freeze_max_days?: number | null
          freeze_min_days?: number | null
          id?: string
          late_fee_rate?: number | null
          overdue_grace_days?: number
          tax_rate?: number | null
          updated_at?: string
          waitlist_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          capacity: number | null
          city: string | null
          closing_time: string | null
          code: string
          country: string | null
          created_at: string
          email: string | null
          google_place_id: string | null
          google_review_link: string | null
          google_review_qr_url: string | null
          gstin: string | null
          id: string
          is_active: boolean | null
          name: string
          opening_time: string | null
          phone: string | null
          postal_code: string | null
          state: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          closing_time?: string | null
          code: string
          country?: string | null
          created_at?: string
          email?: string | null
          google_place_id?: string | null
          google_review_link?: string | null
          google_review_qr_url?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          opening_time?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          closing_time?: string | null
          code?: string
          country?: string | null
          created_at?: string
          email?: string | null
          google_place_id?: string | null
          google_review_link?: string | null
          google_review_qr_url?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          opening_time?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          created_at: string
          dispatched_at: string | null
          email: string | null
          error: string | null
          error_code: string | null
          error_reason: string | null
          full_name: string | null
          id: string
          in_window: boolean | null
          phone: string | null
          read_at: string | null
          source_label: string | null
          source_ref_id: string | null
          source_type: string
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          dispatched_at?: string | null
          email?: string | null
          error?: string | null
          error_code?: string | null
          error_reason?: string | null
          full_name?: string | null
          id?: string
          in_window?: boolean | null
          phone?: string | null
          read_at?: string | null
          source_label?: string | null
          source_ref_id?: string | null
          source_type: string
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          dispatched_at?: string | null
          email?: string | null
          error?: string | null
          error_code?: string | null
          error_reason?: string | null
          full_name?: string | null
          id?: string
          in_window?: boolean | null
          phone?: string | null
          read_at?: string | null
          source_label?: string | null
          source_ref_id?: string | null
          source_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_runs: {
        Row: {
          campaign_id: string
          channel: string
          error: string | null
          id: string
          recipient_email: string | null
          recipient_id: string | null
          recipient_phone: string | null
          recipient_type: string | null
          sent_at: string
          status: string
        }
        Insert: {
          campaign_id: string
          channel: string
          error?: string | null
          id?: string
          recipient_email?: string | null
          recipient_id?: string | null
          recipient_phone?: string | null
          recipient_type?: string | null
          sent_at?: string
          status?: string
        }
        Update: {
          campaign_id?: string
          channel?: string
          error?: string | null
          id?: string
          recipient_email?: string | null
          recipient_id?: string | null
          recipient_phone?: string | null
          recipient_type?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_runs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          attachment_filename: string | null
          attachment_kind: string | null
          attachment_url: string | null
          audience_filter: Json
          branch_id: string
          campaign_type: string
          channel: string
          created_at: string
          created_by: string | null
          event_meta: Json
          failure_count: number
          id: string
          last_run_error: string | null
          message: string
          name: string
          recipients_count: number
          scheduled_at: string | null
          sent_at: string | null
          status: string
          subject: string | null
          success_count: number
          template_id: string | null
          timezone: string
          trigger_type: string
          updated_at: string
        }
        Insert: {
          attachment_filename?: string | null
          attachment_kind?: string | null
          attachment_url?: string | null
          audience_filter?: Json
          branch_id: string
          campaign_type?: string
          channel: string
          created_at?: string
          created_by?: string | null
          event_meta?: Json
          failure_count?: number
          id?: string
          last_run_error?: string | null
          message: string
          name: string
          recipients_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          success_count?: number
          template_id?: string | null
          timezone?: string
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          attachment_filename?: string | null
          attachment_kind?: string | null
          attachment_url?: string | null
          audience_filter?: Json
          branch_id?: string
          campaign_type?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          event_meta?: Json
          failure_count?: number
          id?: string
          last_run_error?: string | null
          message?: string
          name?: string
          recipients_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          success_count?: number
          template_id?: string | null
          timezone?: string
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_with_meta_status"
            referencedColumns: ["id"]
          },
        ]
      }
      class_bookings: {
        Row: {
          attended_at: string | null
          booked_at: string
          cancellation_reason: string | null
          cancelled_at: string | null
          class_id: string
          created_at: string
          id: string
          member_id: string
          no_show_reason: string | null
          status: Database["public"]["Enums"]["class_booking_status"]
          was_waitlisted: boolean
        }
        Insert: {
          attended_at?: string | null
          booked_at?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          class_id: string
          created_at?: string
          id?: string
          member_id: string
          no_show_reason?: string | null
          status?: Database["public"]["Enums"]["class_booking_status"]
          was_waitlisted?: boolean
        }
        Update: {
          attended_at?: string | null
          booked_at?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          class_id?: string
          created_at?: string
          id?: string
          member_id?: string
          no_show_reason?: string | null
          status?: Database["public"]["Enums"]["class_booking_status"]
          was_waitlisted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "class_bookings_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      class_waitlist: {
        Row: {
          added_at: string
          class_id: string
          created_at: string
          id: string
          member_id: string
          notified_at: string | null
          position: number
        }
        Insert: {
          added_at?: string
          class_id: string
          created_at?: string
          id?: string
          member_id: string
          notified_at?: string | null
          position: number
        }
        Update: {
          added_at?: string
          class_id?: string
          created_at?: string
          id?: string
          member_id?: string
          notified_at?: string | null
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "class_waitlist_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_waitlist_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          benefit_type_id: string | null
          branch_id: string
          capacity: number
          class_type: string | null
          created_at: string
          description: string | null
          duration_minutes: number | null
          gst_rate: number
          id: string
          is_active: boolean | null
          is_gst_inclusive: boolean
          is_paid: boolean
          is_recurring: boolean | null
          name: string
          price: number
          recurrence_rule: string | null
          requires_benefit: boolean
          scheduled_at: string
          trainer_id: string | null
          updated_at: string
        }
        Insert: {
          benefit_type_id?: string | null
          branch_id: string
          capacity: number
          class_type?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          gst_rate?: number
          id?: string
          is_active?: boolean | null
          is_gst_inclusive?: boolean
          is_paid?: boolean
          is_recurring?: boolean | null
          name: string
          price?: number
          recurrence_rule?: string | null
          requires_benefit?: boolean
          scheduled_at: string
          trainer_id?: string | null
          updated_at?: string
        }
        Update: {
          benefit_type_id?: string | null
          branch_id?: string
          capacity?: number
          class_type?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          gst_rate?: number
          id?: string
          is_active?: boolean | null
          is_gst_inclusive?: boolean
          is_paid?: boolean
          is_recurring?: boolean | null
          name?: string
          price?: number
          recurrence_rule?: string | null
          requires_benefit?: boolean
          scheduled_at?: string
          trainer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_delivery_events: {
        Row: {
          actor_user_id: string | null
          branch_id: string
          channel: string
          communication_log_id: string | null
          created_at: string
          error_message: string | null
          id: string
          member_id: string | null
          metadata: Json
          new_status: Database["public"]["Enums"]["reminder_delivery_status"]
          previous_status:
            | Database["public"]["Enums"]["reminder_delivery_status"]
            | null
          provider: string | null
          provider_message_id: string | null
          reminder_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          branch_id: string
          channel: string
          communication_log_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          member_id?: string | null
          metadata?: Json
          new_status: Database["public"]["Enums"]["reminder_delivery_status"]
          previous_status?:
            | Database["public"]["Enums"]["reminder_delivery_status"]
            | null
          provider?: string | null
          provider_message_id?: string | null
          reminder_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          branch_id?: string
          channel?: string
          communication_log_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          member_id?: string | null
          metadata?: Json
          new_status?: Database["public"]["Enums"]["reminder_delivery_status"]
          previous_status?:
            | Database["public"]["Enums"]["reminder_delivery_status"]
            | null
          provider?: string | null
          provider_message_id?: string | null
          reminder_id?: string | null
        }
        Relationships: []
      }
      communication_logs: {
        Row: {
          attempt_count: number
          branch_id: string
          category: string | null
          channel: string | null
          content: string | null
          created_at: string
          dedupe_key: string | null
          delivery_metadata: Json
          delivery_status: Database["public"]["Enums"]["reminder_delivery_status"]
          error_message: string | null
          id: string
          member_id: string | null
          provider_message_id: string | null
          recipient: string
          sent_at: string | null
          status: string | null
          subject: string | null
          template_id: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          attempt_count?: number
          branch_id: string
          category?: string | null
          channel?: string | null
          content?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivery_metadata?: Json
          delivery_status?: Database["public"]["Enums"]["reminder_delivery_status"]
          error_message?: string | null
          id?: string
          member_id?: string | null
          provider_message_id?: string | null
          recipient: string
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          template_id?: string | null
          type: string
          user_id?: string | null
        }
        Update: {
          attempt_count?: number
          branch_id?: string
          category?: string | null
          channel?: string | null
          content?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivery_metadata?: Json
          delivery_status?: Database["public"]["Enums"]["reminder_delivery_status"]
          error_message?: string | null
          id?: string
          member_id?: string | null
          provider_message_id?: string | null
          recipient?: string
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          template_id?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_logs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_with_meta_status"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_retry_queue: {
        Row: {
          branch_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          content: string
          created_at: string
          id: string
          last_error: string | null
          max_retries: number
          member_id: string | null
          metadata: Json | null
          next_retry_at: string
          original_log_id: string | null
          recipient: string
          retry_count: number
          status: string
          subject: string | null
          succeeded_at: string | null
          template_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          content: string
          created_at?: string
          id?: string
          last_error?: string | null
          max_retries?: number
          member_id?: string | null
          metadata?: Json | null
          next_retry_at?: string
          original_log_id?: string | null
          recipient: string
          retry_count?: number
          status?: string
          subject?: string | null
          succeeded_at?: string | null
          template_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          content?: string
          created_at?: string
          id?: string
          last_error?: string | null
          max_retries?: number
          member_id?: string | null
          metadata?: Json | null
          next_retry_at?: string
          original_log_id?: string | null
          recipient?: string
          retry_count?: number
          status?: string
          subject?: string | null
          succeeded_at?: string | null
          template_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_retry_queue_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_retry_queue_original_log_id_fkey"
            columns: ["original_log_id"]
            isOneToOne: false
            referencedRelation: "communication_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_segments: {
        Row: {
          audience_count: number
          branch_id: string
          created_at: string
          created_by: string | null
          description: string | null
          filter: Json
          id: string
          last_refreshed_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          audience_count?: number
          branch_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          filter?: Json
          id?: string
          last_refreshed_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          audience_count?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          filter?: Json
          id?: string
          last_refreshed_at?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_segments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          branch_id: string
          category: string
          company: string | null
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string
          source_id: string | null
          source_type: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          branch_id: string
          category?: string
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone: string
          source_id?: string | null
          source_type?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          branch_id?: string
          category?: string
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string
          source_id?: string | null
          source_type?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signature_requests: {
        Row: {
          branch_id: string | null
          contract_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          revoked_at: string | null
          signer_contact: string | null
          signer_name: string | null
          status: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          branch_id?: string | null
          contract_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          revoked_at?: string | null
          signer_contact?: string | null
          signer_name?: string | null
          status?: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          branch_id?: string | null
          contract_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
          signer_contact?: string | null
          signer_name?: string | null
          status?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signature_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signature_requests_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signatures: {
        Row: {
          contract_id: string
          id: string
          ip_address: string | null
          request_id: string | null
          signature_text: string
          signed_at: string
          signed_name: string
          signer_contact: string | null
          user_agent: string | null
        }
        Insert: {
          contract_id: string
          id?: string
          ip_address?: string | null
          request_id?: string | null
          signature_text: string
          signed_at?: string
          signed_name: string
          signer_contact?: string | null
          user_agent?: string | null
        }
        Update: {
          contract_id?: string
          id?: string
          ip_address?: string | null
          request_id?: string | null
          signature_text?: string
          signed_at?: string
          signed_name?: string
          signer_contact?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signatures_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "contract_signature_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          template_name: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          template_name: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          base_salary: number | null
          branch_id: string | null
          commission_percentage: number | null
          contract_type: string
          created_at: string
          document_url: string | null
          employee_id: string
          end_date: string | null
          id: string
          salary: number
          signature_requested_at: string | null
          signature_status: string
          signed_at: string | null
          signed_pdf_url: string | null
          start_date: string
          status: Database["public"]["Enums"]["contract_status"]
          terms: Json | null
          trainer_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          base_salary?: number | null
          branch_id?: string | null
          commission_percentage?: number | null
          contract_type: string
          created_at?: string
          document_url?: string | null
          employee_id: string
          end_date?: string | null
          id?: string
          salary: number
          signature_requested_at?: string | null
          signature_status?: string
          signed_at?: string | null
          signed_pdf_url?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["contract_status"]
          terms?: Json | null
          trainer_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          base_salary?: number | null
          branch_id?: string | null
          commission_percentage?: number | null
          contract_type?: string
          created_at?: string
          document_url?: string | null
          employee_id?: string
          end_date?: string | null
          id?: string
          salary?: number
          signature_requested_at?: string | null
          signature_status?: string
          signed_at?: string | null
          signed_pdf_url?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["contract_status"]
          terms?: Json | null
          trainer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemptions: {
        Row: {
          branch_id: string | null
          created_at: string
          discount_applied: number
          discount_code_id: string
          id: string
          idempotency_key: string | null
          invoice_id: string | null
          member_id: string | null
          order_total: number
          release_reason: string | null
          released_at: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          discount_applied: number
          discount_code_id: string
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          member_id?: string | null
          order_total: number
          release_reason?: string | null
          released_at?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          discount_applied?: number
          discount_code_id?: string
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          member_id?: string | null
          order_total?: number
          release_reason?: string | null
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          completed_at: string | null
          confirmation_code: string
          created_at: string
          email: string | null
          external_user_id: string | null
          id: string
          notes: string | null
          payload: Json | null
          source: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          confirmation_code: string
          created_at?: string
          email?: string | null
          external_user_id?: string | null
          id?: string
          notes?: string | null
          payload?: Json | null
          source: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          confirmation_code?: string
          created_at?: string
          email?: string | null
          external_user_id?: string | null
          id?: string
          notes?: string | null
          payload?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      device_access_events: {
        Row: {
          access_granted: boolean
          branch_id: string
          confidence_score: number | null
          created_at: string | null
          denial_reason: string | null
          device_id: string | null
          device_message: string | null
          event_type: string
          id: string
          member_id: string | null
          photo_url: string | null
          processed_at: string | null
          response_sent: string | null
          staff_id: string | null
        }
        Insert: {
          access_granted?: boolean
          branch_id: string
          confidence_score?: number | null
          created_at?: string | null
          denial_reason?: string | null
          device_id?: string | null
          device_message?: string | null
          event_type: string
          id?: string
          member_id?: string | null
          photo_url?: string | null
          processed_at?: string | null
          response_sent?: string | null
          staff_id?: string | null
        }
        Update: {
          access_granted?: boolean
          branch_id?: string
          confidence_score?: number | null
          created_at?: string | null
          denial_reason?: string | null
          device_id?: string | null
          device_message?: string | null
          event_type?: string
          id?: string
          member_id?: string | null
          photo_url?: string | null
          processed_at?: string | null
          response_sent?: string | null
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_access_events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_access_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "access_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_access_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_access_events_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      device_commands: {
        Row: {
          command_type: string
          device_id: string
          executed_at: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          payload: Json | null
          status: string
        }
        Insert: {
          command_type?: string
          device_id: string
          executed_at?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          payload?: Json | null
          status?: string
        }
        Update: {
          command_type?: string
          device_id?: string
          executed_at?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "access_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      diet_plans: {
        Row: {
          calories_target: number | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          is_ai_generated: boolean | null
          member_id: string
          name: string
          plan_data: Json
          plan_type: string | null
          start_date: string | null
          trainer_id: string | null
          updated_at: string
        }
        Insert: {
          calories_target?: number | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          is_ai_generated?: boolean | null
          member_id: string
          name: string
          plan_data?: Json
          plan_type?: string | null
          start_date?: string | null
          trainer_id?: string | null
          updated_at?: string
        }
        Update: {
          calories_target?: number | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          is_ai_generated?: boolean | null
          member_id?: string
          name?: string
          plan_data?: Json
          plan_type?: string | null
          start_date?: string | null
          trainer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diet_plans_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diet_plans_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diet_plans_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_codes: {
        Row: {
          branch_id: string | null
          code: string
          created_at: string | null
          created_by: string | null
          description: string | null
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean | null
          max_uses: number | null
          min_purchase: number | null
          times_used: number | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          branch_id?: string | null
          code: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          min_purchase?: number | null
          times_used?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          branch_id?: string | null
          code?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          min_purchase?: number | null
          times_used?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discount_codes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_redemption_attempts: {
        Row: {
          attempted_by: string | null
          branch_id: string | null
          code: string
          created_at: string
          discount_code_id: string | null
          id: string
          member_id: string | null
          reason: string
          subtotal: number | null
        }
        Insert: {
          attempted_by?: string | null
          branch_id?: string | null
          code: string
          created_at?: string
          discount_code_id?: string | null
          id?: string
          member_id?: string | null
          reason: string
          subtotal?: number | null
        }
        Update: {
          attempted_by?: string | null
          branch_id?: string | null
          code?: string
          created_at?: string
          discount_code_id?: string | null
          id?: string
          member_id?: string | null
          reason?: string
          subtotal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discount_redemption_attempts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemption_attempts_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemption_attempts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_redemptions: {
        Row: {
          branch_id: string | null
          code: string
          created_at: string
          created_by: string | null
          discount_amount: number
          discount_code_id: string
          id: string
          idempotency_key: string | null
          member_id: string | null
          reference_id: string | null
          reference_type: string | null
          subtotal: number
        }
        Insert: {
          branch_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          discount_code_id: string
          id?: string
          idempotency_key?: string | null
          member_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          subtotal?: number
        }
        Update: {
          branch_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          discount_code_id?: string
          id?: string
          idempotency_key?: string | null
          member_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "discount_redemptions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      dr_drill_log: {
        Row: {
          app_config_switched: boolean
          attendance_ok: boolean
          created_at: string
          db_restored: boolean
          drill_date: string
          edge_functions_deployed: boolean
          id: string
          invoice_create_ok: boolean
          member_login_ok: boolean
          notes: string | null
          outcome: string
          payment_webhook_ok: boolean
          performed_by: string | null
          storage_restored: boolean
          storage_upload_ok: boolean
          whatsapp_webhook_ok: boolean
        }
        Insert: {
          app_config_switched?: boolean
          attendance_ok?: boolean
          created_at?: string
          db_restored?: boolean
          drill_date?: string
          edge_functions_deployed?: boolean
          id?: string
          invoice_create_ok?: boolean
          member_login_ok?: boolean
          notes?: string | null
          outcome?: string
          payment_webhook_ok?: boolean
          performed_by?: string | null
          storage_restored?: boolean
          storage_upload_ok?: boolean
          whatsapp_webhook_ok?: boolean
        }
        Update: {
          app_config_switched?: boolean
          attendance_ok?: boolean
          created_at?: string
          db_restored?: boolean
          drill_date?: string
          edge_functions_deployed?: boolean
          id?: string
          invoice_create_ok?: boolean
          member_login_ok?: boolean
          notes?: string | null
          outcome?: string
          payment_webhook_ok?: boolean
          performed_by?: string | null
          storage_restored?: boolean
          storage_upload_ok?: boolean
          whatsapp_webhook_ok?: boolean
        }
        Relationships: []
      }
      dr_probe: {
        Row: {
          id: string
          observed_at: string
          payload: Json | null
          source: string
        }
        Insert: {
          id?: string
          observed_at?: string
          payload?: Json | null
          source: string
        }
        Update: {
          id?: string
          observed_at?: string
          payload?: Json | null
          source?: string
        }
        Relationships: []
      }
      dr_readiness_checklist: {
        Row: {
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          description: string | null
          evidence: string | null
          label: string
          step_no: number
          updated_at: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          description?: string | null
          evidence?: string | null
          label: string
          step_no: number
          updated_at?: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          description?: string | null
          evidence?: string | null
          label?: string
          step_no?: number
          updated_at?: string
        }
        Relationships: []
      }
      ecommerce_orders: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          items: Json
          member_id: string | null
          notes: string | null
          order_number: string
          payment_id: string | null
          shipping_address: Json | null
          shipping_amount: number | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax_amount: number | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          items?: Json
          member_id?: string | null
          notes?: string | null
          order_number: string
          payment_id?: string | null
          shipping_address?: Json | null
          shipping_amount?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax_amount?: number | null
          total_amount: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          items?: Json
          member_id?: string | null
          notes?: string | null
          order_number?: string
          payment_id?: string | null
          shipping_address?: Json | null
          shipping_amount?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecommerce_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_orders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_orders_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      employees: {
        Row: {
          avatar_storage_path: string | null
          bank_account: string | null
          bank_name: string | null
          biometric_enrolled: boolean | null
          biometric_photo_path: string | null
          biometric_photo_url: string | null
          branch_id: string
          created_at: string
          department: string | null
          employee_code: string
          hire_date: string
          id: string
          is_active: boolean | null
          mips_person_id: string | null
          mips_person_sn: string | null
          mips_sync_status: string | null
          position: string | null
          salary: number | null
          salary_type: string | null
          tax_id: string | null
          updated_at: string
          user_id: string
          weekly_off: string | null
        }
        Insert: {
          avatar_storage_path?: string | null
          bank_account?: string | null
          bank_name?: string | null
          biometric_enrolled?: boolean | null
          biometric_photo_path?: string | null
          biometric_photo_url?: string | null
          branch_id: string
          created_at?: string
          department?: string | null
          employee_code: string
          hire_date: string
          id?: string
          is_active?: boolean | null
          mips_person_id?: string | null
          mips_person_sn?: string | null
          mips_sync_status?: string | null
          position?: string | null
          salary?: number | null
          salary_type?: string | null
          tax_id?: string | null
          updated_at?: string
          user_id: string
          weekly_off?: string | null
        }
        Update: {
          avatar_storage_path?: string | null
          bank_account?: string | null
          bank_name?: string | null
          biometric_enrolled?: boolean | null
          biometric_photo_path?: string | null
          biometric_photo_url?: string | null
          branch_id?: string
          created_at?: string
          department?: string | null
          employee_code?: string
          hire_date?: string
          id?: string
          is_active?: boolean | null
          mips_person_id?: string | null
          mips_person_sn?: string | null
          mips_sync_status?: string | null
          position?: string | null
          salary?: number | null
          salary_type?: string | null
          tax_id?: string | null
          updated_at?: string
          user_id?: string
          weekly_off?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employees_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          branch_id: string
          brand: string | null
          category: string | null
          created_at: string
          id: string
          location: string | null
          model: string | null
          movement_pattern: string | null
          muscle_groups: string[]
          name: string
          notes: string | null
          primary_category: string | null
          purchase_date: string | null
          purchase_price: number | null
          serial_number: string | null
          status: Database["public"]["Enums"]["equipment_status"]
          updated_at: string
          warranty_expiry: string | null
        }
        Insert: {
          branch_id: string
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          location?: string | null
          model?: string | null
          movement_pattern?: string | null
          muscle_groups?: string[]
          name: string
          notes?: string | null
          primary_category?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          updated_at?: string
          warranty_expiry?: string | null
        }
        Update: {
          branch_id?: string
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          location?: string | null
          model?: string | null
          movement_pattern?: string | null
          muscle_groups?: string[]
          name?: string
          notes?: string | null
          primary_category?: string | null
          purchase_date?: string | null
          purchase_price?: number | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          updated_at?: string
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_maintenance: {
        Row: {
          completed_date: string | null
          cost: number | null
          created_at: string
          description: string | null
          equipment_id: string
          id: string
          maintenance_type: string
          notes: string | null
          performed_by: string | null
          scheduled_date: string | null
        }
        Insert: {
          completed_date?: string | null
          cost?: number | null
          created_at?: string
          description?: string | null
          equipment_id: string
          id?: string
          maintenance_type: string
          notes?: string | null
          performed_by?: string | null
          scheduled_date?: string | null
        }
        Update: {
          completed_date?: string | null
          cost?: number | null
          created_at?: string
          description?: string | null
          equipment_id?: string
          id?: string
          maintenance_type?: string
          notes?: string | null
          performed_by?: string | null
          scheduled_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_maintenance_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          branch_id: string | null
          browser_info: string | null
          component_name: string | null
          context: Json | null
          created_at: string | null
          error_message: string
          fingerprint: string | null
          first_seen: string
          function_name: string | null
          id: string
          last_seen: string
          occurrence_count: number
          release_sha: string | null
          request_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          route: string | null
          severity: string
          source: string | null
          stack_trace: string | null
          status: string
          table_name: string | null
          user_id: string | null
        }
        Insert: {
          branch_id?: string | null
          browser_info?: string | null
          component_name?: string | null
          context?: Json | null
          created_at?: string | null
          error_message: string
          fingerprint?: string | null
          first_seen?: string
          function_name?: string | null
          id?: string
          last_seen?: string
          occurrence_count?: number
          release_sha?: string | null
          request_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          route?: string | null
          severity?: string
          source?: string | null
          stack_trace?: string | null
          status?: string
          table_name?: string | null
          user_id?: string | null
        }
        Update: {
          branch_id?: string | null
          browser_info?: string | null
          component_name?: string | null
          context?: Json | null
          created_at?: string | null
          error_message?: string
          fingerprint?: string | null
          first_seen?: string
          function_name?: string | null
          id?: string
          last_seen?: string
          occurrence_count?: number
          release_sha?: string | null
          request_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          route?: string | null
          severity?: string
          source?: string | null
          stack_trace?: string | null
          status?: string
          table_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      expense_category_templates: {
        Row: {
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          type: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          type: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          type?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          branch_id: string
          category_id: string | null
          created_at: string
          description: string
          expense_date: string
          id: string
          receipt_url: string | null
          status: Database["public"]["Enums"]["approval_status"]
          submitted_by: string | null
          vendor: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          branch_id: string
          category_id?: string | null
          created_at?: string
          description: string
          expense_date?: string
          id?: string
          receipt_url?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          submitted_by?: string | null
          vendor?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string
          category_id?: string | null
          created_at?: string
          description?: string
          expense_date?: string
          id?: string
          receipt_url?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          submitted_by?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          available_days: string[] | null
          benefit_type_id: string
          branch_id: string
          capacity: number
          created_at: string | null
          description: string | null
          gender_access: string
          id: string
          is_active: boolean | null
          name: string
          under_maintenance: boolean | null
          updated_at: string | null
        }
        Insert: {
          available_days?: string[] | null
          benefit_type_id: string
          branch_id: string
          capacity?: number
          created_at?: string | null
          description?: string | null
          gender_access?: string
          id?: string
          is_active?: boolean | null
          name: string
          under_maintenance?: boolean | null
          updated_at?: string | null
        }
        Update: {
          available_days?: string[] | null
          benefit_type_id?: string
          branch_id?: string
          capacity?: number
          created_at?: string | null
          description?: string | null
          gender_access?: string
          id?: string
          is_active?: boolean | null
          name?: string
          under_maintenance?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilities_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          admin_notes: string | null
          branch_id: string
          category: string | null
          consent_for_testimonial: boolean | null
          consent_for_testimonial_at: string | null
          created_at: string | null
          employee_id: string | null
          feedback_text: string | null
          google_review_id: string | null
          google_review_link_clicked_at: string | null
          google_review_matched_at: string | null
          google_review_reply_at: string | null
          google_review_reply_status: string | null
          google_review_request_channel: string | null
          google_review_request_message_id: string | null
          google_review_request_status: string | null
          google_review_requested_at: string | null
          id: string
          is_approved_for_google: boolean | null
          member_id: string
          published_to_google_at: string | null
          rating: number
          recovery_task_id: string | null
          status: string | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          branch_id: string
          category?: string | null
          consent_for_testimonial?: boolean | null
          consent_for_testimonial_at?: string | null
          created_at?: string | null
          employee_id?: string | null
          feedback_text?: string | null
          google_review_id?: string | null
          google_review_link_clicked_at?: string | null
          google_review_matched_at?: string | null
          google_review_reply_at?: string | null
          google_review_reply_status?: string | null
          google_review_request_channel?: string | null
          google_review_request_message_id?: string | null
          google_review_request_status?: string | null
          google_review_requested_at?: string | null
          id?: string
          is_approved_for_google?: boolean | null
          member_id: string
          published_to_google_at?: string | null
          rating: number
          recovery_task_id?: string | null
          status?: string | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          branch_id?: string
          category?: string | null
          consent_for_testimonial?: boolean | null
          consent_for_testimonial_at?: string | null
          created_at?: string | null
          employee_id?: string | null
          feedback_text?: string | null
          google_review_id?: string | null
          google_review_link_clicked_at?: string | null
          google_review_matched_at?: string | null
          google_review_reply_at?: string | null
          google_review_reply_status?: string | null
          google_review_request_channel?: string | null
          google_review_request_message_id?: string | null
          google_review_request_status?: string | null
          google_review_requested_at?: string | null
          id?: string
          is_approved_for_google?: boolean | null
          member_id?: string
          published_to_google_at?: string | null
          rating?: number
          recovery_task_id?: string | null
          status?: string | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_google_review_request_message_id_fkey"
            columns: ["google_review_request_message_id"]
            isOneToOne: false
            referencedRelation: "communication_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_recovery_task_id_fkey"
            columns: ["recovery_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_google_link_clicks: {
        Row: {
          branch_id: string | null
          clicked_at: string
          feedback_id: string
          id: string
          ip_hash: string | null
          user_agent: string | null
        }
        Insert: {
          branch_id?: string | null
          clicked_at?: string
          feedback_id: string
          id?: string
          ip_hash?: string | null
          user_agent?: string | null
        }
        Update: {
          branch_id?: string | null
          clicked_at?: string
          feedback_id?: string
          id?: string
          ip_hash?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_google_link_clicks_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_google_link_clicks_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      fitness_plan_templates: {
        Row: {
          branch_id: string | null
          content: Json
          created_at: string | null
          created_by: string | null
          days_per_week: number | null
          description: string | null
          difficulty: string | null
          duration_weeks: number | null
          goal: string | null
          id: string
          is_active: boolean | null
          is_common: boolean
          is_public: boolean | null
          name: string
          pdf_filename: string | null
          pdf_size_bytes: number | null
          pdf_url: string | null
          source_kind: string
          system_template: boolean
          target_age_max: number | null
          target_age_min: number | null
          target_bmi_max: number | null
          target_bmi_min: number | null
          target_experience: string[]
          target_gender: string
          target_goal: string | null
          target_weight_max_kg: number | null
          target_weight_min_kg: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          content?: Json
          created_at?: string | null
          created_by?: string | null
          days_per_week?: number | null
          description?: string | null
          difficulty?: string | null
          duration_weeks?: number | null
          goal?: string | null
          id?: string
          is_active?: boolean | null
          is_common?: boolean
          is_public?: boolean | null
          name: string
          pdf_filename?: string | null
          pdf_size_bytes?: number | null
          pdf_url?: string | null
          source_kind?: string
          system_template?: boolean
          target_age_max?: number | null
          target_age_min?: number | null
          target_bmi_max?: number | null
          target_bmi_min?: number | null
          target_experience?: string[]
          target_gender?: string
          target_goal?: string | null
          target_weight_max_kg?: number | null
          target_weight_min_kg?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          content?: Json
          created_at?: string | null
          created_by?: string | null
          days_per_week?: number | null
          description?: string | null
          difficulty?: string | null
          duration_weeks?: number | null
          goal?: string | null
          id?: string
          is_active?: boolean | null
          is_common?: boolean
          is_public?: boolean | null
          name?: string
          pdf_filename?: string | null
          pdf_size_bytes?: number | null
          pdf_url?: string | null
          source_kind?: string
          system_template?: boolean
          target_age_max?: number | null
          target_age_min?: number | null
          target_bmi_max?: number | null
          target_bmi_min?: number | null
          target_experience?: string[]
          target_gender?: string
          target_goal?: string | null
          target_weight_max_kg?: number | null
          target_weight_min_kg?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fitness_plan_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_activities: {
        Row: {
          action_taken: string
          branch_id: string
          created_at: string | null
          created_by: string | null
          id: string
          next_follow_up_date: string | null
          notes: string | null
          reference_id: string
          reference_type: string
        }
        Insert: {
          action_taken: string
          branch_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          next_follow_up_date?: string | null
          notes?: string | null
          reference_id: string
          reference_type: string
        }
        Update: {
          action_taken?: string
          branch_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          next_follow_up_date?: string | null
          notes?: string | null
          reference_id?: string
          reference_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_activities_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      google_reviews: {
        Row: {
          branch_id: string
          comment: string | null
          created_at: string
          fetched_at: string
          google_created_at: string | null
          google_review_id: string
          id: string
          matched_feedback_id: string | null
          rating: number | null
          replied_at: string | null
          reply_text: string | null
          reviewer_name: string | null
          reviewer_photo_url: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          comment?: string | null
          created_at?: string
          fetched_at?: string
          google_created_at?: string | null
          google_review_id: string
          id?: string
          matched_feedback_id?: string | null
          rating?: number | null
          replied_at?: string | null
          reply_text?: string | null
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          comment?: string | null
          created_at?: string
          fetched_at?: string
          google_created_at?: string | null
          google_review_id?: string
          id?: string
          matched_feedback_id?: string | null
          rating?: number | null
          replied_at?: string | null
          reply_text?: string | null
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_reviews_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_reviews_matched_feedback_id_fkey"
            columns: ["matched_feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      google_reviews_inbound: {
        Row: {
          ai_classification: string | null
          ai_classified_at: string | null
          ai_draft_reply: string | null
          ai_reasoning: string | null
          author_name: string | null
          author_photo_url: string | null
          branch_id: string
          created_at: string
          google_reply_text: string | null
          google_reply_updated_at: string | null
          google_review_id: string
          id: string
          language: string | null
          match_confidence: number | null
          match_evidence: Json | null
          match_type: string | null
          matched_lead_id: string | null
          matched_member_id: string | null
          posted_at: string | null
          rating: number | null
          raw: Json | null
          replied_at: string | null
          replied_by: string | null
          reply_status: string | null
          reply_text: string | null
          reported_to_google_at: string | null
          review_text: string | null
          updated_at: string
        }
        Insert: {
          ai_classification?: string | null
          ai_classified_at?: string | null
          ai_draft_reply?: string | null
          ai_reasoning?: string | null
          author_name?: string | null
          author_photo_url?: string | null
          branch_id: string
          created_at?: string
          google_reply_text?: string | null
          google_reply_updated_at?: string | null
          google_review_id: string
          id?: string
          language?: string | null
          match_confidence?: number | null
          match_evidence?: Json | null
          match_type?: string | null
          matched_lead_id?: string | null
          matched_member_id?: string | null
          posted_at?: string | null
          rating?: number | null
          raw?: Json | null
          replied_at?: string | null
          replied_by?: string | null
          reply_status?: string | null
          reply_text?: string | null
          reported_to_google_at?: string | null
          review_text?: string | null
          updated_at?: string
        }
        Update: {
          ai_classification?: string | null
          ai_classified_at?: string | null
          ai_draft_reply?: string | null
          ai_reasoning?: string | null
          author_name?: string | null
          author_photo_url?: string | null
          branch_id?: string
          created_at?: string
          google_reply_text?: string | null
          google_reply_updated_at?: string | null
          google_review_id?: string
          id?: string
          language?: string | null
          match_confidence?: number | null
          match_evidence?: Json | null
          match_type?: string | null
          matched_lead_id?: string | null
          matched_member_id?: string | null
          posted_at?: string | null
          rating?: number | null
          raw?: Json | null
          replied_at?: string | null
          replied_by?: string | null
          reply_status?: string | null
          reply_text?: string | null
          reported_to_google_at?: string | null
          review_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_reviews_inbound_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_reviews_inbound_matched_lead_id_fkey"
            columns: ["matched_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_reviews_inbound_matched_member_id_fkey"
            columns: ["matched_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      hardware_access_events: {
        Row: {
          actor_user_id: string | null
          branch_id: string
          created_at: string
          id: string
          member_id: string
          metadata: Json
          new_status: string
          previous_status: string | null
          reason: string | null
          requires_sync: boolean
        }
        Insert: {
          actor_user_id?: string | null
          branch_id: string
          created_at?: string
          id?: string
          member_id: string
          metadata?: Json
          new_status: string
          previous_status?: string | null
          reason?: string | null
          requires_sync?: boolean
        }
        Update: {
          actor_user_id?: string | null
          branch_id?: string
          created_at?: string
          id?: string
          member_id?: string
          metadata?: Json
          new_status?: string
          previous_status?: string | null
          reason?: string | null
          requires_sync?: boolean
        }
        Relationships: []
      }
      hardware_devices: {
        Row: {
          branch_id: string | null
          created_at: string
          device_key: string | null
          device_sn: string
          id: string
          ip_address: string | null
          last_online: string | null
          last_payload: Json | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          device_key?: string | null
          device_sn: string
          id?: string
          ip_address?: string | null
          last_online?: string | null
          last_payload?: Json | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          device_key?: string | null
          device_sn?: string
          id?: string
          ip_address?: string | null
          last_online?: string | null
          last_payload?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hardware_devices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          branch_id: string | null
          created_at: string
          holiday_date: string
          id: string
          is_paid: boolean
          name: string
          pay_multiplier: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          holiday_date: string
          id?: string
          is_paid?: boolean
          name: string
          pay_multiplier?: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          holiday_date?: string
          id?: string
          is_paid?: boolean
          name?: string
          pay_multiplier?: number
        }
        Relationships: [
          {
            foreignKeyName: "holidays_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      howbody_body_reports: {
        Row: {
          bmi: number | null
          bmr: number | null
          created_at: string
          data_key: string
          ecf: number | null
          equipment_no: string | null
          fat: number | null
          fat_control: number | null
          full_payload: Json
          health_score: number | null
          icf: number | null
          id: string
          member_id: string | null
          metabolic_age: number | null
          muscle_control: number | null
          pbf: number | null
          pr: number | null
          scan_id: string | null
          smm: number | null
          target_weight: number | null
          tbw: number | null
          test_time: string | null
          vfr: number | null
          weight: number | null
          weight_control: number | null
          whr: number | null
        }
        Insert: {
          bmi?: number | null
          bmr?: number | null
          created_at?: string
          data_key: string
          ecf?: number | null
          equipment_no?: string | null
          fat?: number | null
          fat_control?: number | null
          full_payload: Json
          health_score?: number | null
          icf?: number | null
          id?: string
          member_id?: string | null
          metabolic_age?: number | null
          muscle_control?: number | null
          pbf?: number | null
          pr?: number | null
          scan_id?: string | null
          smm?: number | null
          target_weight?: number | null
          tbw?: number | null
          test_time?: string | null
          vfr?: number | null
          weight?: number | null
          weight_control?: number | null
          whr?: number | null
        }
        Update: {
          bmi?: number | null
          bmr?: number | null
          created_at?: string
          data_key?: string
          ecf?: number | null
          equipment_no?: string | null
          fat?: number | null
          fat_control?: number | null
          full_payload?: Json
          health_score?: number | null
          icf?: number | null
          id?: string
          member_id?: string | null
          metabolic_age?: number | null
          muscle_control?: number | null
          pbf?: number | null
          pr?: number | null
          scan_id?: string | null
          smm?: number | null
          target_weight?: number | null
          tbw?: number | null
          test_time?: string | null
          vfr?: number | null
          weight?: number | null
          weight_control?: number | null
          whr?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "howbody_body_reports_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      howbody_devices: {
        Row: {
          auto_registered: boolean
          branch_id: string | null
          created_at: string
          equipment_no: string
          id: string
          is_active: boolean
          label: string | null
          last_seen_at: string | null
          location: string | null
          notes: string | null
          total_scans: number
          updated_at: string
        }
        Insert: {
          auto_registered?: boolean
          branch_id?: string | null
          created_at?: string
          equipment_no: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_seen_at?: string | null
          location?: string | null
          notes?: string | null
          total_scans?: number
          updated_at?: string
        }
        Update: {
          auto_registered?: boolean
          branch_id?: string | null
          created_at?: string
          equipment_no?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_seen_at?: string | null
          location?: string | null
          notes?: string | null
          total_scans?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "howbody_devices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      howbody_posture_reports: {
        Row: {
          back_img: string | null
          body_slope: number | null
          bust: number | null
          calf_left: number | null
          calf_right: number | null
          created_at: string
          data_key: string
          equipment_no: string | null
          front_img: string | null
          full_payload: Json
          head_forward: number | null
          head_slant: number | null
          high_low_shoulder: number | null
          hip: number | null
          id: string
          knee_left: number | null
          knee_right: number | null
          left_img: string | null
          left_thigh: number | null
          leg_left: number | null
          leg_right: number | null
          member_id: string | null
          model_url: string | null
          pelvis_forward: number | null
          right_img: string | null
          right_thigh: number | null
          scan_id: string | null
          score: number | null
          shoulder_back: number | null
          shoulder_left: number | null
          shoulder_right: number | null
          test_time: string | null
          up_arm_left: number | null
          up_arm_right: number | null
          waist: number | null
        }
        Insert: {
          back_img?: string | null
          body_slope?: number | null
          bust?: number | null
          calf_left?: number | null
          calf_right?: number | null
          created_at?: string
          data_key: string
          equipment_no?: string | null
          front_img?: string | null
          full_payload: Json
          head_forward?: number | null
          head_slant?: number | null
          high_low_shoulder?: number | null
          hip?: number | null
          id?: string
          knee_left?: number | null
          knee_right?: number | null
          left_img?: string | null
          left_thigh?: number | null
          leg_left?: number | null
          leg_right?: number | null
          member_id?: string | null
          model_url?: string | null
          pelvis_forward?: number | null
          right_img?: string | null
          right_thigh?: number | null
          scan_id?: string | null
          score?: number | null
          shoulder_back?: number | null
          shoulder_left?: number | null
          shoulder_right?: number | null
          test_time?: string | null
          up_arm_left?: number | null
          up_arm_right?: number | null
          waist?: number | null
        }
        Update: {
          back_img?: string | null
          body_slope?: number | null
          bust?: number | null
          calf_left?: number | null
          calf_right?: number | null
          created_at?: string
          data_key?: string
          equipment_no?: string | null
          front_img?: string | null
          full_payload?: Json
          head_forward?: number | null
          head_slant?: number | null
          high_low_shoulder?: number | null
          hip?: number | null
          id?: string
          knee_left?: number | null
          knee_right?: number | null
          left_img?: string | null
          left_thigh?: number | null
          leg_left?: number | null
          leg_right?: number | null
          member_id?: string | null
          model_url?: string | null
          pelvis_forward?: number | null
          right_img?: string | null
          right_thigh?: number | null
          scan_id?: string | null
          score?: number | null
          shoulder_back?: number | null
          shoulder_left?: number | null
          shoulder_right?: number | null
          test_time?: string | null
          up_arm_left?: number | null
          up_arm_right?: number | null
          waist?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "howbody_posture_reports_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      howbody_public_report_tokens: {
        Row: {
          created_at: string
          data_key: string
          expires_at: string | null
          id: string
          report_type: string
          token: string
        }
        Insert: {
          created_at?: string
          data_key: string
          expires_at?: string | null
          id?: string
          report_type: string
          token: string
        }
        Update: {
          created_at?: string
          data_key?: string
          expires_at?: string | null
          id?: string
          report_type?: string
          token?: string
        }
        Relationships: []
      }
      howbody_scan_sessions: {
        Row: {
          bound_at: string | null
          completed_at: string | null
          created_at: string
          equipment_no: string
          id: string
          member_id: string | null
          scan_id: string
          status: string
        }
        Insert: {
          bound_at?: string | null
          completed_at?: string | null
          created_at?: string
          equipment_no: string
          id?: string
          member_id?: string | null
          scan_id: string
          status?: string
        }
        Update: {
          bound_at?: string | null
          completed_at?: string | null
          created_at?: string
          equipment_no?: string
          id?: string
          member_id?: string | null
          scan_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "howbody_scan_sessions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      howbody_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          token: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
        }
        Relationships: []
      }
      howbody_webhook_log: {
        Row: {
          created_at: string
          data_key: string | null
          endpoint: string
          id: string
          message: string | null
          raw_payload: Json | null
          status_code: number | null
          third_uid: string | null
        }
        Insert: {
          created_at?: string
          data_key?: string | null
          endpoint: string
          id?: string
          message?: string | null
          raw_payload?: Json | null
          status_code?: number | null
          third_uid?: string | null
        }
        Update: {
          created_at?: string
          data_key?: string | null
          endpoint?: string
          id?: string
          message?: string | null
          raw_payload?: Json | null
          status_code?: number | null
          third_uid?: string | null
        }
        Relationships: []
      }
      income_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          branch_id: string | null
          config: Json | null
          created_at: string | null
          credentials: Json | null
          id: string
          integration_type: string
          is_active: boolean | null
          provider: string
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          config?: Json | null
          created_at?: string | null
          credentials?: Json | null
          id?: string
          integration_type: string
          is_active?: boolean | null
          provider: string
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          config?: Json | null
          created_at?: string | null
          credentials?: Json | null
          id?: string
          integration_type?: string
          is_active?: boolean | null
          provider?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          last_restocked_at: string | null
          min_quantity: number | null
          product_id: string
          quantity: number | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          last_restocked_at?: string | null
          min_quantity?: number | null
          product_id: string
          quantity?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          last_restocked_at?: string | null
          min_quantity?: number | null
          product_id?: string
          quantity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          hsn_code: string | null
          id: string
          invoice_id: string
          quantity: number | null
          reference_id: string | null
          reference_type: string | null
          tax_amount: number | null
          tax_rate: number | null
          total_amount: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          hsn_code?: string | null
          id?: string
          invoice_id: string
          quantity?: number | null
          reference_id?: string | null
          reference_type?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          total_amount: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          hsn_code?: string | null
          id?: string
          invoice_id?: string
          quantity?: number | null
          reference_id?: string | null
          reference_type?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_counters: {
        Row: {
          branch_id: string
          last_seq: number
          updated_at: string
          year_yy: string
        }
        Insert: {
          branch_id: string
          last_seq?: number
          updated_at?: string
          year_yy: string
        }
        Update: {
          branch_id?: string
          last_seq?: number
          updated_at?: string
          year_yy?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_paid: number | null
          branch_id: string
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_gstin: string | null
          customer_name: string | null
          customer_phone: string | null
          discount_amount: number | null
          due_date: string | null
          gst_rate: number | null
          id: string
          invoice_number: string | null
          invoice_type: string | null
          is_gst_invoice: boolean | null
          member_id: string | null
          next_reminder_at: string | null
          notes: string | null
          payment_due_date: string | null
          pos_sale_id: string | null
          refund_amount: number | null
          refund_reason: string | null
          refunded_at: string | null
          refunded_by: string | null
          reminder_sent_at: string | null
          source: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_amount: number | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number | null
          branch_id: string
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_gstin?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number | null
          due_date?: string | null
          gst_rate?: number | null
          id?: string
          invoice_number?: string | null
          invoice_type?: string | null
          is_gst_invoice?: boolean | null
          member_id?: string | null
          next_reminder_at?: string | null
          notes?: string | null
          payment_due_date?: string | null
          pos_sale_id?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          reminder_sent_at?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_amount?: number | null
          total_amount: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number | null
          branch_id?: string
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_gstin?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number | null
          due_date?: string | null
          gst_rate?: number | null
          id?: string
          invoice_number?: string | null
          invoice_type?: string | null
          is_gst_invoice?: boolean | null
          member_id?: string | null
          next_reminder_at?: string | null
          notes?: string | null
          payment_due_date?: string | null
          pos_sale_id?: string | null
          refund_amount?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          reminder_sent_at?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          activity_type: string
          actor_id: string | null
          branch_id: string
          created_at: string
          id: string
          lead_id: string
          metadata: Json | null
          notes: string | null
          title: string | null
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          branch_id: string
          created_at?: string
          id?: string
          lead_id: string
          metadata?: Json | null
          notes?: string | null
          title?: string | null
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          branch_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          metadata?: Json | null
          notes?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "lead_activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_followups: {
        Row: {
          created_at: string
          followup_date: string
          id: string
          lead_id: string
          next_followup_date: string | null
          notes: string | null
          outcome: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          followup_date: string
          id?: string
          lead_id: string
          next_followup_date?: string | null
          notes?: string | null
          outcome?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          followup_date?: string
          id?: string
          lead_id?: string
          next_followup_date?: string | null
          notes?: string | null
          outcome?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notification_admin_prefs: {
        Row: {
          sms_enabled: boolean
          updated_at: string
          user_id: string
          whatsapp_enabled: boolean
        }
        Insert: {
          sms_enabled?: boolean
          updated_at?: string
          user_id: string
          whatsapp_enabled?: boolean
        }
        Update: {
          sms_enabled?: boolean
          updated_at?: string
          user_id?: string
          whatsapp_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lead_notification_admin_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "lead_notification_admin_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notification_rules: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          lead_welcome_sms: string
          lead_welcome_whatsapp: string
          sms_to_admins: boolean
          sms_to_lead: boolean
          sms_to_managers: boolean
          team_alert_sms: string
          team_alert_whatsapp: string
          updated_at: string
          whatsapp_to_admins: boolean
          whatsapp_to_lead: boolean
          whatsapp_to_managers: boolean
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          lead_welcome_sms?: string
          lead_welcome_whatsapp?: string
          sms_to_admins?: boolean
          sms_to_lead?: boolean
          sms_to_managers?: boolean
          team_alert_sms?: string
          team_alert_whatsapp?: string
          updated_at?: string
          whatsapp_to_admins?: boolean
          whatsapp_to_lead?: boolean
          whatsapp_to_managers?: boolean
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          lead_welcome_sms?: string
          lead_welcome_whatsapp?: string
          sms_to_admins?: boolean
          sms_to_lead?: boolean
          sms_to_managers?: boolean
          team_alert_sms?: string
          team_alert_whatsapp?: string
          updated_at?: string
          whatsapp_to_admins?: boolean
          whatsapp_to_lead?: boolean
          whatsapp_to_managers?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lead_notification_rules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ad_id: string | null
          assigned_to: string | null
          bot_active: boolean
          branch_id: string
          budget: string | null
          campaign_name: string | null
          conversion_idempotency_key: string | null
          converted_at: string | null
          converted_member_id: string | null
          created_at: string
          date_of_birth: string | null
          duplicate_of: string | null
          email: string | null
          expected_start_date: string | null
          first_response_at: string | null
          fitness_experience: string | null
          fitness_goal: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"] | null
          goals: string | null
          id: string
          interested_plan_id: string | null
          landing_page: string | null
          last_contacted_at: string | null
          lost_reason: string | null
          merged_into: string | null
          next_action_at: string | null
          notes: string | null
          notified_at: string | null
          owner_id: string | null
          phone: string
          plan_interest: string | null
          preferred_contact_channel: string
          preferred_time: string | null
          referrer_url: string | null
          score: number
          sla_due_at: string | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          tags: string[]
          temperature: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          won_at: string | null
        }
        Insert: {
          ad_id?: string | null
          assigned_to?: string | null
          bot_active?: boolean
          branch_id: string
          budget?: string | null
          campaign_name?: string | null
          conversion_idempotency_key?: string | null
          converted_at?: string | null
          converted_member_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          duplicate_of?: string | null
          email?: string | null
          expected_start_date?: string | null
          first_response_at?: string | null
          fitness_experience?: string | null
          fitness_goal?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          goals?: string | null
          id?: string
          interested_plan_id?: string | null
          landing_page?: string | null
          last_contacted_at?: string | null
          lost_reason?: string | null
          merged_into?: string | null
          next_action_at?: string | null
          notes?: string | null
          notified_at?: string | null
          owner_id?: string | null
          phone: string
          plan_interest?: string | null
          preferred_contact_channel?: string
          preferred_time?: string | null
          referrer_url?: string | null
          score?: number
          sla_due_at?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          tags?: string[]
          temperature?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          won_at?: string | null
        }
        Update: {
          ad_id?: string | null
          assigned_to?: string | null
          bot_active?: boolean
          branch_id?: string
          budget?: string | null
          campaign_name?: string | null
          conversion_idempotency_key?: string | null
          converted_at?: string | null
          converted_member_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          duplicate_of?: string | null
          email?: string | null
          expected_start_date?: string | null
          first_response_at?: string | null
          fitness_experience?: string | null
          fitness_goal?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          goals?: string | null
          id?: string
          interested_plan_id?: string | null
          landing_page?: string | null
          last_contacted_at?: string | null
          lost_reason?: string | null
          merged_into?: string | null
          next_action_at?: string | null
          notes?: string | null
          notified_at?: string | null
          owner_id?: string | null
          phone?: string
          plan_interest?: string | null
          preferred_contact_channel?: string
          preferred_time?: string | null
          referrer_url?: string | null
          score?: number
          sla_due_at?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          tags?: string[]
          temperature?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          end_date: string
          id: string
          leave_type: string
          reason: string | null
          start_date: string
          status: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          end_date: string
          id?: string
          leave_type: string
          reason?: string | null
          start_date: string
          status?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          start_date?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      locker_assignments: {
        Row: {
          created_at: string
          end_date: string | null
          fee_amount: number | null
          id: string
          is_active: boolean | null
          locker_id: string
          member_id: string
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          fee_amount?: number | null
          id?: string
          is_active?: boolean | null
          locker_id: string
          member_id: string
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          fee_amount?: number | null
          id?: string
          is_active?: boolean | null
          locker_id?: string
          member_id?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locker_assignments_locker_id_fkey"
            columns: ["locker_id"]
            isOneToOne: false
            referencedRelation: "lockers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locker_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      lockers: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          locker_number: string
          monthly_fee: number | null
          notes: string | null
          size: string | null
          status: Database["public"]["Enums"]["locker_status"]
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          locker_number: string
          monthly_fee?: number | null
          notes?: string | null
          size?: string | null
          status?: Database["public"]["Enums"]["locker_status"]
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          locker_number?: string
          monthly_fee?: number | null
          notes?: string | null
          size?: string | null
          status?: Database["public"]["Enums"]["locker_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lockers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_catalog: {
        Row: {
          branch_id: string | null
          calories: number
          carbs: number
          created_at: string
          created_by: string | null
          cuisine: string
          default_quantity: string | null
          dietary_type: string
          fats: number
          fiber: number
          id: string
          is_active: boolean
          meal_type: string
          name: string
          notes: string | null
          protein: number
          tags: string[]
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          calories?: number
          carbs?: number
          created_at?: string
          created_by?: string | null
          cuisine: string
          default_quantity?: string | null
          dietary_type: string
          fats?: number
          fiber?: number
          id?: string
          is_active?: boolean
          meal_type: string
          name: string
          notes?: string | null
          protein?: number
          tags?: string[]
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          calories?: number
          carbs?: number
          created_at?: string
          created_by?: string | null
          cuisine?: string
          default_quantity?: string | null
          dietary_type?: string
          fats?: number
          fiber?: number
          id?: string
          is_active?: boolean
          meal_type?: string
          name?: string
          notes?: string | null
          protein?: number
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_catalog_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      member_attendance: {
        Row: {
          branch_id: string
          check_in: string
          check_in_method: string | null
          check_out: string | null
          created_at: string
          force_entry: boolean | null
          force_entry_by: string | null
          force_entry_reason: string | null
          id: string
          member_id: string
          membership_id: string | null
          notes: string | null
        }
        Insert: {
          branch_id: string
          check_in?: string
          check_in_method?: string | null
          check_out?: string | null
          created_at?: string
          force_entry?: boolean | null
          force_entry_by?: string | null
          force_entry_reason?: string | null
          id?: string
          member_id: string
          membership_id?: string | null
          notes?: string | null
        }
        Update: {
          branch_id?: string
          check_in?: string
          check_in_method?: string | null
          check_out?: string | null
          created_at?: string
          force_entry?: boolean | null
          force_entry_by?: string | null
          force_entry_reason?: string | null
          id?: string
          member_id?: string
          membership_id?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_attendance_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_attendance_force_entry_by_fkey"
            columns: ["force_entry_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "member_attendance_force_entry_by_fkey"
            columns: ["force_entry_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_attendance_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      member_benefit_credits: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id: string | null
          created_at: string
          credits_remaining: number
          credits_total: number
          expires_at: string
          id: string
          invoice_id: string | null
          member_id: string
          membership_id: string | null
          package_id: string | null
          purchased_at: string
          updated_at: string
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          created_at?: string
          credits_remaining: number
          credits_total: number
          expires_at: string
          id?: string
          invoice_id?: string | null
          member_id: string
          membership_id?: string | null
          package_id?: string | null
          purchased_at?: string
          updated_at?: string
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          created_at?: string
          credits_remaining?: number
          credits_total?: number
          expires_at?: string
          id?: string
          invoice_id?: string | null
          member_id?: string
          membership_id?: string | null
          package_id?: string | null
          purchased_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_benefit_credits_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_benefit_credits_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_benefit_credits_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_benefit_credits_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_benefit_credits_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "benefit_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      member_branch_history: {
        Row: {
          approved_by: string | null
          created_at: string
          from_branch_id: string | null
          id: string
          member_id: string
          reason: string | null
          to_branch_id: string
          transfer_date: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          from_branch_id?: string | null
          id?: string
          member_id: string
          reason?: string | null
          to_branch_id: string
          transfer_date?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          from_branch_id?: string | null
          id?: string
          member_id?: string
          reason?: string | null
          to_branch_id?: string
          transfer_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_branch_history_from_branch_id_fkey"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_branch_history_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_branch_history_to_branch_id_fkey"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      member_code_counters: {
        Row: {
          branch_id: string
          last_seq: number
          updated_at: string
          year_yy: string
        }
        Insert: {
          branch_id: string
          last_seq?: number
          updated_at?: string
          year_yy: string
        }
        Update: {
          branch_id?: string
          last_seq?: number
          updated_at?: string
          year_yy?: string
        }
        Relationships: []
      }
      member_communication_preferences: {
        Row: {
          announcements: boolean
          branch_id: string
          class_notifications: boolean
          created_at: string
          email_enabled: boolean
          id: string
          marketing: boolean
          member_id: string
          membership_reminders: boolean
          payment_receipts: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          retention_nudges: boolean
          review_requests: boolean
          sms_enabled: boolean
          timezone: string
          updated_at: string
          whatsapp_enabled: boolean
        }
        Insert: {
          announcements?: boolean
          branch_id: string
          class_notifications?: boolean
          created_at?: string
          email_enabled?: boolean
          id?: string
          marketing?: boolean
          member_id: string
          membership_reminders?: boolean
          payment_receipts?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          retention_nudges?: boolean
          review_requests?: boolean
          sms_enabled?: boolean
          timezone?: string
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Update: {
          announcements?: boolean
          branch_id?: string
          class_notifications?: boolean
          created_at?: string
          email_enabled?: boolean
          id?: string
          marketing?: boolean
          member_id?: string
          membership_reminders?: boolean
          payment_receipts?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          retention_nudges?: boolean
          review_requests?: boolean
          sms_enabled?: boolean
          timezone?: string
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "member_communication_preferences_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_communication_preferences_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_comps: {
        Row: {
          benefit_type_id: string
          comp_sessions: number
          created_at: string
          granted_by: string | null
          id: string
          member_id: string
          membership_id: string | null
          reason: string | null
          used_sessions: number
        }
        Insert: {
          benefit_type_id: string
          comp_sessions?: number
          created_at?: string
          granted_by?: string | null
          id?: string
          member_id: string
          membership_id?: string | null
          reason?: string | null
          used_sessions?: number
        }
        Update: {
          benefit_type_id?: string
          comp_sessions?: number
          created_at?: string
          granted_by?: string | null
          id?: string
          member_id?: string
          membership_id?: string | null
          reason?: string | null
          used_sessions?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_comps_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_comps_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "member_comps_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_comps_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_comps_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      member_documents: {
        Row: {
          created_at: string
          document_type: string
          file_name: string
          file_url: string
          id: string
          member_id: string
          storage_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          document_type?: string
          file_name: string
          file_url: string
          id?: string
          member_id: string
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          document_type?: string
          file_name?: string
          file_url?: string
          id?: string
          member_id?: string
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_documents_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "member_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_fitness_plans: {
        Row: {
          branch_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_common: boolean
          is_custom: boolean | null
          is_public: boolean | null
          member_id: string | null
          pdf_filename: string | null
          pdf_size_bytes: number | null
          pdf_url: string | null
          plan_data: Json
          plan_name: string
          plan_type: string
          source_kind: string
          template_id: string | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_common?: boolean
          is_custom?: boolean | null
          is_public?: boolean | null
          member_id?: string | null
          pdf_filename?: string | null
          pdf_size_bytes?: number | null
          pdf_url?: string | null
          plan_data?: Json
          plan_name: string
          plan_type: string
          source_kind?: string
          template_id?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_common?: boolean
          is_custom?: boolean | null
          is_public?: boolean | null
          member_id?: string | null
          pdf_filename?: string | null
          pdf_size_bytes?: number | null
          pdf_url?: string | null
          plan_data?: Json
          plan_name?: string
          plan_type?: string
          source_kind?: string
          template_id?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_fitness_plans_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_fitness_plans_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_group_members: {
        Row: {
          added_at: string
          group_id: string
          id: string
          member_id: string
          role: string | null
        }
        Insert: {
          added_at?: string
          group_id: string
          id?: string
          member_id: string
          role?: string | null
        }
        Update: {
          added_at?: string
          group_id?: string
          id?: string
          member_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "member_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_groups: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          discount_type: string
          discount_value: number
          group_name: string
          group_type: string
          id: string
          is_active: boolean
          notes: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          discount_type?: string
          discount_value?: number
          group_name: string
          group_type?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          discount_type?: string
          discount_value?: number
          group_name?: string
          group_type?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_groups_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      member_lifecycle_events: {
        Row: {
          actor_user_id: string | null
          branch_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          idempotency_key: string | null
          member_id: string
          metadata: Json
          new_state: string | null
          previous_state: string | null
          reason: string | null
          source: string | null
        }
        Insert: {
          actor_user_id?: string | null
          branch_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          member_id: string
          metadata?: Json
          new_state?: string | null
          previous_state?: string | null
          reason?: string | null
          source?: string | null
        }
        Update: {
          actor_user_id?: string | null
          branch_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          member_id?: string
          metadata?: Json
          new_state?: string | null
          previous_state?: string | null
          reason?: string | null
          source?: string | null
        }
        Relationships: []
      }
      member_lifecycle_transitions: {
        Row: {
          actor_id: string | null
          created_at: string
          from_state: string | null
          id: string
          member_id: string
          reason: string | null
          to_state: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_state?: string | null
          id?: string
          member_id: string
          reason?: string | null
          to_state: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_state?: string | null
          id?: string
          member_id?: string
          reason?: string | null
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_lifecycle_transitions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_meal_completions: {
        Row: {
          completed_at: string
          id: string
          meal_date: string
          meal_index: number
          meal_name: string | null
          member_id: string
          plan_id: string
          plan_source: string
        }
        Insert: {
          completed_at?: string
          id?: string
          meal_date: string
          meal_index: number
          meal_name?: string | null
          member_id: string
          plan_id: string
          plan_source: string
        }
        Update: {
          completed_at?: string
          id?: string
          meal_date?: string
          meal_index?: number
          meal_name?: string | null
          member_id?: string
          plan_id?: string
          plan_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_meal_completions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_meal_swaps: {
        Row: {
          catalog_meal_id: string | null
          id: string
          meal_index: number
          member_id: string
          new_meal: Json
          original_meal: Json | null
          plan_id: string
          plan_source: string
          swapped_at: string
        }
        Insert: {
          catalog_meal_id?: string | null
          id?: string
          meal_index: number
          member_id: string
          new_meal: Json
          original_meal?: Json | null
          plan_id: string
          plan_source: string
          swapped_at?: string
        }
        Update: {
          catalog_meal_id?: string | null
          id?: string
          meal_index?: number
          member_id?: string
          new_meal?: Json
          original_meal?: Json | null
          plan_id?: string
          plan_source?: string
          swapped_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_meal_swaps_catalog_meal_id_fkey"
            columns: ["catalog_meal_id"]
            isOneToOne: false
            referencedRelation: "meal_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_meal_swaps_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_measurements: {
        Row: {
          abdomen_cm: number | null
          ankle_left_cm: number | null
          ankle_right_cm: number | null
          biceps_left_cm: number | null
          biceps_right_cm: number | null
          body_fat_percentage: number | null
          body_shape_profile: string | null
          calves_cm: number | null
          chest_cm: number | null
          created_at: string
          forearm_left_cm: number | null
          forearm_right_cm: number | null
          front_progress_photo_path: string | null
          gender_presentation: string | null
          height_cm: number | null
          hips_cm: number | null
          id: string
          inseam_cm: number | null
          member_id: string
          neck_cm: number | null
          notes: string | null
          photos: Json | null
          posture_type: string | null
          recorded_at: string
          recorded_by: string | null
          shoulder_cm: number | null
          side_progress_photo_path: string | null
          thighs_left_cm: number | null
          thighs_right_cm: number | null
          torso_length_cm: number | null
          updated_at: string
          waist_cm: number | null
          weight_kg: number | null
          wrist_left_cm: number | null
          wrist_right_cm: number | null
        }
        Insert: {
          abdomen_cm?: number | null
          ankle_left_cm?: number | null
          ankle_right_cm?: number | null
          biceps_left_cm?: number | null
          biceps_right_cm?: number | null
          body_fat_percentage?: number | null
          body_shape_profile?: string | null
          calves_cm?: number | null
          chest_cm?: number | null
          created_at?: string
          forearm_left_cm?: number | null
          forearm_right_cm?: number | null
          front_progress_photo_path?: string | null
          gender_presentation?: string | null
          height_cm?: number | null
          hips_cm?: number | null
          id?: string
          inseam_cm?: number | null
          member_id: string
          neck_cm?: number | null
          notes?: string | null
          photos?: Json | null
          posture_type?: string | null
          recorded_at?: string
          recorded_by?: string | null
          shoulder_cm?: number | null
          side_progress_photo_path?: string | null
          thighs_left_cm?: number | null
          thighs_right_cm?: number | null
          torso_length_cm?: number | null
          updated_at?: string
          waist_cm?: number | null
          weight_kg?: number | null
          wrist_left_cm?: number | null
          wrist_right_cm?: number | null
        }
        Update: {
          abdomen_cm?: number | null
          ankle_left_cm?: number | null
          ankle_right_cm?: number | null
          biceps_left_cm?: number | null
          biceps_right_cm?: number | null
          body_fat_percentage?: number | null
          body_shape_profile?: string | null
          calves_cm?: number | null
          chest_cm?: number | null
          created_at?: string
          forearm_left_cm?: number | null
          forearm_right_cm?: number | null
          front_progress_photo_path?: string | null
          gender_presentation?: string | null
          height_cm?: number | null
          hips_cm?: number | null
          id?: string
          inseam_cm?: number | null
          member_id?: string
          neck_cm?: number | null
          notes?: string | null
          photos?: Json | null
          posture_type?: string | null
          recorded_at?: string
          recorded_by?: string | null
          shoulder_cm?: number | null
          side_progress_photo_path?: string | null
          thighs_left_cm?: number | null
          thighs_right_cm?: number | null
          torso_length_cm?: number | null
          updated_at?: string
          waist_cm?: number | null
          weight_kg?: number | null
          wrist_left_cm?: number | null
          wrist_right_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "member_measurements_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_measurements_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "member_measurements_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_onboarding_signatures: {
        Row: {
          consents: Json
          created_at: string
          id: string
          member_id: string
          par_q: Json
          signature_path: string
          signed_at: string
          signer_ip: unknown
          signer_user_agent: string | null
          waiver_pdf_path: string
        }
        Insert: {
          consents?: Json
          created_at?: string
          id?: string
          member_id: string
          par_q?: Json
          signature_path: string
          signed_at?: string
          signer_ip?: unknown
          signer_user_agent?: string | null
          waiver_pdf_path: string
        }
        Update: {
          consents?: Json
          created_at?: string
          id?: string
          member_id?: string
          par_q?: Json
          signature_path?: string
          signed_at?: string
          signer_ip?: unknown
          signer_user_agent?: string | null
          waiver_pdf_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_onboarding_signatures_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_pt_packages: {
        Row: {
          branch_id: string
          created_at: string
          expiry_date: string
          id: string
          member_id: string
          package_id: string
          price_paid: number
          sessions_remaining: number
          sessions_total: number
          sessions_used: number | null
          start_date: string
          status: Database["public"]["Enums"]["pt_package_status"]
          trainer_id: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          expiry_date: string
          id?: string
          member_id: string
          package_id: string
          price_paid: number
          sessions_remaining: number
          sessions_total: number
          sessions_used?: number | null
          start_date: string
          status?: Database["public"]["Enums"]["pt_package_status"]
          trainer_id?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          expiry_date?: string
          id?: string
          member_id?: string
          package_id?: string
          price_paid?: number
          sessions_remaining?: number
          sessions_total?: number
          sessions_used?: number | null
          start_date?: string
          status?: Database["public"]["Enums"]["pt_package_status"]
          trainer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_pt_packages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_pt_packages_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_pt_packages_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "pt_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_pt_packages_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_pt_packages_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      member_workout_completions: {
        Row: {
          completed_at: string
          day_label: string
          exercise_index: number
          exercise_name: string | null
          id: string
          member_id: string
          plan_id: string
          plan_source: string
          week_number: number
        }
        Insert: {
          completed_at?: string
          day_label: string
          exercise_index: number
          exercise_name?: string | null
          id?: string
          member_id: string
          plan_id: string
          plan_source: string
          week_number?: number
        }
        Update: {
          completed_at?: string
          day_label?: string
          exercise_index?: number
          exercise_name?: string | null
          id?: string
          member_id?: string
          plan_id?: string
          plan_source?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_workout_completions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          activity_level: string | null
          allergies: string[]
          assigned_trainer_id: string | null
          avatar_storage_path: string | null
          biometric_enrolled: boolean | null
          biometric_photo_path: string | null
          biometric_photo_url: string | null
          bot_active: boolean
          branch_id: string
          created_at: string
          created_by: string | null
          cuisine_preference: string | null
          custom_welcome_message: string | null
          dietary_preference: string | null
          equipment_availability: string[]
          fitness_goals: string | null
          fitness_level: string | null
          gstin: string | null
          hardware_access_enabled: boolean | null
          hardware_access_status: string | null
          health_conditions: string | null
          howbody_third_uid: string | null
          id: string
          injuries_limitations: string | null
          joined_at: string
          lead_id: string | null
          lifecycle_state: string
          member_code: string | null
          mips_person_id: string | null
          mips_person_sn: string | null
          mips_sync_status: string | null
          notes: string | null
          referred_by: string | null
          reward_points: number | null
          source: string | null
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
          wiegand_code: string | null
          workout_activities: string[]
        }
        Insert: {
          activity_level?: string | null
          allergies?: string[]
          assigned_trainer_id?: string | null
          avatar_storage_path?: string | null
          biometric_enrolled?: boolean | null
          biometric_photo_path?: string | null
          biometric_photo_url?: string | null
          bot_active?: boolean
          branch_id: string
          created_at?: string
          created_by?: string | null
          cuisine_preference?: string | null
          custom_welcome_message?: string | null
          dietary_preference?: string | null
          equipment_availability?: string[]
          fitness_goals?: string | null
          fitness_level?: string | null
          gstin?: string | null
          hardware_access_enabled?: boolean | null
          hardware_access_status?: string | null
          health_conditions?: string | null
          howbody_third_uid?: string | null
          id?: string
          injuries_limitations?: string | null
          joined_at?: string
          lead_id?: string | null
          lifecycle_state?: string
          member_code?: string | null
          mips_person_id?: string | null
          mips_person_sn?: string | null
          mips_sync_status?: string | null
          notes?: string | null
          referred_by?: string | null
          reward_points?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
          wiegand_code?: string | null
          workout_activities?: string[]
        }
        Update: {
          activity_level?: string | null
          allergies?: string[]
          assigned_trainer_id?: string | null
          avatar_storage_path?: string | null
          biometric_enrolled?: boolean | null
          biometric_photo_path?: string | null
          biometric_photo_url?: string | null
          bot_active?: boolean
          branch_id?: string
          created_at?: string
          created_by?: string | null
          cuisine_preference?: string | null
          custom_welcome_message?: string | null
          dietary_preference?: string | null
          equipment_availability?: string[]
          fitness_goals?: string | null
          fitness_level?: string | null
          gstin?: string | null
          hardware_access_enabled?: boolean | null
          hardware_access_status?: string | null
          health_conditions?: string | null
          howbody_third_uid?: string | null
          id?: string
          injuries_limitations?: string | null
          joined_at?: string
          lead_id?: string | null
          lifecycle_state?: string
          member_code?: string | null
          mips_person_id?: string | null
          mips_person_sn?: string | null
          mips_sync_status?: string | null
          notes?: string | null
          referred_by?: string | null
          reward_points?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
          wiegand_code?: string | null
          workout_activities?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "members_assigned_trainer_id_fkey"
            columns: ["assigned_trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_assigned_trainer_id_fkey"
            columns: ["assigned_trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "members_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_action_attempts: {
        Row: {
          action: string
          completed_at: string | null
          created_at: string
          error: string | null
          idempotency_key: string
          membership_id: string | null
          result: Json | null
          status: string
          user_id: string | null
        }
        Insert: {
          action: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          idempotency_key: string
          membership_id?: string | null
          result?: Json | null
          status?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          idempotency_key?: string
          membership_id?: string | null
          result?: Json | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      membership_free_days: {
        Row: {
          added_by: string | null
          created_at: string
          days_added: number
          id: string
          membership_id: string
          reason: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          days_added: number
          id?: string
          membership_id: string
          reason: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          days_added?: number
          id?: string
          membership_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_free_days_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_freeze_history: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          days_frozen: number
          end_date: string
          fee_charged: number | null
          id: string
          membership_id: string
          reason: string | null
          requested_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["approval_status"]
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          days_frozen: number
          end_date: string
          fee_charged?: number | null
          id?: string
          membership_id: string
          reason?: string | null
          requested_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          days_frozen?: number
          end_date?: string
          fee_charged?: number | null
          id?: string
          membership_id?: string
          reason?: string | null
          requested_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Relationships: [
          {
            foreignKeyName: "membership_freeze_history_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_plans: {
        Row: {
          admission_fee: number | null
          branch_id: string | null
          created_at: string
          description: string | null
          discounted_price: number | null
          display_order: number | null
          duration_days: number
          free_locker_size: string | null
          gst_rate: number | null
          id: string
          includes_free_locker: boolean | null
          is_active: boolean | null
          is_gst_inclusive: boolean | null
          is_transferable: boolean | null
          is_visible_to_members: boolean | null
          max_freeze_days: number | null
          name: string
          price: number
          public_report_link: boolean
          updated_at: string
        }
        Insert: {
          admission_fee?: number | null
          branch_id?: string | null
          created_at?: string
          description?: string | null
          discounted_price?: number | null
          display_order?: number | null
          duration_days: number
          free_locker_size?: string | null
          gst_rate?: number | null
          id?: string
          includes_free_locker?: boolean | null
          is_active?: boolean | null
          is_gst_inclusive?: boolean | null
          is_transferable?: boolean | null
          is_visible_to_members?: boolean | null
          max_freeze_days?: number | null
          name: string
          price: number
          public_report_link?: boolean
          updated_at?: string
        }
        Update: {
          admission_fee?: number | null
          branch_id?: string | null
          created_at?: string
          description?: string | null
          discounted_price?: number | null
          display_order?: number | null
          duration_days?: number
          free_locker_size?: string | null
          gst_rate?: number | null
          id?: string
          includes_free_locker?: boolean | null
          is_active?: boolean | null
          is_gst_inclusive?: boolean | null
          is_transferable?: boolean | null
          is_visible_to_members?: boolean | null
          max_freeze_days?: number | null
          name?: string
          price?: number
          public_report_link?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_plans_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          branch_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          discount_amount: number | null
          discount_reason: string | null
          end_date: string
          id: string
          is_auto_renew: boolean | null
          member_id: string
          notes: string | null
          original_end_date: string
          plan_id: string
          price_paid: number
          refund_amount: number | null
          start_date: string
          status: Database["public"]["Enums"]["membership_status"]
          total_freeze_days_used: number | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          discount_reason?: string | null
          end_date: string
          id?: string
          is_auto_renew?: boolean | null
          member_id: string
          notes?: string | null
          original_end_date: string
          plan_id: string
          price_paid: number
          refund_amount?: number | null
          start_date: string
          status?: Database["public"]["Enums"]["membership_status"]
          total_freeze_days_used?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          discount_reason?: string | null
          end_date?: string
          id?: string
          is_auto_renew?: boolean | null
          member_id?: string
          notes?: string | null
          original_end_date?: string
          plan_id?: string
          price_paid?: number
          refund_amount?: number | null
          start_date?: string
          status?: Database["public"]["Enums"]["membership_status"]
          total_freeze_days_used?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "memberships_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      mips_connections: {
        Row: {
          branch_id: string
          created_at: string | null
          id: string
          is_active: boolean
          password: string
          server_url: string
          updated_at: string | null
          username: string
        }
        Insert: {
          branch_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          password: string
          server_url: string
          updated_at?: string | null
          username: string
        }
        Update: {
          branch_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          password?: string
          server_url?: string
          updated_at?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "mips_connections_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      mips_sync_attempts: {
        Row: {
          attempt_no: number
          branch_id: string
          created_at: string
          device_id: string
          id: string
          last_error: string | null
          member_id: string | null
          next_retry_at: string | null
          staff_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_no?: number
          branch_id: string
          created_at?: string
          device_id: string
          id?: string
          last_error?: string | null
          member_id?: string | null
          next_retry_at?: string | null
          staff_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_no?: number
          branch_id?: string
          created_at?: string
          device_id?: string
          id?: string
          last_error?: string | null
          member_id?: string | null
          next_retry_at?: string | null
          staff_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mips_sync_attempts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mips_sync_attempts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "access_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mips_sync_attempts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mips_sync_attempts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      mips_sync_failures: {
        Row: {
          attempts: number
          branch_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          error_message: string | null
          id: string
          last_attempt_at: string
          operation: string
          payload: Json | null
          resolved_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          branch_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          error_message?: string | null
          id?: string
          last_attempt_at?: string
          operation: string
          payload?: Json | null
          resolved_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          branch_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          error_message?: string | null
          id?: string
          last_attempt_at?: string
          operation?: string
          payload?: Json | null
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mips_sync_failures_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string | null
          email_announcements: boolean | null
          email_class_notifications: boolean | null
          email_enabled: boolean
          email_membership_reminders: boolean | null
          email_payment_receipts: boolean | null
          id: string
          push_low_stock: boolean | null
          push_new_leads: boolean | null
          push_payment_alerts: boolean | null
          push_task_reminders: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          sms_announcements: boolean
          sms_class_notifications: boolean
          sms_enabled: boolean
          sms_membership_reminders: boolean
          sms_payment_receipts: boolean
          sms_retention_nudges: boolean
          timezone: string
          updated_at: string | null
          user_id: string | null
          whatsapp_announcements: boolean
          whatsapp_class_notifications: boolean
          whatsapp_enabled: boolean
          whatsapp_membership_reminders: boolean
          whatsapp_payment_receipts: boolean
          whatsapp_retention_nudges: boolean
        }
        Insert: {
          created_at?: string | null
          email_announcements?: boolean | null
          email_class_notifications?: boolean | null
          email_enabled?: boolean
          email_membership_reminders?: boolean | null
          email_payment_receipts?: boolean | null
          id?: string
          push_low_stock?: boolean | null
          push_new_leads?: boolean | null
          push_payment_alerts?: boolean | null
          push_task_reminders?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sms_announcements?: boolean
          sms_class_notifications?: boolean
          sms_enabled?: boolean
          sms_membership_reminders?: boolean
          sms_payment_receipts?: boolean
          sms_retention_nudges?: boolean
          timezone?: string
          updated_at?: string | null
          user_id?: string | null
          whatsapp_announcements?: boolean
          whatsapp_class_notifications?: boolean
          whatsapp_enabled?: boolean
          whatsapp_membership_reminders?: boolean
          whatsapp_payment_receipts?: boolean
          whatsapp_retention_nudges?: boolean
        }
        Update: {
          created_at?: string | null
          email_announcements?: boolean | null
          email_class_notifications?: boolean | null
          email_enabled?: boolean
          email_membership_reminders?: boolean | null
          email_payment_receipts?: boolean | null
          id?: string
          push_low_stock?: boolean | null
          push_new_leads?: boolean | null
          push_payment_alerts?: boolean | null
          push_task_reminders?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sms_announcements?: boolean
          sms_class_notifications?: boolean
          sms_enabled?: boolean
          sms_membership_reminders?: boolean
          sms_payment_receipts?: boolean
          sms_retention_nudges?: boolean
          timezone?: string
          updated_at?: string | null
          user_id?: string | null
          whatsapp_announcements?: boolean
          whatsapp_class_notifications?: boolean
          whatsapp_enabled?: boolean
          whatsapp_membership_reminders?: boolean
          whatsapp_payment_receipts?: boolean
          whatsapp_retention_nudges?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          branch_id: string | null
          category: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          metadata: Json | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          action_url?: string | null
          branch_id?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          metadata?: Json | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          action_url?: string | null
          branch_id?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          metadata?: Json | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          ai_tool_config: Json | null
          alert_config: Json | null
          branch_id: string | null
          created_at: string
          currency: string | null
          fiscal_year_start: string | null
          gst_rates: Json | null
          hsn_defaults: Json | null
          id: string
          lead_nurture_config: Json | null
          logo_url: string | null
          name: string | null
          session_timeout_hours: number | null
          timezone: string | null
          updated_at: string
          webhook_slug: string | null
          website_theme: Json | null
          whatsapp_ai_config: Json | null
        }
        Insert: {
          ai_tool_config?: Json | null
          alert_config?: Json | null
          branch_id?: string | null
          created_at?: string
          currency?: string | null
          fiscal_year_start?: string | null
          gst_rates?: Json | null
          hsn_defaults?: Json | null
          id?: string
          lead_nurture_config?: Json | null
          logo_url?: string | null
          name?: string | null
          session_timeout_hours?: number | null
          timezone?: string | null
          updated_at?: string
          webhook_slug?: string | null
          website_theme?: Json | null
          whatsapp_ai_config?: Json | null
        }
        Update: {
          ai_tool_config?: Json | null
          alert_config?: Json | null
          branch_id?: string | null
          created_at?: string
          currency?: string | null
          fiscal_year_start?: string | null
          gst_rates?: Json | null
          hsn_defaults?: Json | null
          id?: string
          lead_nurture_config?: Json | null
          logo_url?: string | null
          name?: string | null
          session_timeout_hours?: number | null
          timezone?: string | null
          updated_at?: string
          webhook_slug?: string | null
          website_theme?: Json | null
          whatsapp_ai_config?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_verifications: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          phone: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          phone: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
        }
        Relationships: []
      }
      payment_lifecycle_events: {
        Row: {
          actor_user_id: string | null
          branch_id: string
          created_at: string
          event_type: string
          id: string
          idempotency_key: string | null
          invoice_id: string | null
          member_id: string | null
          metadata: Json
          new_state: string | null
          payment_id: string | null
          payment_transaction_id: string | null
          previous_state: string | null
          source: string | null
        }
        Insert: {
          actor_user_id?: string | null
          branch_id: string
          created_at?: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          member_id?: string | null
          metadata?: Json
          new_state?: string | null
          payment_id?: string | null
          payment_transaction_id?: string | null
          previous_state?: string | null
          source?: string | null
        }
        Update: {
          actor_user_id?: string | null
          branch_id?: string
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          member_id?: string | null
          metadata?: Json
          new_state?: string | null
          payment_id?: string | null
          payment_transaction_id?: string | null
          previous_state?: string | null
          source?: string | null
        }
        Relationships: []
      }
      payment_reminders: {
        Row: {
          attempt_count: number
          branch_id: string
          channel: string
          created_at: string | null
          delivery_metadata: Json
          delivery_status: Database["public"]["Enums"]["reminder_delivery_status"]
          id: string
          invoice_id: string
          last_error: string | null
          member_id: string
          reminder_type: string
          scheduled_for: string
          sent_at: string | null
          status: string | null
        }
        Insert: {
          attempt_count?: number
          branch_id: string
          channel?: string
          created_at?: string | null
          delivery_metadata?: Json
          delivery_status?: Database["public"]["Enums"]["reminder_delivery_status"]
          id?: string
          invoice_id: string
          last_error?: string | null
          member_id: string
          reminder_type: string
          scheduled_for: string
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          attempt_count?: number
          branch_id?: string
          channel?: string
          created_at?: string | null
          delivery_metadata?: Json
          delivery_status?: Database["public"]["Enums"]["reminder_delivery_status"]
          id?: string
          invoice_id?: string
          last_error?: string | null
          member_id?: string
          reminder_type?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_reminders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reminders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reminders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          branch_id: string
          created_at: string | null
          currency: string | null
          error_message: string | null
          event_type: string | null
          gateway: string
          gateway_order_id: string | null
          gateway_payment_id: string | null
          gateway_signature: string | null
          http_status: number | null
          id: string
          idempotency_key: string | null
          invoice_id: string | null
          lifecycle_metadata: Json
          lifecycle_status: Database["public"]["Enums"]["payment_transaction_status"]
          member_id: string | null
          payment_link_url: string | null
          received_at: string | null
          response_body: Json | null
          settled_payment_id: string | null
          signature_verified: boolean | null
          source: string | null
          status: string
          updated_at: string | null
          webhook_data: Json | null
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string | null
          currency?: string | null
          error_message?: string | null
          event_type?: string | null
          gateway: string
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          gateway_signature?: string | null
          http_status?: number | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          lifecycle_metadata?: Json
          lifecycle_status?: Database["public"]["Enums"]["payment_transaction_status"]
          member_id?: string | null
          payment_link_url?: string | null
          received_at?: string | null
          response_body?: Json | null
          settled_payment_id?: string | null
          signature_verified?: boolean | null
          source?: string | null
          status?: string
          updated_at?: string | null
          webhook_data?: Json | null
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string | null
          currency?: string | null
          error_message?: string | null
          event_type?: string | null
          gateway?: string
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          gateway_signature?: string | null
          http_status?: number | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          lifecycle_metadata?: Json
          lifecycle_status?: Database["public"]["Enums"]["payment_transaction_status"]
          member_id?: string | null
          payment_link_url?: string | null
          received_at?: string | null
          response_body?: Json | null
          settled_payment_id?: string | null
          signature_verified?: boolean | null
          source?: string | null
          status?: string
          updated_at?: string | null
          webhook_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          id: string
          idempotency_key: string | null
          income_category_id: string | null
          invoice_id: string | null
          lifecycle_metadata: Json
          lifecycle_status: Database["public"]["Enums"]["payment_transaction_status"]
          member_id: string | null
          notes: string | null
          original_payment_id: string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_source: string
          received_by: string | null
          reversal_of: string | null
          settled_at: string | null
          slip_url: string | null
          status: Database["public"]["Enums"]["payment_status"]
          transaction_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          income_category_id?: string | null
          invoice_id?: string | null
          lifecycle_metadata?: Json
          lifecycle_status?: Database["public"]["Enums"]["payment_transaction_status"]
          member_id?: string | null
          notes?: string | null
          original_payment_id?: string | null
          payment_date?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_source?: string
          received_by?: string | null
          reversal_of?: string | null
          settled_at?: string | null
          slip_url?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          transaction_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          income_category_id?: string | null
          invoice_id?: string | null
          lifecycle_metadata?: Json
          lifecycle_status?: Database["public"]["Enums"]["payment_transaction_status"]
          member_id?: string | null
          notes?: string | null
          original_payment_id?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_source?: string
          received_by?: string | null
          reversal_of?: string | null
          settled_at?: string | null
          slip_url?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          transaction_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_income_category_id_fkey"
            columns: ["income_category_id"]
            isOneToOne: false
            referencedRelation: "income_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_original_payment_id_fkey"
            columns: ["original_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_audit: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: string
          item_id: string | null
          reason: string | null
          run_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          item_id?: string | null
          reason?: string | null
          run_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          item_id?: string | null
          reason?: string | null
          run_id?: string | null
        }
        Relationships: []
      }
      payroll_items: {
        Row: {
          adjustment_reason: string | null
          calc_attendance: Json
          calc_base: number
          calc_deductions: number
          calc_gross: number
          calc_net: number
          calc_ot: number
          calc_pt_commission: number
          created_at: string
          final_advance: number
          final_base: number
          final_bonus: number
          final_deductions: number
          final_gross: number
          final_net: number
          final_ot: number
          final_penalty: number
          final_pt_commission: number
          id: string
          payment_method: string | null
          payment_reference: string | null
          payslip_url: string | null
          run_id: string
          staff_kind: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          adjustment_reason?: string | null
          calc_attendance?: Json
          calc_base?: number
          calc_deductions?: number
          calc_gross?: number
          calc_net?: number
          calc_ot?: number
          calc_pt_commission?: number
          created_at?: string
          final_advance?: number
          final_base?: number
          final_bonus?: number
          final_deductions?: number
          final_gross?: number
          final_net?: number
          final_ot?: number
          final_penalty?: number
          final_pt_commission?: number
          id?: string
          payment_method?: string | null
          payment_reference?: string | null
          payslip_url?: string | null
          run_id: string
          staff_kind?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          adjustment_reason?: string | null
          calc_attendance?: Json
          calc_base?: number
          calc_deductions?: number
          calc_gross?: number
          calc_net?: number
          calc_ot?: number
          calc_pt_commission?: number
          created_at?: string
          final_advance?: number
          final_base?: number
          final_bonus?: number
          final_deductions?: number
          final_gross?: number
          final_net?: number
          final_ot?: number
          final_penalty?: number
          final_pt_commission?: number
          id?: string
          payment_method?: string | null
          payment_reference?: string | null
          payslip_url?: string | null
          run_id?: string
          staff_kind?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_rules: {
        Row: {
          branch_id: string
          calculation: Json
          created_at: string
          id: string
          is_active: boolean | null
          name: string
          rule_type: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          calculation: Json
          created_at?: string
          id?: string
          is_active?: boolean | null
          name: string
          rule_type: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          calculation?: Json
          created_at?: string
          id?: string
          is_active?: boolean | null
          name?: string
          rule_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_rules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_run_lines: {
        Row: {
          created_at: string
          hours_worked: number | null
          id: string
          is_early_out: boolean | null
          is_half_day: boolean | null
          is_holiday: boolean | null
          is_late: boolean | null
          is_missing_checkout: boolean | null
          is_weekly_off: boolean | null
          leave_type: string | null
          notes: string | null
          ot_hours: number | null
          payable: boolean | null
          run_id: string | null
          status: string
          user_id: string
          work_date: string
        }
        Insert: {
          created_at?: string
          hours_worked?: number | null
          id?: string
          is_early_out?: boolean | null
          is_half_day?: boolean | null
          is_holiday?: boolean | null
          is_late?: boolean | null
          is_missing_checkout?: boolean | null
          is_weekly_off?: boolean | null
          leave_type?: string | null
          notes?: string | null
          ot_hours?: number | null
          payable?: boolean | null
          run_id?: string | null
          status: string
          user_id: string
          work_date: string
        }
        Update: {
          created_at?: string
          hours_worked?: number | null
          id?: string
          is_early_out?: boolean | null
          is_half_day?: boolean | null
          is_holiday?: boolean | null
          is_late?: boolean | null
          is_missing_checkout?: boolean | null
          is_weekly_off?: boolean | null
          leave_type?: string | null
          notes?: string | null
          ot_hours?: number | null
          payable?: boolean | null
          run_id?: string | null
          status?: string
          user_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_run_lines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          branch_id: string | null
          created_at: string
          created_by: string | null
          finalized_at: string | null
          id: string
          notes: string | null
          paid_at: string | null
          period_end: string
          period_start: string
          processed_at: string | null
          processed_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          period_end: string
          period_start: string
          processed_at?: string | null
          processed_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          period_end?: string
          period_start?: string
          processed_at?: string | null
          processed_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          module: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          module: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          module?: string
          name?: string
        }
        Relationships: []
      }
      plan_benefits: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id: string | null
          created_at: string
          description: string | null
          frequency: Database["public"]["Enums"]["frequency_type"]
          id: string
          limit_count: number | null
          plan_id: string
          reset_period: string | null
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          created_at?: string
          description?: string | null
          frequency: Database["public"]["Enums"]["frequency_type"]
          id?: string
          limit_count?: number | null
          plan_id: string
          reset_period?: string | null
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          benefit_type_id?: string | null
          created_at?: string
          description?: string | null
          frequency?: Database["public"]["Enums"]["frequency_type"]
          id?: string
          limit_count?: number | null
          plan_id?: string
          reset_period?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_benefits_benefit_type_id_fkey"
            columns: ["benefit_type_id"]
            isOneToOne: false
            referencedRelation: "benefit_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_benefits_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sales: {
        Row: {
          branch_id: string
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          invoice_id: string | null
          items: Json
          member_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: string
          sale_date: string
          sold_by: string | null
          total_amount: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          invoice_id?: string | null
          items?: Json
          member_id?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status?: string
          sale_date?: string
          sold_by?: string | null
          total_amount: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          invoice_id?: string | null
          items?: Json
          member_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: string
          sale_date?: string
          sold_by?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      product_batches: {
        Row: {
          batch_number: string
          branch_id: string
          cost_price: number | null
          created_at: string
          created_by: string | null
          exp_date: string | null
          id: string
          invoice_ref: string | null
          lab_report_filename: string | null
          lab_report_uploaded_at: string | null
          lab_report_url: string | null
          lab_verified: boolean
          lab_verified_by: string | null
          mfg_date: string | null
          notes: string | null
          product_id: string
          quantity_received: number
          quantity_remaining: number
          status: string
          supplier: string | null
          updated_at: string
        }
        Insert: {
          batch_number: string
          branch_id: string
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          exp_date?: string | null
          id?: string
          invoice_ref?: string | null
          lab_report_filename?: string | null
          lab_report_uploaded_at?: string | null
          lab_report_url?: string | null
          lab_verified?: boolean
          lab_verified_by?: string | null
          mfg_date?: string | null
          notes?: string | null
          product_id: string
          quantity_received: number
          quantity_remaining: number
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          batch_number?: string
          branch_id?: string
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          exp_date?: string | null
          id?: string
          invoice_ref?: string | null
          lab_report_filename?: string | null
          lab_report_uploaded_at?: string | null
          lab_report_url?: string | null
          lab_verified?: boolean
          lab_verified_by?: string | null
          mfg_date?: string | null
          notes?: string | null
          product_id?: string
          quantity_received?: number
          quantity_remaining?: number
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          parent_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          branch_id: string | null
          category: string | null
          category_id: string | null
          cost_price: number | null
          created_at: string
          default_shelf_life_days: number | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          price: number
          requires_batch_tracking: boolean
          requires_lab_report: boolean
          sku: string | null
          tax_rate: number | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          category?: string | null
          category_id?: string | null
          cost_price?: number | null
          created_at?: string
          default_shelf_life_days?: number | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          price: number
          requires_batch_tracking?: boolean
          requires_lab_report?: boolean
          sku?: string | null
          tax_rate?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          category?: string | null
          category_id?: string | null
          cost_price?: number | null
          created_at?: string
          default_shelf_life_days?: number | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          price?: number
          requires_batch_tracking?: boolean
          requires_lab_report?: boolean
          sku?: string | null
          tax_rate?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar_storage_path: string | null
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
          government_id_number: string | null
          government_id_type: string | null
          government_id_verified: boolean | null
          id: string
          is_active: boolean | null
          last_seen_at: string | null
          must_set_password: boolean | null
          phone: string | null
          postal_code: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          avatar_storage_path?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          government_id_number?: string | null
          government_id_type?: string | null
          government_id_verified?: boolean | null
          id: string
          is_active?: boolean | null
          last_seen_at?: string | null
          must_set_password?: boolean | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          avatar_storage_path?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          government_id_number?: string | null
          government_id_type?: string | null
          government_id_verified?: boolean | null
          id?: string
          is_active?: boolean | null
          last_seen_at?: string | null
          must_set_password?: boolean | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pt_packages: {
        Row: {
          branch_id: string
          created_at: string
          description: string | null
          duration_months: number | null
          gst_inclusive: boolean | null
          gst_percentage: number | null
          id: string
          is_active: boolean | null
          name: string
          package_type: string
          price: number
          session_type: string | null
          total_sessions: number
          updated_at: string
          validity_days: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          description?: string | null
          duration_months?: number | null
          gst_inclusive?: boolean | null
          gst_percentage?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          package_type?: string
          price: number
          session_type?: string | null
          total_sessions: number
          updated_at?: string
          validity_days: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          description?: string | null
          duration_months?: number | null
          gst_inclusive?: boolean | null
          gst_percentage?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          package_type?: string
          price?: number
          session_type?: string | null
          total_sessions?: number
          updated_at?: string
          validity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "pt_packages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_sessions: {
        Row: {
          branch_id: string
          cancelled_reason: string | null
          created_at: string
          duration_minutes: number | null
          id: string
          member_pt_package_id: string
          notes: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["pt_session_status"]
          trainer_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          cancelled_reason?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          member_pt_package_id: string
          notes?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["pt_session_status"]
          trainer_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cancelled_reason?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          member_pt_package_id?: string
          notes?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["pt_session_status"]
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_sessions_member_pt_package_id_fkey"
            columns: ["member_pt_package_id"]
            isOneToOne: false
            referencedRelation: "member_pt_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_sessions_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_sessions_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_attempts: {
        Row: {
          branch_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          member_id: string
          result: Json | null
          status: string
        }
        Insert: {
          branch_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          member_id: string
          result?: Json | null
          status?: string
        }
        Update: {
          branch_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          member_id?: string
          result?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_attempts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_attempts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_findings: {
        Row: {
          branch_id: string | null
          created_at: string
          details: Json
          id: string
          kind: string
          reference_id: string | null
          reference_type: string | null
          resolved_at: string | null
          resolved_by: string | null
          run_date: string
          severity: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          kind: string
          reference_id?: string | null
          reference_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          run_date?: string
          severity?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          reference_id?: string | null
          reference_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          run_date?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_findings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_lifecycle_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          metadata: Json
          new_state: Database["public"]["Enums"]["referral_lifecycle_status"]
          previous_state:
            | Database["public"]["Enums"]["referral_lifecycle_status"]
            | null
          reason: string | null
          referral_id: string
          referred_member_id: string | null
          referrer_member_id: string
          source: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          new_state: Database["public"]["Enums"]["referral_lifecycle_status"]
          previous_state?:
            | Database["public"]["Enums"]["referral_lifecycle_status"]
            | null
          reason?: string | null
          referral_id: string
          referred_member_id?: string | null
          referrer_member_id: string
          source?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          new_state?: Database["public"]["Enums"]["referral_lifecycle_status"]
          previous_state?:
            | Database["public"]["Enums"]["referral_lifecycle_status"]
            | null
          reason?: string | null
          referral_id?: string
          referred_member_id?: string | null
          referrer_member_id?: string
          source?: string | null
        }
        Relationships: []
      }
      referral_rewards: {
        Row: {
          claim_idempotency_key: string | null
          claimed_at: string | null
          claimed_wallet_txn_id: string | null
          created_at: string
          description: string | null
          id: string
          is_claimed: boolean | null
          member_id: string
          referral_id: string
          reward_type: string
          reward_value: number | null
        }
        Insert: {
          claim_idempotency_key?: string | null
          claimed_at?: string | null
          claimed_wallet_txn_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_claimed?: boolean | null
          member_id: string
          referral_id: string
          reward_type: string
          reward_value?: number | null
        }
        Update: {
          claim_idempotency_key?: string | null
          claimed_at?: string | null
          claimed_wallet_txn_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_claimed?: boolean | null
          member_id?: string
          referral_id?: string
          reward_type?: string
          reward_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_settings: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          min_membership_value: number | null
          referred_reward_type: string
          referred_reward_value: number
          referrer_reward_type: string
          referrer_reward_value: number
          reward_mode: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          min_membership_value?: number | null
          referred_reward_type?: string
          referred_reward_value?: number
          referrer_reward_type?: string
          referrer_reward_value?: number
          reward_mode?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          min_membership_value?: number | null
          referred_reward_type?: string
          referred_reward_value?: number
          referrer_reward_type?: string
          referrer_reward_value?: number
          reward_mode?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          claimed_at: string | null
          converted_at: string | null
          created_at: string
          id: string
          last_status_change_at: string
          lifecycle_status: Database["public"]["Enums"]["referral_lifecycle_status"]
          metadata: Json
          qualifying_invoice_id: string | null
          referral_code: string | null
          referred_email: string | null
          referred_member_id: string | null
          referred_name: string
          referred_phone: string
          referrer_member_id: string
          rewarded_at: string | null
          status: Database["public"]["Enums"]["lead_status"]
        }
        Insert: {
          claimed_at?: string | null
          converted_at?: string | null
          created_at?: string
          id?: string
          last_status_change_at?: string
          lifecycle_status?: Database["public"]["Enums"]["referral_lifecycle_status"]
          metadata?: Json
          qualifying_invoice_id?: string | null
          referral_code?: string | null
          referred_email?: string | null
          referred_member_id?: string | null
          referred_name: string
          referred_phone: string
          referrer_member_id: string
          rewarded_at?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
        }
        Update: {
          claimed_at?: string | null
          converted_at?: string | null
          created_at?: string
          id?: string
          last_status_change_at?: string
          lifecycle_status?: Database["public"]["Enums"]["referral_lifecycle_status"]
          metadata?: Json
          qualifying_invoice_id?: string | null
          referral_code?: string | null
          referred_email?: string | null
          referred_member_id?: string | null
          referred_name?: string
          referred_phone?: string
          referrer_member_id?: string
          rewarded_at?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_member_id_fkey"
            columns: ["referred_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_member_id_fkey"
            columns: ["referrer_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_configurations: {
        Row: {
          branch_id: string
          channel: string
          created_at: string
          days_before: number[] | null
          id: string
          is_enabled: boolean
          reminder_type: string
          template_text: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          channel?: string
          created_at?: string
          days_before?: number[] | null
          id?: string
          is_enabled?: boolean
          reminder_type: string
          template_text?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          channel?: string
          created_at?: string
          days_before?: number[] | null
          id?: string
          is_enabled?: boolean
          reminder_type?: string
          template_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_configurations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_nudge_logs: {
        Row: {
          branch_id: string
          channel: string
          created_at: string
          id: string
          member_id: string
          message_content: string | null
          resolution: string | null
          resolved_at: string | null
          sent_at: string
          stage_level: number
          status: string
          template_id: string | null
        }
        Insert: {
          branch_id: string
          channel?: string
          created_at?: string
          id?: string
          member_id: string
          message_content?: string | null
          resolution?: string | null
          resolved_at?: string | null
          sent_at?: string
          stage_level: number
          status?: string
          template_id?: string | null
        }
        Update: {
          branch_id?: string
          channel?: string
          created_at?: string
          id?: string
          member_id?: string
          message_content?: string | null
          resolution?: string | null
          resolved_at?: string | null
          sent_at?: string
          stage_level?: number
          status?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_nudge_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_nudge_logs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_nudge_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "retention_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_templates: {
        Row: {
          branch_id: string | null
          channels: string[] | null
          created_at: string
          days_trigger: number
          id: string
          is_active: boolean
          message_body: string
          stage_level: number
          stage_name: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          channels?: string[] | null
          created_at?: string
          days_trigger: number
          id?: string
          is_active?: boolean
          message_body: string
          stage_level: number
          stage_name: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          channels?: string[] | null
          created_at?: string
          days_trigger?: number
          id?: string
          is_active?: boolean
          message_body?: string
          stage_level?: number
          stage_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      rewards_ledger: {
        Row: {
          branch_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          member_id: string
          points: number
          reason: string
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          member_id: string
          points: number
          reason: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          member_id?: string
          points?: number
          reason?: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rewards_ledger_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rewards_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rewards_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rewards_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      role_capabilities: {
        Row: {
          capability: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          capability: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          capability?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      role_change_audit: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          branch_id: string | null
          created_at: string
          id: string
          reason: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          target_user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          branch_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          target_user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          branch_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          target_user_id?: string
        }
        Relationships: []
      }
      role_change_requests: {
        Row: {
          action: string
          branch_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          reason: string
          requested_by: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          target_user_id: string
        }
        Insert: {
          action: string
          branch_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          reason: string
          requested_by: string
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          target_user_id: string
        }
        Update: {
          action?: string
          branch_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          reason?: string
          requested_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          target_user_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_lead_views: {
        Row: {
          created_at: string
          filters: Json
          id: string
          is_default: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scan_report_deliveries: {
        Row: {
          branch_id: string | null
          created_at: string
          email_error: string | null
          email_status: string | null
          id: string
          inapp_status: string | null
          kind: string
          member_id: string | null
          pdf_url: string | null
          report_id: string
          whatsapp_error: string | null
          whatsapp_status: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          email_error?: string | null
          email_status?: string | null
          id?: string
          inapp_status?: string | null
          kind: string
          member_id?: string | null
          pdf_url?: string | null
          report_id: string
          whatsapp_error?: string | null
          whatsapp_status?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          email_error?: string | null
          email_status?: string | null
          id?: string
          inapp_status?: string | null
          kind?: string
          member_id?: string | null
          pdf_url?: string | null
          report_id?: string
          whatsapp_error?: string | null
          whatsapp_status?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_logs: {
        Row: {
          branch_id: string | null
          created_at: string
          error_message: string | null
          id: string
          message: string
          message_id: string | null
          phone: string
          provider: string
          sent_by: string | null
          status: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message: string
          message_id?: string | null
          phone: string
          provider: string
          sent_by?: string | null
          status?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message?: string
          message_id?: string | null
          phone?: string
          provider?: string
          sent_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance: {
        Row: {
          branch_id: string
          check_in: string
          check_out: string | null
          created_at: string
          id: string
          notes: string | null
          user_id: string
        }
        Insert: {
          branch_id: string
          check_in?: string
          check_out?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          branch_id?: string
          check_in?: string
          check_out?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_attendance_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_branches: {
        Row: {
          branch_id: string
          created_at: string
          hire_date: string | null
          id: string
          position: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          hire_date?: string | null
          id?: string
          position?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          hire_date?: string | null
          id?: string
          position?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_branches_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_branches_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_shifts: {
        Row: {
          branch_id: string | null
          created_at: string
          end_time: string
          half_day_threshold_hours: number
          id: string
          is_weekly_off: boolean
          late_grace_min: number
          ot_multiplier: number
          ot_threshold_hours: number
          start_time: string
          user_id: string
          weekday: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          end_time?: string
          half_day_threshold_hours?: number
          id?: string
          is_weekly_off?: boolean
          late_grace_min?: number
          ot_multiplier?: number
          ot_threshold_hours?: number
          start_time?: string
          user_id: string
          weekday: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          end_time?: string
          half_day_threshold_hours?: number
          id?: string
          is_weekly_off?: boolean
          late_grace_min?: number
          ot_multiplier?: number
          ot_threshold_hours?: number
          start_time?: string
          user_id?: string
          weekday?: number
        }
        Relationships: []
      }
      staff_whatsapp_routing: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_available: boolean
          last_assigned_at: string | null
          personal_phone: string
          role_filter: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_available?: boolean
          last_assigned_at?: string | null
          personal_phone: string
          role_filter?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_available?: boolean
          last_assigned_at?: string | null
          personal_phone?: string
          role_filter?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_whatsapp_routing_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          batch_id: string | null
          branch_id: string
          created_at: string | null
          created_by: string | null
          id: string
          movement_type: string
          notes: string | null
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          batch_id?: string | null
          branch_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          movement_type: string
          notes?: string | null
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          batch_id?: string | null
          branch_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          movement_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_health_pings: {
        Row: {
          component: string
          detail: Json | null
          id: string
          latency_ms: number | null
          observed_at: string
          status: string
        }
        Insert: {
          component: string
          detail?: Json | null
          id?: string
          latency_ms?: number | null
          observed_at?: string
          status: string
        }
        Update: {
          component?: string
          detail?: Json | null
          id?: string
          latency_ms?: number | null
          observed_at?: string
          status?: string
        }
        Relationships: []
      }
      task_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reminders: {
        Row: {
          channel: string
          created_at: string
          id: string
          remind_at: string
          sent_at: string | null
          task_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          remind_at: string
          sent_at?: string | null
          task_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          remind_at?: string
          sent_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["task_status"] | null
          id: string
          note: string | null
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: string
          note?: string | null
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: string
          note?: string | null
          task_id?: string
          to_status?: Database["public"]["Enums"]["task_status"]
        }
        Relationships: [
          {
            foreignKeyName: "task_status_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_by: string | null
          assigned_to: string | null
          branch_id: string
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          linked_entity_id: string | null
          linked_entity_type: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          assigned_to?: string | null
          branch_id: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          assigned_to?: string | null
          branch_id?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          attachment_filename_template: string | null
          attachment_source: string | null
          branch_id: string | null
          content: string
          created_at: string
          header_media_handle: string | null
          header_media_url: string | null
          header_type: string | null
          id: string
          is_active: boolean | null
          last_validated_at: string | null
          meta_rejection_reason: string | null
          meta_template_name: string | null
          meta_template_status: string | null
          name: string
          subject: string | null
          trigger_event: string | null
          type: string
          updated_at: string
          validation_errors: Json | null
          variables: Json | null
        }
        Insert: {
          attachment_filename_template?: string | null
          attachment_source?: string | null
          branch_id?: string | null
          content: string
          created_at?: string
          header_media_handle?: string | null
          header_media_url?: string | null
          header_type?: string | null
          id?: string
          is_active?: boolean | null
          last_validated_at?: string | null
          meta_rejection_reason?: string | null
          meta_template_name?: string | null
          meta_template_status?: string | null
          name: string
          subject?: string | null
          trigger_event?: string | null
          type: string
          updated_at?: string
          validation_errors?: Json | null
          variables?: Json | null
        }
        Update: {
          attachment_filename_template?: string | null
          attachment_source?: string | null
          branch_id?: string | null
          content?: string
          created_at?: string
          header_media_handle?: string | null
          header_media_url?: string | null
          header_type?: string | null
          id?: string
          is_active?: boolean | null
          last_validated_at?: string | null
          meta_rejection_reason?: string | null
          meta_template_name?: string | null
          meta_template_status?: string | null
          name?: string
          subject?: string | null
          trigger_event?: string | null
          type?: string
          updated_at?: string
          validation_errors?: Json | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_availability: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_available: boolean | null
          start_time: string
          trainer_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_available?: boolean | null
          start_time: string
          trainer_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_available?: boolean | null
          start_time?: string
          trainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_availability_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_availability_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_change_requests: {
        Row: {
          created_at: string
          current_trainer_id: string | null
          id: string
          member_id: string
          reason: string | null
          requested_at: string
          requested_trainer_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          current_trainer_id?: string | null
          id?: string
          member_id: string
          reason?: string | null
          requested_at?: string
          requested_trainer_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          current_trainer_id?: string | null
          id?: string
          member_id?: string
          reason?: string | null
          requested_at?: string
          requested_trainer_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_change_requests_current_trainer_id_fkey"
            columns: ["current_trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_change_requests_current_trainer_id_fkey"
            columns: ["current_trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_change_requests_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_change_requests_requested_trainer_id_fkey"
            columns: ["requested_trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_change_requests_requested_trainer_id_fkey"
            columns: ["requested_trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_commissions: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          commission_type: string
          created_at: string
          id: string
          kind: string
          notes: string | null
          paid_at: string | null
          percentage: number | null
          pt_package_id: string | null
          release_date: string | null
          reverses_commission_id: string | null
          session_id: string | null
          source_payment_id: string | null
          status: string
          trainer_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          commission_type: string
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          paid_at?: string | null
          percentage?: number | null
          pt_package_id?: string | null
          release_date?: string | null
          reverses_commission_id?: string | null
          session_id?: string | null
          source_payment_id?: string | null
          status?: string
          trainer_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          commission_type?: string
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          paid_at?: string | null
          percentage?: number | null
          pt_package_id?: string | null
          release_date?: string | null
          reverses_commission_id?: string | null
          session_id?: string | null
          source_payment_id?: string | null
          status?: string
          trainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_commissions_pt_package_id_fkey"
            columns: ["pt_package_id"]
            isOneToOne: false
            referencedRelation: "member_pt_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_commissions_reverses_commission_id_fkey"
            columns: ["reverses_commission_id"]
            isOneToOne: false
            referencedRelation: "trainer_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_commissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pt_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_commissions_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainer_commissions_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      trainers: {
        Row: {
          avatar_storage_path: string | null
          bio: string | null
          biometric_enrolled: boolean | null
          biometric_photo_path: string | null
          biometric_photo_url: string | null
          branch_id: string
          certifications: string[] | null
          created_at: string
          fixed_salary: number | null
          government_id_number: string | null
          government_id_type: string | null
          hourly_rate: number | null
          id: string
          is_active: boolean | null
          max_clients: number | null
          mips_person_id: string | null
          mips_person_sn: string | null
          mips_sync_status: string | null
          pt_share_percentage: number | null
          salary_type: string | null
          specializations: string[] | null
          trainer_code: string | null
          updated_at: string
          user_id: string
          weekly_off: string | null
        }
        Insert: {
          avatar_storage_path?: string | null
          bio?: string | null
          biometric_enrolled?: boolean | null
          biometric_photo_path?: string | null
          biometric_photo_url?: string | null
          branch_id: string
          certifications?: string[] | null
          created_at?: string
          fixed_salary?: number | null
          government_id_number?: string | null
          government_id_type?: string | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          max_clients?: number | null
          mips_person_id?: string | null
          mips_person_sn?: string | null
          mips_sync_status?: string | null
          pt_share_percentage?: number | null
          salary_type?: string | null
          specializations?: string[] | null
          trainer_code?: string | null
          updated_at?: string
          user_id: string
          weekly_off?: string | null
        }
        Update: {
          avatar_storage_path?: string | null
          bio?: string | null
          biometric_enrolled?: boolean | null
          biometric_photo_path?: string | null
          biometric_photo_url?: string | null
          branch_id?: string
          certifications?: string[] | null
          created_at?: string
          fixed_salary?: number | null
          government_id_number?: string | null
          government_id_type?: string | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          max_clients?: number | null
          mips_person_id?: string | null
          mips_person_sn?: string | null
          mips_sync_status?: string | null
          pt_share_percentage?: number | null
          salary_type?: string | null
          specializations?: string[] | null
          trainer_code?: string | null
          updated_at?: string
          user_id?: string
          weekly_off?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trainers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainers_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "trainers_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_active_branch: {
        Row: {
          branch_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_branch_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "online_users_v"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_roles_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          reference_id: string | null
          reference_type: string | null
          txn_type: Database["public"]["Enums"]["wallet_txn_type"]
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          reference_id?: string | null
          reference_type?: string | null
          txn_type: Database["public"]["Enums"]["wallet_txn_type"]
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          reference_id?: string | null
          reference_type?: string | null
          txn_type?: Database["public"]["Enums"]["wallet_txn_type"]
          wallet_id?: string
        }
        Relationships: [
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
          balance: number
          created_at: string
          id: string
          is_active: boolean | null
          member_id: string
          total_credited: number | null
          total_debited: number | null
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          is_active?: boolean | null
          member_id: string
          total_credited?: number | null
          total_debited?: number | null
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          is_active?: boolean | null
          member_id?: string
          total_credited?: number | null
          total_debited?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_failures: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          object_type: string | null
          reason: string
          signature_present: boolean
          source: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          object_type?: string | null
          reason: string
          signature_present?: boolean
          source: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          object_type?: string | null
          reason?: string
          signature_present?: boolean
          source?: string
        }
        Relationships: []
      }
      webhook_ingress_log: {
        Row: {
          created_at: string
          entry_count: number | null
          fields: string[] | null
          id: string
          messaging_count: number | null
          object_type: string | null
          sample: Json | null
          signature_verified: boolean | null
          source: string
        }
        Insert: {
          created_at?: string
          entry_count?: number | null
          fields?: string[] | null
          id?: string
          messaging_count?: number | null
          object_type?: string | null
          sample?: Json | null
          signature_verified?: boolean | null
          source: string
        }
        Update: {
          created_at?: string
          entry_count?: number | null
          fields?: string[] | null
          id?: string
          messaging_count?: number | null
          object_type?: string | null
          sample?: Json | null
          signature_verified?: boolean | null
          source?: string
        }
        Relationships: []
      }
      webhook_processing_log: {
        Row: {
          created_at: string
          event_kind: string | null
          id: string
          meta_error_code: number | null
          meta_error_message: string | null
          meta_error_subcode: number | null
          object_type: string | null
          platform_message_id: string | null
          reason: string | null
          sample: Json | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          event_kind?: string | null
          id?: string
          meta_error_code?: number | null
          meta_error_message?: string | null
          meta_error_subcode?: number | null
          object_type?: string | null
          platform_message_id?: string | null
          reason?: string | null
          sample?: Json | null
          source: string
          status: string
        }
        Update: {
          created_at?: string
          event_kind?: string | null
          id?: string
          meta_error_code?: number | null
          meta_error_message?: string | null
          meta_error_subcode?: number | null
          object_type?: string | null
          platform_message_id?: string | null
          reason?: string | null
          sample?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      whatsapp_chat_settings: {
        Row: {
          assigned_to: string | null
          bot_active: boolean | null
          branch_id: string | null
          captured_lead_id: string | null
          conversation_summary: string | null
          created_at: string | null
          handoff_reason: string | null
          handoff_requested_at: string | null
          id: string
          is_unread: boolean | null
          last_nurture_at: string | null
          nurture_retry_count: number | null
          partial_lead_data: Json | null
          paused_at: string | null
          paused_by: string | null
          phone_number: string
          platform: Database["public"]["Enums"]["messaging_platform"]
          summary_message_count: number | null
          summary_updated_at: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          bot_active?: boolean | null
          branch_id?: string | null
          captured_lead_id?: string | null
          conversation_summary?: string | null
          created_at?: string | null
          handoff_reason?: string | null
          handoff_requested_at?: string | null
          id?: string
          is_unread?: boolean | null
          last_nurture_at?: string | null
          nurture_retry_count?: number | null
          partial_lead_data?: Json | null
          paused_at?: string | null
          paused_by?: string | null
          phone_number: string
          platform?: Database["public"]["Enums"]["messaging_platform"]
          summary_message_count?: number | null
          summary_updated_at?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          bot_active?: boolean | null
          branch_id?: string | null
          captured_lead_id?: string | null
          conversation_summary?: string | null
          created_at?: string | null
          handoff_reason?: string | null
          handoff_requested_at?: string | null
          id?: string
          is_unread?: boolean | null
          last_nurture_at?: string | null
          nurture_retry_count?: number | null
          partial_lead_data?: Json | null
          paused_at?: string | null
          paused_by?: string | null
          phone_number?: string
          platform?: Database["public"]["Enums"]["messaging_platform"]
          summary_message_count?: number | null
          summary_updated_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chat_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chat_settings_captured_lead_id_fkey"
            columns: ["captured_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_state: {
        Row: {
          branch_id: string
          consecutive_tool_errors: number
          created_at: string
          id: string
          last_questions: string[]
          lead_capture_progress: Json
          phone_number: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          consecutive_tool_errors?: number
          created_at?: string
          id?: string
          last_questions?: string[]
          lead_capture_progress?: Json
          phone_number: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          consecutive_tool_errors?: number
          created_at?: string
          id?: string
          last_questions?: string[]
          lead_capture_progress?: Json
          phone_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_state_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          branch_id: string
          contact_avatar_url: string | null
          contact_name: string | null
          content: string | null
          created_at: string | null
          delivered_at: string | null
          direction: string
          failed_at: string | null
          failure_code: string | null
          failure_reason: string | null
          id: string
          is_internal_note: boolean
          media_meta: Json | null
          media_url: string | null
          member_id: string | null
          message_type: string
          phone_number: string
          platform: Database["public"]["Enums"]["messaging_platform"]
          platform_message_id: string | null
          read_at: string | null
          retry_count: number
          sent_at: string | null
          sent_by: string | null
          status: string | null
          updated_at: string | null
          whatsapp_message_id: string | null
        }
        Insert: {
          branch_id: string
          contact_avatar_url?: string | null
          contact_name?: string | null
          content?: string | null
          created_at?: string | null
          delivered_at?: string | null
          direction: string
          failed_at?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          is_internal_note?: boolean
          media_meta?: Json | null
          media_url?: string | null
          member_id?: string | null
          message_type?: string
          phone_number: string
          platform?: Database["public"]["Enums"]["messaging_platform"]
          platform_message_id?: string | null
          read_at?: string | null
          retry_count?: number
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          updated_at?: string | null
          whatsapp_message_id?: string | null
        }
        Update: {
          branch_id?: string
          contact_avatar_url?: string | null
          contact_name?: string | null
          content?: string | null
          created_at?: string | null
          delivered_at?: string | null
          direction?: string
          failed_at?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          is_internal_note?: boolean
          media_meta?: Json | null
          media_url?: string | null
          member_id?: string | null
          message_type?: string
          phone_number?: string
          platform?: Database["public"]["Enums"]["messaging_platform"]
          platform_message_id?: string | null
          read_at?: string | null
          retry_count?: number
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          updated_at?: string | null
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_send_locks: {
        Row: {
          acquired_at: string
          expires_at: string
          phone_number: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          phone_number: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          phone_number?: string
        }
        Relationships: []
      }
      whatsapp_send_queue: {
        Row: {
          attempts: number
          branch_id: string
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          message_id: string
          next_attempt_at: string
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          branch_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          message_id: string
          next_attempt_at?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          branch_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          message_id?: string
          next_attempt_at?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_send_queue_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_send_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_send_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          branch_id: string | null
          category: string | null
          components: Json | null
          created_at: string | null
          id: string
          is_stale: boolean
          language: string | null
          meta_template_id: string | null
          name: string
          quality_score: string | null
          rejected_reason: string | null
          status: string | null
          synced_at: string | null
          waba_id: string
        }
        Insert: {
          branch_id?: string | null
          category?: string | null
          components?: Json | null
          created_at?: string | null
          id?: string
          is_stale?: boolean
          language?: string | null
          meta_template_id?: string | null
          name: string
          quality_score?: string | null
          rejected_reason?: string | null
          status?: string | null
          synced_at?: string | null
          waba_id: string
        }
        Update: {
          branch_id?: string | null
          category?: string | null
          components?: Json | null
          created_at?: string | null
          id?: string
          is_stale?: boolean
          language?: string | null
          meta_template_id?: string | null
          name?: string
          quality_score?: string | null
          rejected_reason?: string | null
          status?: string | null
          synced_at?: string | null
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_triggers: {
        Row: {
          branch_id: string | null
          created_at: string
          delay_minutes: number
          event_name: string
          id: string
          is_active: boolean
          template_id: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          delay_minutes?: number
          event_name: string
          id?: string
          is_active?: boolean
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          delay_minutes?: number
          event_name?: string
          id?: string
          is_active?: boolean
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_triggers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_triggers_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_triggers_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_template_with_meta_status"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      crm_messages: {
        Row: {
          branch_id: string | null
          contact_name: string | null
          content: string | null
          created_at: string | null
          direction: string | null
          id: string | null
          member_id: string | null
          message_type: string | null
          phone_number: string | null
          platform: Database["public"]["Enums"]["messaging_platform"] | null
          platform_message_id: string | null
          status: string | null
          updated_at: string | null
          whatsapp_message_id: string | null
        }
        Insert: {
          branch_id?: string | null
          contact_name?: string | null
          content?: string | null
          created_at?: string | null
          direction?: string | null
          id?: string | null
          member_id?: string | null
          message_type?: string | null
          phone_number?: string | null
          platform?: Database["public"]["Enums"]["messaging_platform"] | null
          platform_message_id?: string | null
          status?: string | null
          updated_at?: string | null
          whatsapp_message_id?: string | null
        }
        Update: {
          branch_id?: string | null
          contact_name?: string | null
          content?: string | null
          created_at?: string | null
          direction?: string | null
          id?: string | null
          member_id?: string | null
          message_type?: string | null
          phone_number?: string | null
          platform?: Database["public"]["Enums"]["messaging_platform"] | null
          platform_message_id?: string | null
          status?: string | null
          updated_at?: string | null
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      mips_connections_safe: {
        Row: {
          branch_id: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          password: string | null
          server_url: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          password?: never
          server_url?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          password?: never
          server_url?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mips_connections_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatch_summary: {
        Row: {
          branch_id: string | null
          category: string | null
          channel: string | null
          deduped: number | null
          failed: number | null
          queued: number | null
          sent: number | null
          suppressed: number | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      online_users_v: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          last_seen_at: string | null
          roles: string[] | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          last_seen_at?: string | null
          roles?: never
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          last_seen_at?: string | null
          roles?: never
          user_id?: string | null
        }
        Relationships: []
      }
      policy_audit: {
        Row: {
          delete_policies: number | null
          insert_policies: number | null
          policy_count: number | null
          rls_enabled: boolean | null
          select_policies: number | null
          table_name: unknown
          update_policies: number | null
        }
        Relationships: []
      }
      product_batch_availability: {
        Row: {
          active_batch_count: number | null
          available_quantity: number | null
          branch_id: string | null
          nearest_expiry: string | null
          product_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      trainers_public: {
        Row: {
          avatar_url: string | null
          bio: string | null
          branch_id: string | null
          certifications: string[] | null
          created_at: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          max_clients: number | null
          specializations: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "trainers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      v_template_with_meta_status: {
        Row: {
          approval_status: string | null
          attachment_filename_template: string | null
          attachment_source: string | null
          branch_id: string | null
          content: string | null
          created_at: string | null
          header_media_handle: string | null
          header_media_url: string | null
          header_type: string | null
          id: string | null
          is_active: boolean | null
          meta_rejection_reason: string | null
          meta_template_name: string | null
          meta_template_status: string | null
          name: string | null
          subject: string | null
          trigger_event: string | null
          type: string | null
          updated_at: string | null
          whatsapp_category: string | null
          whatsapp_language: string | null
          whatsapp_meta_status: string | null
          whatsapp_rejected_reason: string | null
          whatsapp_template_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_delivery_health: {
        Row: {
          branch_id: string | null
          delivered: number | null
          failed: number | null
          hour: string | null
          read: number | null
          sent: number | null
          stuck_pending: number | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _notify_booking_event: {
        Args: { p_booking_id: string; p_event: string }
        Returns: undefined
      }
      _resolve_audit_target_name: {
        Args: { p_row: Json; p_table: string }
        Returns: string
      }
      add_to_waitlist: {
        Args: { _class_id: string; _member_id: string }
        Returns: Json
      }
      admin_run_automation_now: {
        Args: { _rule_id: string }
        Returns: undefined
      }
      admin_toggle_automation_rule: {
        Args: { _active: boolean; _rule_id: string }
        Returns: undefined
      }
      admin_update_automation_rule: {
        Args: {
          _ai_tone: string
          _cron_expression: string
          _description?: string
          _name?: string
          _rule_id: string
          _target_filter: Json
          _use_ai: boolean
        }
        Returns: undefined
      }
      advance_referral_lifecycle: {
        Args: {
          p_actor_user_id?: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_qualifying_invoice_id?: string
          p_reason?: string
          p_referral_id: string
          p_source?: string
          p_target_status: Database["public"]["Enums"]["referral_lifecycle_status"]
        }
        Returns: Json
      }
      archive_approval_audit_log: { Args: never; Returns: Json }
      assert_measurement_range: {
        Args: { _field: string; _max: number; _min: number; _value: number }
        Returns: number
      }
      assign_locker_with_billing:
        | {
            Args: {
              p_billing_months?: number
              p_chargeable?: boolean
              p_end_date: string
              p_fee_amount: number
              p_gst_rate?: number
              p_locker_id: string
              p_member_id: string
              p_received_by?: string
              p_start_date: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_assign_source?: string
              p_billing_months?: number
              p_chargeable?: boolean
              p_end_date: string
              p_fee_amount: number
              p_gst_rate?: number
              p_locker_id: string
              p_member_id: string
              p_received_by?: string
              p_start_date: string
            }
            Returns: Json
          }
      assign_user_role: {
        Args: {
          p_branch_id: string
          p_reason: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user_id: string
        }
        Returns: Json
      }
      auto_expire_memberships: { Args: never; Returns: undefined }
      award_group_bonus: { Args: { p_group_id: string }; Returns: Json }
      bill_locker_period: {
        Args: { p_amount: number; p_assignment_id: string; p_months?: number }
        Returns: Json
      }
      book_class: {
        Args: { _class_id: string; _member_id: string }
        Returns: Json
      }
      book_facility_slot: {
        Args: {
          p_force?: boolean
          p_force_reason?: string
          p_member_id: string
          p_membership_id: string
          p_slot_id: string
          p_source?: string
          p_staff_id?: string
        }
        Returns: Json
      }
      calc_gst: {
        Args: {
          p_amount: number
          p_inclusive?: boolean
          p_intra_state?: boolean
          p_rate: number
        }
        Returns: {
          cgst: number
          igst: number
          sgst: number
          taxable: number
          total: number
        }[]
      }
      can_access_biometric_photo: {
        Args: { _path: string; _user_id: string }
        Returns: boolean
      }
      can_access_member_measurement_photo: {
        Args: { _path: string; _user_id: string }
        Returns: boolean
      }
      can_access_member_measurements: {
        Args: { _member_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_private_member_media: {
        Args: { _path: string; _user_id: string }
        Returns: boolean
      }
      can_access_private_staff_media: {
        Args: { _path: string; _user_id: string }
        Returns: boolean
      }
      can_manage_member_lifecycle: {
        Args: { _member_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_private_member_media: {
        Args: { _path: string; _user_id: string }
        Returns: boolean
      }
      can_write_biometric_photo: {
        Args: { _path: string; _user_id: string }
        Returns: boolean
      }
      can_write_member_measurement_photo: {
        Args: { _path: string; _user_id: string }
        Returns: boolean
      }
      can_write_member_measurements: {
        Args: { _member_id: string; _user_id: string }
        Returns: boolean
      }
      cancel_class_booking: {
        Args: { _booking_id: string; _reason?: string }
        Returns: Json
      }
      cancel_facility_slot: {
        Args: {
          p_booking_id: string
          p_override_deadline?: boolean
          p_reason?: string
          p_staff_id?: string
        }
        Returns: Json
      }
      cancel_membership: {
        Args: {
          p_idempotency_key?: string
          p_membership_id: string
          p_reason: string
          p_refund_amount?: number
          p_refund_method?: string
        }
        Returns: Json
      }
      channel_active_for_branch: {
        Args: { p_branch_id: string; p_channel: string }
        Returns: boolean
      }
      check_critical_error_alerts: { Args: never; Returns: number }
      check_trainer_slot_available: {
        Args: {
          _duration_minutes?: number
          _scheduled_at: string
          _trainer_id: string
        }
        Returns: boolean
      }
      claim_referral_reward: {
        Args: {
          p_actor_user_id?: string
          p_idempotency_key?: string
          p_member_id: string
          p_reward_id: string
        }
        Returns: Json
      }
      cleanup_old_notifications: { Args: never; Returns: Json }
      complete_pt_session: {
        Args: { _notes?: string; _session_id: string }
        Returns: Json
      }
      compute_error_fingerprint: {
        Args: {
          p_function_name: string
          p_message: string
          p_route: string
          p_severity: string
          p_source: string
        }
        Returns: string
      }
      compute_payroll: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_run_id?: string
          p_user_id: string
        }
        Returns: {
          hours_worked: number
          is_early_out: boolean
          is_half_day: boolean
          is_holiday: boolean
          is_late: boolean
          is_missing_checkout: boolean
          is_weekly_off: boolean
          leave_type: string
          notes: string
          ot_hours: number
          payable: boolean
          status: string
          work_date: string
        }[]
      }
      consume_batch_stock: {
        Args: {
          p_branch_id: string
          p_preferred_batch_id?: string
          p_product_id: string
          p_quantity: number
          p_reference_id?: string
          p_reference_type?: string
          p_sold_by?: string
        }
        Returns: Json
      }
      consume_coupon: {
        Args: {
          p_branch_id?: string
          p_code: string
          p_idempotency_key?: string
          p_member_id: string
          p_order_total: number
        }
        Returns: Json
      }
      consume_scan_credit_if_needed: {
        Args: { _kind: string; _member_id: string }
        Returns: boolean
      }
      convert_lead_to_member: {
        Args: {
          p_branch_id: string
          p_idempotency_key?: string
          p_lead_id: string
          p_payload?: Json
        }
        Returns: Json
      }
      convert_referral: {
        Args: {
          p_idempotency_key?: string
          p_referral_id: string
          p_referred_member_id: string
          p_referred_reward_type?: string
          p_referred_reward_value?: number
          p_referrer_reward_type?: string
          p_referrer_reward_value?: number
        }
        Returns: Json
      }
      create_ai_lead: {
        Args: {
          p_branch_id: string
          p_email?: string
          p_full_name: string
          p_notes?: string
          p_phone: string
          p_source?: string
          p_tags?: string[]
          p_temperature?: string
          p_utm_campaign?: string
          p_utm_medium?: string
          p_utm_source?: string
        }
        Returns: Json
      }
      create_manual_invoice:
        | {
            Args: {
              p_branch_id: string
              p_customer_gstin?: string
              p_discount_amount?: number
              p_due_date?: string
              p_gst_rate?: number
              p_include_gst?: boolean
              p_items: Json
              p_member_id: string
              p_notes?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_branch_id: string
              p_customer_gstin?: string
              p_discount_amount?: number
              p_due_date?: string
              p_gst_inclusive?: boolean
              p_gst_rate?: number
              p_include_gst?: boolean
              p_items: Json
              p_member_id: string
              p_notes?: string
            }
            Returns: Json
          }
      create_pos_sale: {
        Args: {
          p_awaiting_payment?: boolean
          p_branch_id: string
          p_discount_amount?: number
          p_discount_code?: string
          p_discount_code_id?: string
          p_guest_email?: string
          p_guest_name?: string
          p_guest_phone?: string
          p_idempotency_key?: string
          p_items: Json
          p_member_id: string
          p_payment_method: string
          p_slip_url?: string
          p_sold_by: string
          p_transaction_id?: string
          p_wallet_applied?: number
        }
        Returns: Json
      }
      credit_member: {
        Args: {
          p_branch_id: string
          p_idempotency_key?: string
          p_member_id: string
          p_reason?: string
          p_reward_points?: number
          p_wallet_amount?: number
        }
        Returns: Json
      }
      current_active_branch: { Args: never; Returns: string }
      current_branch: { Args: never; Returns: string }
      daily_reconcile_member_access: { Args: never; Returns: undefined }
      decide_role_change_request: {
        Args: {
          p_approve: boolean
          p_decision_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      dr_get_or_create_token: { Args: never; Returns: string }
      dr_is_operational: { Args: never; Returns: boolean }
      enforce_branch_match: {
        Args: { p_branch_id: string }
        Returns: undefined
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_facility_slots: {
        Args: { p_branch_id: string; p_end_date: string; p_start_date: string }
        Returns: undefined
      }
      evaluate_member_access_state: {
        Args: {
          p_actor_user_id?: string
          p_force_sync?: boolean
          p_member_id: string
          p_reason?: string
        }
        Returns: Json
      }
      expire_wallet_balances: { Args: never; Returns: Json }
      extract_member_id_from_storage_path: {
        Args: { _path: string }
        Returns: string
      }
      freeze_membership: {
        Args: {
          p_freeze_days: number
          p_membership_id: string
          p_reason: string
        }
        Returns: Json
      }
      generate_renewal_invoices: { Args: never; Returns: undefined }
      get_ai_purpose: {
        Args: { _branch_id?: string; _purpose: string }
        Returns: {
          branch_id: string | null
          created_at: string
          description: string | null
          enabled: boolean
          extra: Json
          guards: Json
          id: string
          max_tokens: number | null
          model: string | null
          provider_id: string | null
          purpose: string
          reply_delay_seconds: number
          system_prompt: string
          temperature: number | null
          tools_allowed: string[]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ai_purposes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_howbody_public_report: {
        Args: { _report_type: string; _token: string }
        Returns: Json
      }
      get_inactive_members: {
        Args: { p_branch_id: string; p_days?: number; p_limit?: number }
        Returns: {
          avatar_url: string
          days_absent: number
          email: string
          full_name: string
          last_visit: string
          member_code: string
          member_id: string
          phone: string
        }[]
      }
      get_member_id: { Args: { _user_id: string }; Returns: string }
      get_online_users: {
        Args: { stale_minutes?: number }
        Returns: {
          avatar_url: string
          full_name: string
          last_seen_at: string
          roles: string[]
          user_id: string
        }[]
      }
      get_setting_numeric: {
        Args: { p_branch_id: string; p_default: number; p_key: string }
        Returns: number
      }
      get_staff_roles_for_branch: {
        Args: { p_branch_id: string }
        Returns: {
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      get_user_branch: { Args: { _user_id: string }; Returns: string }
      has_active_benefit: {
        Args: {
          _benefit: Database["public"]["Enums"]["benefit_type"]
          _member_id: string
        }
        Returns: boolean
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_capability: {
        Args: { _capability: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      howbody_scan_quota: {
        Args: { _kind: string; _member_id: string }
        Returns: Json
      }
      howbody_touch_device: {
        Args: { _equipment_no: string }
        Returns: undefined
      }
      is_branch_member: { Args: { p_branch_id: string }; Returns: boolean }
      is_dr_readonly: { Args: never; Returns: boolean }
      is_in_quiet_hours: { Args: { p_member_id: string }; Returns: boolean }
      issue_referral_reward: {
        Args: {
          p_actor_user_id?: string
          p_idempotency_key?: string
          p_invoice_id: string
          p_referral_id: string
          p_source?: string
        }
        Returns: Json
      }
      join_facility_waitlist: {
        Args: { p_member_id: string; p_slot_id: string }
        Returns: Json
      }
      leave_facility_waitlist: {
        Args: { p_waitlist_id: string }
        Returns: Json
      }
      log_error_event: {
        Args: {
          p_branch_id?: string
          p_context?: Json
          p_function_name?: string
          p_message: string
          p_release_sha?: string
          p_request_id?: string
          p_route?: string
          p_severity: string
          p_source: string
          p_stack?: string
          p_table_name?: string
          p_user_id?: string
        }
        Returns: string
      }
      log_member_lifecycle_event: {
        Args: {
          _actor_user_id: string
          _branch_id: string
          _entity_id: string
          _entity_type: string
          _event_type: string
          _idempotency_key: string
          _member_id: string
          _metadata?: Json
          _new_state: string
          _previous_state: string
          _reason: string
          _source: string
        }
        Returns: undefined
      }
      manages_branch: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      mark_class_attendance: {
        Args: { _attended: boolean; _booking_id: string }
        Returns: Json
      }
      mark_no_show_bookings: { Args: never; Returns: number }
      match_common_plans: {
        Args: { p_member_id: string; p_type: string }
        Returns: {
          days_per_week: number
          description: string
          difficulty: string
          duration_weeks: number
          goal: string
          match_score: number
          name: string
          target_age_max: number
          target_age_min: number
          target_gender: string
          target_goal: string
          template_id: string
        }[]
      }
      member_check_in: {
        Args: { _branch_id: string; _member_id: string; _method?: string }
        Returns: Json
      }
      member_check_out: { Args: { _member_id: string }; Returns: Json }
      member_force_check_in: {
        Args: {
          p_actor_user_id?: string
          p_branch_id: string
          p_member_id: string
          p_reason?: string
        }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalize_phone_in: { Args: { p: string }; Returns: string }
      notify_member: {
        Args: {
          p_branch_id: string
          p_category?: string
          p_message: string
          p_title: string
          p_type?: string
          p_user_id: string
        }
        Returns: undefined
      }
      onboard_member: {
        Args: {
          p_activity_level?: string
          p_allergies?: string[]
          p_avatar_storage_path?: string
          p_branch_id: string
          p_created_by?: string
          p_cuisine_preference?: string
          p_dietary_preference?: string
          p_email: string
          p_equipment_availability?: string[]
          p_fitness_goals?: string
          p_fitness_level?: string
          p_full_name: string
          p_government_id_number?: string
          p_government_id_type?: string
          p_health_conditions?: string
          p_injuries_limitations?: string
          p_phone?: string
          p_referred_by?: string
          p_schedule_welcome?: boolean
          p_source?: string
          p_user_id: string
          p_welcome_channels?: string[]
        }
        Returns: Json
      }
      payroll_adjust_item: {
        Args: { p_item_id: string; p_patch: Json; p_reason: string }
        Returns: undefined
      }
      payroll_approve_run: { Args: { p_run_id: string }; Returns: undefined }
      payroll_create_run: {
        Args: {
          p_branch_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: string
      }
      payroll_mark_paid: {
        Args: { p_item_ids: string[]; p_method: string; p_reference: string }
        Returns: undefined
      }
      payroll_process_items: {
        Args: { p_item_ids: string[] }
        Returns: undefined
      }
      payroll_review_items: {
        Args: { p_item_ids: string[] }
        Returns: undefined
      }
      payroll_summarize: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_user_id: string
        }
        Returns: {
          attendance: Json
          base: number
          ot_hours: number
        }[]
      }
      process_approval_request: {
        Args: {
          p_decision: string
          p_request_id: string
          p_review_notes?: string
        }
        Returns: Json
      }
      promote_announcement_to_campaign: {
        Args: { p_announcement_id: string }
        Returns: Json
      }
      purchase_benefit_credits: {
        Args: {
          p_branch_id?: string
          p_idempotency_key?: string
          p_member_id: string
          p_membership_id: string
          p_package_id: string
          p_payment_method?: string
          p_received_by?: string
        }
        Returns: Json
      }
      purchase_benefit_topup: {
        Args: {
          p_benefit_type_id: string
          p_branch_id?: string
          p_credits: number
          p_gst_rate?: number
          p_idempotency_key?: string
          p_member_id: string
          p_membership_id: string
          p_payment_method?: string
          p_received_by?: string
          p_unit_price: number
        }
        Returns: Json
      }
      purchase_group_membership: {
        Args: {
          p_branch_id: string
          p_discount_type?: string
          p_discount_value?: number
          p_group_name: string
          p_group_type?: string
          p_include_gst?: boolean
          p_member_ids: string[]
          p_notes?: string
          p_payment_method?: string
          p_plan_id: string
          p_received_by?: string
          p_start_date: string
        }
        Returns: Json
      }
      purchase_member_membership: {
        Args: {
          p_amount_paying?: number
          p_assign_locker_id?: string
          p_branch_id: string
          p_discount_amount?: number
          p_discount_reason?: string
          p_gst_rate?: number
          p_idempotency_key?: string
          p_include_gst?: boolean
          p_member_id: string
          p_notes?: string
          p_payment_due_date?: string
          p_payment_method?: string
          p_payment_source?: string
          p_plan_id: string
          p_received_by?: string
          p_send_reminders?: boolean
          p_start_date: string
        }
        Returns: Json
      }
      purchase_membership: {
        Args: {
          p_amount_paid?: number
          p_branch_id: string
          p_discount_amount?: number
          p_discount_reason?: string
          p_end_date: string
          p_idempotency_key: string
          p_member_id: string
          p_notes?: string
          p_payment_method?: string
          p_plan_id: string
          p_price: number
          p_start_date: string
        }
        Returns: Json
      }
      purchase_pt_package:
        | {
            Args: {
              _branch_id: string
              _idempotency_key?: string
              _member_id: string
              _package_id: string
              _payment_method?: string
              _price_paid: number
              _received_by?: string
              _trainer_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_branch_id: string
              p_idempotency_key?: string
              p_member_id: string
              p_package_id: string
              p_payment_source?: string
              p_trainer_id?: string
            }
            Returns: Json
          }
      purge_expired_otp_verifications: { Args: never; Returns: undefined }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reconcile_payments_daily: { Args: never; Returns: Json }
      record_health_ping: {
        Args: {
          p_component: string
          p_detail?: Json
          p_latency_ms?: number
          p_status: string
        }
        Returns: string
      }
      record_member_measurement: {
        Args: { p_member_id: string; p_payload: Json }
        Returns: string
      }
      record_payment: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_income_category_id?: string
          p_invoice_id: string
          p_member_id: string
          p_notes?: string
          p_payment_method: string
          p_received_by?: string
          p_transaction_id?: string
        }
        Returns: Json
      }
      redeem_coupon: {
        Args: {
          p_branch_id: string
          p_code: string
          p_idempotency_key?: string
          p_member_id: string
          p_reference_id?: string
          p_reference_type?: string
          p_subtotal: number
        }
        Returns: Json
      }
      release_coupon: {
        Args: { p_reason?: string; p_redemption_id: string }
        Returns: Json
      }
      release_locker: {
        Args: { p_assignment_id: string; p_release_date?: string }
        Returns: Json
      }
      release_whatsapp_send_lock: {
        Args: { _phone: string }
        Returns: undefined
      }
      remove_user_role: {
        Args: {
          p_reason: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user_id: string
        }
        Returns: Json
      }
      resolve_campaign_audience: {
        Args: { p_branch_id: string; p_filter: Json }
        Returns: {
          contact_id: string
          email: string
          full_name: string
          phone: string
          source_ref_id: string
          source_type: string
        }[]
      }
      resolve_campaign_audience_v2: {
        Args: { p_branch_id: string; p_filter: Json; p_window_hours?: number }
        Returns: {
          contact_id: string
          email: string
          full_name: string
          in_window: boolean
          phone: string
          source_label: string
          source_ref_id: string
          source_type: string
        }[]
      }
      resolve_gst_rate: {
        Args: { p_branch_id?: string; p_item_id?: string; p_item_type: string }
        Returns: number
      }
      resolve_member_document_url: {
        Args: { p_document_id: string; p_expires_in?: number }
        Returns: string
      }
      reverse_payment: {
        Args: { p_actor_id?: string; p_payment_id: string; p_reason: string }
        Returns: Json
      }
      reverse_trainer_commission: {
        Args: { p_payment_id: string; p_reason?: string }
        Returns: number
      }
      search_command_bookings: {
        Args: { p_branch_id?: string; p_limit?: number; search_term: string }
        Returns: {
          branch_id: string
          branch_name: string
          id: string
          kind: string
          member_id: string
          member_name: string
          related_id: string
          status: string
          title: string
          when_at: string
        }[]
      }
      search_command_invoices: {
        Args: { p_branch_id?: string; p_limit?: number; search_term: string }
        Returns: {
          amount_paid: number
          branch_id: string
          branch_name: string
          id: string
          invoice_number: string
          member_id: string
          member_name: string
          status: string
          total_amount: number
        }[]
      }
      search_command_leads: {
        Args: { p_branch_id?: string; p_limit?: number; search_term: string }
        Returns: {
          branch_id: string
          branch_name: string
          email: string
          full_name: string
          id: string
          phone: string
          status: string
          temperature: string
        }[]
      }
      search_command_members: {
        Args: { p_branch_id?: string; p_limit?: number; search_term: string }
        Returns: {
          branch_id: string
          branch_name: string
          email: string
          full_name: string
          id: string
          member_code: string
          phone: string
          status: string
        }[]
      }
      search_command_payments: {
        Args: { p_branch_id?: string; p_limit?: number; search_term: string }
        Returns: {
          amount: number
          branch_id: string
          branch_name: string
          id: string
          invoice_id: string
          invoice_number: string
          member_id: string
          member_name: string
          payment_date: string
          payment_method: string
          status: string
        }[]
      }
      search_command_tasks: {
        Args: { p_branch_id?: string; p_limit?: number; search_term: string }
        Returns: {
          assignee_name: string
          branch_id: string
          branch_name: string
          due_date: string
          id: string
          priority: string
          status: string
          title: string
        }[]
      }
      search_command_trainers: {
        Args: { p_branch_id?: string; p_limit?: number; search_term: string }
        Returns: {
          branch_id: string
          branch_name: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          phone: string
        }[]
      }
      search_members: {
        Args: { p_branch_id?: string; p_limit?: number; search_term: string }
        Returns: {
          avatar_url: string
          branch_id: string
          email: string
          full_name: string
          id: string
          member_code: string
          member_status: string
          phone: string
        }[]
      }
      set_active_branch: { Args: { p_branch_id: string }; Returns: undefined }
      set_default_ai_provider: { Args: { p_id: string }; Returns: undefined }
      set_handoff:
        | {
            Args: { _phone: string; _reason?: string; _urgency?: string }
            Returns: undefined
          }
        | {
            Args: {
              _assigned_to?: string
              _branch_id?: string
              _phone: string
              _reason?: string
            }
            Returns: Json
          }
      settle_payment: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_gateway_payment_id?: string
          p_idempotency_key?: string
          p_income_category_id?: string
          p_invoice_id: string
          p_member_id: string
          p_metadata?: Json
          p_notes?: string
          p_payment_method: string
          p_payment_source?: string
          p_payment_transaction_id?: string
          p_received_by?: string
          p_transaction_id?: string
        }
        Returns: Json
      }
      should_send_communication:
        | {
            Args: { p_category: string; p_channel: string; p_member_id: string }
            Returns: {
              allowed: boolean
              reason: string
            }[]
          }
        | {
            Args: {
              p_branch_id?: string
              p_category: string
              p_channel: string
              p_member_id: string
            }
            Returns: {
              allowed: boolean
              reason: string
            }[]
          }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      staff_check_in:
        | {
            Args: { p_branch_id: string; p_notes?: string; p_user_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_branch_id: string
              p_notes?: string
              p_source?: string
              p_user_id: string
            }
            Returns: string
          }
      staff_check_out:
        | { Args: { p_user_id: string }; Returns: Json }
        | { Args: { p_notes?: string; p_user_id: string }; Returns: string }
      touch_presence: { Args: never; Returns: undefined }
      transition_member_lifecycle: {
        Args: { p_member_id: string; p_reason?: string; p_to_state: string }
        Returns: Json
      }
      try_whatsapp_send_lock: {
        Args: { _phone: string; _ttl_seconds?: number }
        Returns: boolean
      }
      user_visible_branch_ids: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      user_visible_branches: {
        Args: { _uid: string }
        Returns: {
          branch_id: string
        }[]
      }
      validate_class_booking: {
        Args: { _class_id: string; _member_id: string }
        Returns: Json
      }
      validate_coupon: {
        Args: { p_branch_id: string; p_code: string; p_subtotal: number }
        Returns: Json
      }
      validate_member_checkin: {
        Args: { _branch_id: string; _member_id: string }
        Returns: Json
      }
      void_payment: {
        Args: { p_payment_id: string; p_reason?: string }
        Returns: Json
      }
      void_trainer_commission: {
        Args: { p_payment_id: string; p_reason?: string; p_void_ratio?: number }
        Returns: Json
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "manager" | "trainer" | "staff" | "member"
      approval_status: "pending" | "approved" | "rejected"
      approval_type:
        | "membership_freeze"
        | "membership_transfer"
        | "refund"
        | "discount"
        | "complimentary"
        | "expense"
        | "contract"
        | "comp_gift"
        | "branch_transfer"
      benefit_booking_status:
        | "booked"
        | "confirmed"
        | "attended"
        | "no_show"
        | "cancelled"
      benefit_type:
        | "gym_access"
        | "pool_access"
        | "sauna_access"
        | "steam_access"
        | "group_classes"
        | "pt_sessions"
        | "locker"
        | "towel"
        | "parking"
        | "guest_pass"
        | "other"
        | "ice_bath"
        | "yoga_class"
        | "crossfit_class"
        | "spa_access"
        | "sauna_session"
        | "cardio_area"
        | "functional_training"
        | "body_scan"
        | "posture_scan"
      class_booking_status:
        | "booked"
        | "attended"
        | "cancelled"
        | "no_show"
        | "waitlisted"
      contract_status: "draft" | "active" | "completed" | "terminated"
      equipment_status:
        | "operational"
        | "maintenance"
        | "out_of_order"
        | "retired"
      frequency_type:
        | "daily"
        | "weekly"
        | "monthly"
        | "unlimited"
        | "per_membership"
      gender_type: "male" | "female" | "other"
      invoice_status:
        | "draft"
        | "pending"
        | "paid"
        | "partial"
        | "overdue"
        | "cancelled"
        | "refunded"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "negotiation"
        | "converted"
        | "lost"
      locker_status: "available" | "assigned" | "maintenance" | "reserved"
      member_status: "active" | "inactive" | "suspended" | "blacklisted"
      membership_status:
        | "pending"
        | "active"
        | "frozen"
        | "expired"
        | "cancelled"
        | "transferred"
      messaging_platform: "whatsapp" | "instagram" | "messenger"
      no_show_policy: "mark_used" | "allow_reschedule" | "charge_penalty"
      order_status:
        | "pending"
        | "confirmed"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "returned"
      payment_method:
        | "cash"
        | "card"
        | "bank_transfer"
        | "wallet"
        | "upi"
        | "cheque"
        | "other"
      payment_status: "pending" | "completed" | "failed" | "refunded"
      payment_transaction_status:
        | "created"
        | "pending_confirmation"
        | "settled"
        | "failed"
        | "voided"
      pt_package_status: "active" | "expired" | "exhausted" | "cancelled"
      pt_session_status:
        | "scheduled"
        | "completed"
        | "cancelled"
        | "no_show"
        | "rescheduled"
      referral_lifecycle_status:
        | "invited"
        | "joined"
        | "purchased"
        | "converted"
        | "rewarded"
        | "claimed"
      reminder_delivery_status:
        | "scheduled"
        | "sending"
        | "sent"
        | "failed"
        | "skipped"
        | "suppressed"
        | "deduped"
        | "queued"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "pending" | "in_progress" | "completed" | "cancelled"
      wallet_txn_type:
        | "credit"
        | "debit"
        | "refund"
        | "reward"
        | "referral"
        | "adjustment"
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
      app_role: ["owner", "admin", "manager", "trainer", "staff", "member"],
      approval_status: ["pending", "approved", "rejected"],
      approval_type: [
        "membership_freeze",
        "membership_transfer",
        "refund",
        "discount",
        "complimentary",
        "expense",
        "contract",
        "comp_gift",
        "branch_transfer",
      ],
      benefit_booking_status: [
        "booked",
        "confirmed",
        "attended",
        "no_show",
        "cancelled",
      ],
      benefit_type: [
        "gym_access",
        "pool_access",
        "sauna_access",
        "steam_access",
        "group_classes",
        "pt_sessions",
        "locker",
        "towel",
        "parking",
        "guest_pass",
        "other",
        "ice_bath",
        "yoga_class",
        "crossfit_class",
        "spa_access",
        "sauna_session",
        "cardio_area",
        "functional_training",
        "body_scan",
        "posture_scan",
      ],
      class_booking_status: [
        "booked",
        "attended",
        "cancelled",
        "no_show",
        "waitlisted",
      ],
      contract_status: ["draft", "active", "completed", "terminated"],
      equipment_status: [
        "operational",
        "maintenance",
        "out_of_order",
        "retired",
      ],
      frequency_type: [
        "daily",
        "weekly",
        "monthly",
        "unlimited",
        "per_membership",
      ],
      gender_type: ["male", "female", "other"],
      invoice_status: [
        "draft",
        "pending",
        "paid",
        "partial",
        "overdue",
        "cancelled",
        "refunded",
      ],
      lead_status: [
        "new",
        "contacted",
        "qualified",
        "negotiation",
        "converted",
        "lost",
      ],
      locker_status: ["available", "assigned", "maintenance", "reserved"],
      member_status: ["active", "inactive", "suspended", "blacklisted"],
      membership_status: [
        "pending",
        "active",
        "frozen",
        "expired",
        "cancelled",
        "transferred",
      ],
      messaging_platform: ["whatsapp", "instagram", "messenger"],
      no_show_policy: ["mark_used", "allow_reschedule", "charge_penalty"],
      order_status: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "returned",
      ],
      payment_method: [
        "cash",
        "card",
        "bank_transfer",
        "wallet",
        "upi",
        "cheque",
        "other",
      ],
      payment_status: ["pending", "completed", "failed", "refunded"],
      payment_transaction_status: [
        "created",
        "pending_confirmation",
        "settled",
        "failed",
        "voided",
      ],
      pt_package_status: ["active", "expired", "exhausted", "cancelled"],
      pt_session_status: [
        "scheduled",
        "completed",
        "cancelled",
        "no_show",
        "rescheduled",
      ],
      referral_lifecycle_status: [
        "invited",
        "joined",
        "purchased",
        "converted",
        "rewarded",
        "claimed",
      ],
      reminder_delivery_status: [
        "scheduled",
        "sending",
        "sent",
        "failed",
        "skipped",
        "suppressed",
        "deduped",
        "queued",
      ],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["pending", "in_progress", "completed", "cancelled"],
      wallet_txn_type: [
        "credit",
        "debit",
        "refund",
        "reward",
        "referral",
        "adjustment",
      ],
    },
  },
} as const
