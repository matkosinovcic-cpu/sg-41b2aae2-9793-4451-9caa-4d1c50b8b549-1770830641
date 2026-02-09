 
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
      answers: {
        Row: {
          answer: boolean
          created_at: string | null
          id: string
          question_number: number
          ticket_id: string
        }
        Insert: {
          answer: boolean
          created_at?: string | null
          id?: string
          question_number: number
          ticket_id: string
        }
        Update: {
          answer?: boolean
          created_at?: string | null
          id?: string
          question_number?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      draw_sessions: {
        Row: {
          created_at: string
          current_index: number | null
          current_number: number | null
          current_question_id: string | null
          current_question_number: number | null
          draw_count: number
          drawn_numbers: number[]
          finished_at: string | null
          id: string
          interval_seconds: number | null
          jackpot_amount: number | null
          jackpot_rollover: boolean | null
          last_draw_at: string | null
          mode: string
          name: string
          question_open_until: string | null
          question_order: Json | null
          round_number: number | null
          seed: number | null
          started_at: string | null
          status: string
          total_questions: number
          updated_at: string
          win_threshold: number | null
        }
        Insert: {
          created_at?: string
          current_index?: number | null
          current_number?: number | null
          current_question_id?: string | null
          current_question_number?: number | null
          draw_count?: number
          drawn_numbers?: number[]
          finished_at?: string | null
          id?: string
          interval_seconds?: number | null
          jackpot_amount?: number | null
          jackpot_rollover?: boolean | null
          last_draw_at?: string | null
          mode?: string
          name: string
          question_open_until?: string | null
          question_order?: Json | null
          round_number?: number | null
          seed?: number | null
          started_at?: string | null
          status?: string
          total_questions?: number
          updated_at?: string
          win_threshold?: number | null
        }
        Update: {
          created_at?: string
          current_index?: number | null
          current_number?: number | null
          current_question_id?: string | null
          current_question_number?: number | null
          draw_count?: number
          drawn_numbers?: number[]
          finished_at?: string | null
          id?: string
          interval_seconds?: number | null
          jackpot_amount?: number | null
          jackpot_rollover?: boolean | null
          last_draw_at?: string | null
          mode?: string
          name?: string
          question_open_until?: string | null
          question_order?: Json | null
          round_number?: number | null
          seed?: number | null
          started_at?: string | null
          status?: string
          total_questions?: number
          updated_at?: string
          win_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "draw_sessions_current_question_id_fkey"
            columns: ["current_question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      event_questions: {
        Row: {
          draw_session_id: string | null
          drawn: boolean | null
          drawn_at: string | null
          event_id: string
          id: string
          question_id: string
          question_number: number
        }
        Insert: {
          draw_session_id?: string | null
          drawn?: boolean | null
          drawn_at?: string | null
          event_id: string
          id?: string
          question_id: string
          question_number: number
        }
        Update: {
          draw_session_id?: string | null
          drawn?: boolean | null
          drawn_at?: string | null
          event_id?: string
          id?: string
          question_id?: string
          question_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_questions_draw_session_id_fkey"
            columns: ["draw_session_id"]
            isOneToOne: false
            referencedRelation: "draw_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_questions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          continue_after_winner: boolean | null
          created_at: string | null
          current_drawn_number: number | null
          current_question_number: number | null
          draw_mode: string
          draw_session_id: string | null
          drawn_numbers: number[] | null
          id: string
          local_prize_fund: number | null
          name: string
          question_open_until: string | null
          status: string
          updated_at: string | null
          venue_id: string | null
          venue_slug: string | null
          winner_ticket_id: string | null
        }
        Insert: {
          continue_after_winner?: boolean | null
          created_at?: string | null
          current_drawn_number?: number | null
          current_question_number?: number | null
          draw_mode?: string
          draw_session_id?: string | null
          drawn_numbers?: number[] | null
          id?: string
          local_prize_fund?: number | null
          name: string
          question_open_until?: string | null
          status?: string
          updated_at?: string | null
          venue_id?: string | null
          venue_slug?: string | null
          winner_ticket_id?: string | null
        }
        Update: {
          continue_after_winner?: boolean | null
          created_at?: string | null
          current_drawn_number?: number | null
          current_question_number?: number | null
          draw_mode?: string
          draw_session_id?: string | null
          drawn_numbers?: number[] | null
          id?: string
          local_prize_fund?: number | null
          name?: string
          question_open_until?: string | null
          status?: string
          updated_at?: string | null
          venue_id?: string | null
          venue_slug?: string | null
          winner_ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_draw_session_id_fkey"
            columns: ["draw_session_id"]
            isOneToOne: false
            referencedRelation: "draw_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      player_answers: {
        Row: {
          answer_yesno: string
          created_at: string | null
          event_id: string
          id: string
          is_correct: boolean
          question_id: string
          question_number: number
          session_id: string
          ticket_id: string | null
        }
        Insert: {
          answer_yesno: string
          created_at?: string | null
          event_id: string
          id?: string
          is_correct: boolean
          question_id: string
          question_number: number
          session_id: string
          ticket_id?: string | null
        }
        Update: {
          answer_yesno?: string
          created_at?: string | null
          event_id?: string
          id?: string
          is_correct?: boolean
          question_id?: string
          question_number?: number
          session_id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_answers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "player_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      player_sessions: {
        Row: {
          created_at: string | null
          event_id: string
          id: string
          player_id: string | null
          session_token: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          player_id?: string | null
          session_token: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_id?: string
          id?: string
          player_id?: string | null
          session_token?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_sessions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string | null
          email: string
          id: string
          last_seen_at: string | null
          nickname: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          last_seen_at?: string | null
          nickname: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          last_seen_at?: string | null
          nickname?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      questions: {
        Row: {
          correct_answer: boolean
          created_at: string | null
          id: string
          question_type: string | null
          text: string
        }
        Insert: {
          correct_answer: boolean
          created_at?: string | null
          id?: string
          question_type?: string | null
          text: string
        }
        Update: {
          correct_answer?: boolean
          created_at?: string | null
          id?: string
          question_type?: string | null
          text?: string
        }
        Relationships: []
      }
      ticket_questions: {
        Row: {
          id: string
          question_number: number
          ticket_id: string
        }
        Insert: {
          id?: string
          question_number: number
          ticket_id: string
        }
        Update: {
          id?: string
          question_number?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_questions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          claimed_at: string | null
          created_at: string | null
          event_id: string
          id: string
          is_winner: boolean | null
          player_id: string | null
          serial_number: string
          session_id: string | null
          ticket_numbers: number[] | null
          venue_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string | null
          event_id: string
          id?: string
          is_winner?: boolean | null
          player_id?: string | null
          serial_number: string
          session_id?: string | null
          ticket_numbers?: number[] | null
          venue_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string | null
          event_id?: string
          id?: string
          is_winner?: boolean | null
          player_id?: string | null
          serial_number?: string
          session_id?: string | null
          ticket_numbers?: number[] | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "player_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_winner_tickets: {
        Args: { p_event_id: string }
        Returns: {
          ticket_id: string
          ticket_serial: string
        }[]
      }
      claim_free_tickets: {
        Args: { p_email: string; p_limit?: number; p_nickname?: string }
        Returns: Json
      }
      claim_free_tickets_v2: {
        Args: {
          p_email: string
          p_limit?: number
          p_nickname: string
          p_venue_id: string
        }
        Returns: Json
      }
      claim_free_tickets_v3: {
        Args: {
          p_email: string
          p_event_id: string
          p_limit?: number
          p_nickname: string
          p_venue_id: string
        }
        Returns: Json
      }
      draw_next_number: {
        Args: { p_event_id: string }
        Returns: {
          draw_count: number
          drawn_numbers: number[]
          message: string
          new_number: number
          success: boolean
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
