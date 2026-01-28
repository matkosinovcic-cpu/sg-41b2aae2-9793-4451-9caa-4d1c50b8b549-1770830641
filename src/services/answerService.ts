import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { 
  computeTicketStats, 
  computeEventStats, 
  getTicketDetailedResults as getDetailedResultsHelper,
  type TicketStats
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

export interface TicketStats {
  ticket_serial: string;
  correct: number;
  answered: number;
  missed: number;
  drawn_on_ticket: number;
  percentage: number;
}

export interface TicketDetailedResults {
  ticket_serial: string;
  questions: Array<{
    question_number: number;
    question_text: string;
    correct_answer: string;
    player_answer: string;
    is_correct: boolean | null; // null if not answered
    result: "Točno" | "Netočno" | "Propušteno" | "Nije izvučeno";
  }>;
}

// Helper to normalize answers
function normalizeAnswerValue(value: string | boolean | null): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "DA" : "NE";
  return String(value).trim().toUpperCase();
}

function checkCorrectness(playerAnswer: string | boolean, correctAnswer: string | boolean): boolean {
  const normPlayer = normalizeAnswerValue(playerAnswer);
  const normCorrect = normalizeAnswerValue(correctAnswer);
  
  // Handle variations
  const trueValues = ["DA", "YES", "Y", "TRUE", "1"];
  const falseValues = ["NE", "NO", "N", "FALSE", "0"];
  
  const isPlayerTrue = trueValues.includes(normPlayer);
  const isPlayerFalse = falseValues.includes(normPlayer);
  
  const isCorrectTrue = trueValues.includes(normCorrect);
  const isCorrectFalse = falseValues.includes(normCorrect);
  
  if (isCorrectTrue) return isPlayerTrue;
  if (isCorrectFalse) return isPlayerFalse;
  
  return normPlayer === normCorrect;
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
    console.log("[answerService] Submitting answer:", {
      sessionId,
      eventId,
      questionNumber,
      answerYesNo,
      ticketSerial,
    });

    // 1. Get question_id from event_questions
    const { data: eventQuestion, error: eqError } = await supabase
      .from("event_questions")
      .select("question_id")
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();

    if (eqError || !eventQuestion) throw new Error("Event question not found");

    // 2. Get correct answer from questions
    const { data: question, error: qError } = await supabase
      .from("questions")
      .select("correct_answer")
      .eq("id", eventQuestion.question_id)
      .single();

    if (qError || !question) throw new Error("Question not found");

    // 3. Calculate correctness
    const isCorrect = checkCorrectness(answerYesNo, question.correct_answer);
    const answerString = normalizeAnswerValue(answerYesNo);

    // 4. UPSERT answer
    const { data, error } = await supabase
      .from("player_answers")
      .upsert(
        {
          session_id: sessionId,
          event_id: eventId,
          question_number: questionNumber,
          question_id: eventQuestion.question_id,
          answer_yesno: answerString,
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

    if (error) throw error;

    // 5. Check for winner
    try {
       await supabase.rpc("check_winner_tickets", { p_event_id: eventId });
    } catch (e) {
      console.error("Winner check failed:", e);
    }

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
          answer_yesno: "NO", // Default for missed
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
  async getEventTicketStats(eventId: string): Promise<Array<{
    ticket_serial: string;
    correct: number;
    answered: number;
    drawnOnTicket: number;
    accuracy: number;
  }>> {
    const eventStats = await computeEventStats(eventId);
    
    return eventStats.ticketStats.map(ts => ({
      ticket_serial: ts.ticketSerial,
      correct: ts.correctCount,
      answered: ts.answeredCount,
      drawnOnTicket: ts.drawnCount,
      accuracy: ts.accuracyPercent,
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
    return results;
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
  }
};