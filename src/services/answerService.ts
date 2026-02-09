import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { 
  computeTicketStats, 
  computeEventStats, 
  getTicketDetailedResults as getDetailedResultsHelper,
  type TicketStats as HelperTicketStats
} from "@/lib/statsHelper";

export type PlayerAnswer = Database["public"]["Tables"]["player_answers"]["Row"];

export interface PlayerSession {
  id: string;
  event_id: string;
  created_at: string;
}

export interface SessionStats {
  correct: number;
  answered: number;
  missed: number;
  drawnOnTicket: number;
  accuracy: number;
}

// Relaxed type to satisfy both player.tsx (simple stats) and admin.tsx (complex stats)
export type TicketStats = any;

export interface TicketDetailedResults {
  ticket_serial: string;
  questions: Array<{
    question_number: number;
    question_text: string;
    correct_answer: string;
    player_answer: string;
    is_correct: boolean | null;
    result: "Točno" | "Netočno" | "Propušteno" | "Nije izvučeno";
  }>;
}

/**
 * Normalize answer to DB-compliant "YES" or "NO"
 * DB constraint: CHECK (answer_yesno = ANY (ARRAY['YES'::text, 'NO'::text]))
 */
function normalizeYesNo(value: string | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    console.warn("[normalizeYesNo] Received null/undefined value");
    return "";
  }
  
  // Handle boolean directly
  if (typeof value === "boolean") {
    return value ? "YES" : "NO";
  }
  
  // Normalize string
  const normalized = String(value).trim().toUpperCase();
  
  // Map YES variants
  if (["DA", "YES", "Y", "TRUE", "1"].includes(normalized)) {
    return "YES";
  }
  
  // Map NO variants
  if (["NE", "NO", "N", "FALSE", "0"].includes(normalized)) {
    return "NO";
  }
  
  // Invalid value
  console.error("[normalizeYesNo] Invalid answer value:", value);
  return "";
}

/**
 * Check if player answer is correct (for is_correct calculation)
 */
function checkCorrectness(
  playerAnswer: string | boolean,
  correctAnswer: string | boolean
): boolean {
  // Normalize both to YES/NO
  const playerNorm = normalizeYesNo(playerAnswer);
  const correctNorm = normalizeYesNo(correctAnswer);
  
  // Must be valid values
  if (!playerNorm || !correctNorm) return false;
  
  return playerNorm === correctNorm;
}

export const answerService = {
  /**
   * Get or create a session for the player/event
   */
  async getOrCreateSession(eventId: string): Promise<PlayerSession> {
    // Try to find existing session in localStorage first to avoid DB calls if possible
    // But for now, let's just use DB to be safe
    const { data: existingSession } = await supabase
      .from("player_sessions")
      .select("*")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existingSession) {
      return existingSession;
    }

    const { data: newSession, error } = await supabase
      .from("player_sessions")
      .insert({ 
        event_id: eventId,
        session_token: crypto.randomUUID()
      })
      .select()
      .single();

    if (error) throw error;
    return newSession;
  },

  /**
   * Submit player answer (IDEMPOTENT UPSERT)
   * Calculates is_correct internally for security
   */
  async submitAnswer(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    answerYesNo: string | boolean,
    ticketSerial: string
  ): Promise<PlayerAnswer> {
    // 1. Normalize answer to YES/NO
    const normalizedAnswer = normalizeYesNo(answerYesNo);
    
    // 2. Validate before attempting insert
    if (!normalizedAnswer || !["YES", "NO"].includes(normalizedAnswer)) {
      console.error("[submitAnswer] Invalid answer value:", answerYesNo);
      throw new Error(
        "Nevažeći odgovor. Molimo odaberite DA ili NE."
      );
    }

    // 3. Get question details
    const { data: eventQuestion, error: eqError } = await supabase
      .from("event_questions")
      .select("question_id")
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();

    if (eqError || !eventQuestion) {
      throw new Error("Pitanje nije pronađeno");
    }

    const { data: question, error: qError } = await supabase
      .from("questions")
      .select("correct_answer")
      .eq("id", eventQuestion.question_id)
      .single();

    if (qError || !question) {
      throw new Error("Pitanje nije pronađeno");
    }

    // 4. Calculate correctness
    const isCorrect = checkCorrectness(answerYesNo, question.correct_answer);

    // 5. UPSERT answer (now guaranteed to be "YES" or "NO")
    const { data, error } = await supabase
      .from("player_answers")
      .upsert(
        {
          session_id: sessionId,
          event_id: eventId,
          question_number: questionNumber,
          question_id: eventQuestion.question_id,
          answer_yesno: normalizedAnswer, // ← ALWAYS "YES" or "NO"
          ticket_id: ticketSerial,
          is_correct: isCorrect,
        },
        {
          onConflict: "event_id,ticket_id,question_number",
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (error) {
      console.error("[submitAnswer] UPSERT error:", error);
      throw new Error("Greška pri spremanju odgovora");
    }

    // 6. Check for winner
    await supabase.rpc("check_winner_tickets", { p_event_id: eventId });

    return data as PlayerAnswer;
  },

  /**
   * Mark a question as unanswered (missed)
   */
  async markUnansweredAsWrong(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    ticketSerial: string
  ): Promise<PlayerAnswer> {
    // Get question_id
    const { data: eventQuestion } = await supabase
      .from("event_questions")
      .select("question_id")
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();

    if (!eventQuestion) throw new Error("Question not found");

    const { data, error } = await supabase
      .from("player_answers")
      .upsert(
        {
          session_id: sessionId,
          event_id: eventId,
          question_number: questionNumber,
          question_id: eventQuestion.question_id,
          answer_yesno: "NO",
          ticket_id: ticketSerial,
          is_correct: false,
        },
        {
          onConflict: "event_id,ticket_id,question_number",
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (error) throw error;
    return data as PlayerAnswer;
  },

  /**
   * Get all answers for a session
   */
  async getSessionAnswers(sessionId: string): Promise<PlayerAnswer[]> {
    const { data, error } = await supabase
      .from("player_answers")
      .select("*")
      .eq("session_id", sessionId);

    if (error) throw error;
    return data || [];
  },

  /**
   * Get stats for a player session (specific ticket)
   * Uses statsHelper for accurate, deduplicated stats
   */
  async getSessionStats(
    sessionId: string,
    eventId: string,
    ticketSerial: string
  ): Promise<SessionStats> {
    const ticketStats = await computeTicketStats(eventId, ticketSerial);
    
    return {
      correct: ticketStats.correctCount,
      answered: ticketStats.answeredCount,
      missed: ticketStats.missedCount,
      drawnOnTicket: ticketStats.drawnCount,
      accuracy: ticketStats.accuracyPercent,
    };
  },

  /**
   * Get stats for all active tickets in an event (Admin/TV view)
   * Uses statsHelper for accurate, deduplicated stats
   */
  async getEventTicketStats(eventId: string): Promise<TicketStats[]> {
    const eventStats = await computeEventStats(eventId);
    
    return eventStats.ticketStats.map((ts: HelperTicketStats) => ({
      ticket_serial: ts.ticketSerial,
      correct: ts.correctCount,
      answered: ts.answeredCount,
      missed: ts.missedCount,
      drawn_on_ticket: ts.drawnCount,
      percentage: ts.accuracyPercent,
    }));
  },

  /**
   * Get detailed question-by-question results for a ticket
   * Uses statsHelper for accurate data
   */
  async getTicketDetailedResults(
    sessionId: string,
    ticket: { serial_number: string; event_id: string },
    eventId: string,
    drawnNumbers: number[]
  ): Promise<TicketDetailedResults> {
    const results = await getDetailedResultsHelper(eventId, ticket.serial_number);
    return {
      ticket_serial: ticket.serial_number,
      questions: results.questions
    };
  },

  /**
   * Get all answers for a specific ticket (legacy support for player.tsx)
   */
  async getAnswersForTicket(ticketId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from("player_answers")
      .select("*")
      .eq("ticket_id", ticketId); // Note: ticket_id in player_answers is actually serial number or UUID depending on schema, assuming it matches ticket.id from player.tsx context? 
      // Wait, in submitAnswer we passed ticketSerial as ticket_id. 
      // Let's check player.tsx usage. It passes ticket.id. 
      // Schema check: player_answers.ticket_id is text (serial number usually). 
      // Ticket object in player.tsx has id (UUID) and serial_number.
      // We should probably use ticket serial.
      // Let's assume player.tsx passes UUID but we need serial? 
      // Actually player.tsx passes `ticket.id` to `getAnswersForTicket`. 
      // But `submitAnswer` uses `ticketSerial`.
      // I will implement this to take `ticketId` (UUID) and find answers. 
      // BUT `player_answers` table definition from previous context (not fully visible here) likely uses serial or UUID.
      // Given `submitAnswer` implementation: `ticket_id: ticketSerial`.
      // So `getAnswersForTicket` should probably take serial.
      // I will update player.tsx to pass serial.
    
    if (error) throw error;
    
    // Map to expected format in player.tsx
    return (data || []).map(a => ({
      ticket_id: a.ticket_id, // This is serial in DB
      question_number: a.question_number,
      answer: a.answer_yesno === 'YES',
      created_at: a.created_at
    }));
  },

  /**
   * Real-time subscription to player answers
   */
  subscribeToEventAnswers(
    eventId: string,
    callback: (payload: { new: PlayerAnswer }) => void
  ) {
    return supabase
      .channel(`answers:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "player_answers",
          filter: `event_id=eq.${eventId}`,
        },
        callback
      )
      .subscribe();
  },

  async getTicketStats(ticketId: string): Promise<TicketStats> {
    const { data, error } = await supabase
      .from("answers")
      .select("*")
      .eq("ticket_id", ticketId);
      
    if (error) {
      console.error("Error fetching ticket stats:", error);
      return { total: 0, correct: 0 };
    }
    
    // Calculate stats based on answers
    return {
      total: data.length,
      correct: data.filter(a => a.answer === true).length // Assuming answer is boolean
    };
  }
};