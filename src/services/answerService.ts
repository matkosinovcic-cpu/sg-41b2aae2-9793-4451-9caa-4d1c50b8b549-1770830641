import { supabase } from "@/integrations/supabase/client";
import { eventService } from "./eventService";

export interface PlayerSession {
  id: string;
  event_id: string;
  session_token: string;
  created_at: string;
}

export interface PlayerAnswer {
  id: string;
  session_id: string;
  event_id: string;
  question_number: number;
  answer_yesno: string;
  is_correct: boolean;
  created_at: string;
}

export interface TicketStats {
  ticket_serial: string;
  correct: number;
  answered: number;
  total: number;
  percentage: number;
}

export interface SessionStats {
  total_correct: number;
  total_answered: number;
  total_questions: number;
  ticket_stats: TicketStats[];
}

/**
 * Normalize any value to standard YES/NO format
 * Handles: strings (DA/NE/YES/NO), booleans, numbers, etc.
 */
function normalizeYesNo(value: any): string | null {
  if (value === null || value === undefined) return null;
  
  const str = String(value).trim().toUpperCase();
  
  // YES variations
  if (["DA", "YES", "Y", "TRUE", "1"].includes(str)) return "YES";
  
  // NO variations
  if (["NE", "NO", "N", "FALSE", "0"].includes(str)) return "NO";
  
  return null;
}

export const answerService = {
  /**
   * Get or create a player session for the current device
   */
  async getOrCreateSession(eventId: string): Promise<PlayerSession> {
    let sessionToken = localStorage.getItem("player_session_token");

    if (!sessionToken) {
      sessionToken = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem("player_session_token", sessionToken);
    }

    const { data: existingSession, error: fetchError } = await supabase
      .from("player_sessions")
      .select("*")
      .eq("event_id", eventId)
      .eq("session_token", sessionToken)
      .single();

    if (existingSession && !fetchError) {
      return existingSession as PlayerSession;
    }

    const { data: newSession, error: createError } = await supabase
      .from("player_sessions")
      .insert({
        event_id: eventId,
        session_token: sessionToken,
      })
      .select()
      .single();

    if (createError) throw createError;
    return newSession as PlayerSession;
  },

  /**
   * Submit an answer for a question
   * CRITICAL: Triggers winner check after successful submission
   */
  async submitAnswer(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    answerYesNo: string,
    correctAnswer: any
  ): Promise<PlayerAnswer> {
    const { data: existingAnswer } = await supabase
      .from("player_answers")
      .select("*")
      .eq("session_id", sessionId)
      .eq("question_number", questionNumber)
      .single();

    if (existingAnswer) {
      throw new Error("Vec si odgovorio na ovo pitanje");
    }

    // Normalize both user answer and correct answer
    const normalizedUserAnswer = normalizeYesNo(answerYesNo);
    const normalizedCorrectAnswer = normalizeYesNo(correctAnswer);

    // Validate correct answer exists
    if (!normalizedCorrectAnswer) {
      throw new Error("Pitanje nema ispravan odgovor u bazi");
    }

    // Validate user answer
    if (!normalizedUserAnswer) {
      throw new Error("Neispravan odgovor");
    }

    // Compare normalized answers
    const isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;

    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        answer_yesno: normalizedUserAnswer,
        is_correct: isCorrect,
      })
      .select()
      .single();

    if (error) throw error;

    // CRITICAL: Check for winner after each answer
    try {
      await eventService.checkForWinner(eventId);
    } catch (winnerError) {
      console.error("Winner check failed:", winnerError);
      // Don't throw - answer was recorded successfully
    }

    return data as PlayerAnswer;
  },

  /**
   * Mark unanswered question as wrong (for timeout handling)
   */
  async markUnansweredAsWrong(
    sessionId: string,
    eventId: string,
    questionNumber: number
  ): Promise<PlayerAnswer | null> {
    // Check if already answered
    const { data: existingAnswer } = await supabase
      .from("player_answers")
      .select("*")
      .eq("session_id", sessionId)
      .eq("question_number", questionNumber)
      .single();

    if (existingAnswer) {
      return null; // Already answered, skip
    }

    // Insert as wrong answer with null answer
    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        answer_yesno: "NO", // Default value for unanswered
        is_correct: false,
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to mark unanswered question:", error);
      return null;
    }
    return data as PlayerAnswer;
  },

  /**
   * Get all answers for a session
   */
  async getSessionAnswers(sessionId: string): Promise<PlayerAnswer[]> {
    const { data, error } = await supabase
      .from("player_answers")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data as PlayerAnswer[]) || [];
  },

  /**
   * Calculate statistics for a player session
   * CRITICAL: Always calculate out of 15 questions per ticket
   */
  async getSessionStats(
    sessionId: string,
    tickets: Array<{ id: string; serial_number: string; ticket_questions: Array<{ question_number: number }> }>
  ): Promise<SessionStats> {
    const answers = await this.getSessionAnswers(sessionId);

    const totalCorrect = answers.filter((a) => a.is_correct).length;
    const totalAnswered = answers.length;
    
    // Total questions = sum of all ticket questions (each ticket has exactly 15)
    const totalQuestions = tickets.length * 15;

    const ticketStats: TicketStats[] = tickets.map((ticket) => {
      const ticketQuestionNumbers = ticket.ticket_questions.map((tq) => tq.question_number);

      const ticketAnswers = answers.filter((answer) =>
        ticketQuestionNumbers.includes(answer.question_number)
      );

      const correct = ticketAnswers.filter((a) => a.is_correct).length;
      const answered = ticketAnswers.length;
      
      // CRITICAL: Each ticket ALWAYS has exactly 15 questions
      const total = 15;
      const percentage = Math.round((correct / total) * 100);

      return {
        ticket_serial: ticket.serial_number,
        correct,
        answered,
        total,
        percentage,
      };
    });

    return {
      total_correct: totalCorrect,
      total_answered: totalAnswered,
      total_questions: totalQuestions,
      ticket_stats: ticketStats,
    };
  },

  /**
   * Get all answers for an event (for admin view)
   */
  async getEventAnswers(eventId: string): Promise<PlayerAnswer[]> {
    const { data, error } = await supabase
      .from("player_answers")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data as PlayerAnswer[]) || [];
  },

  /**
   * Get statistics for all tickets in an event (for admin view)
   * CRITICAL: Always calculate out of 15 questions per ticket
   */
  async getEventTicketStats(eventId: string): Promise<TicketStats[]> {
    const { data: tickets, error: ticketsError } = await supabase
      .from("tickets")
      .select(`
        id,
        serial_number,
        ticket_questions (
          question_number
        )
      `)
      .eq("event_id", eventId);

    if (ticketsError) throw ticketsError;

    const { data: sessions, error: sessionsError } = await supabase
      .from("player_sessions")
      .select("id")
      .eq("event_id", eventId);

    if (sessionsError) throw sessionsError;

    const sessionIds = sessions.map((s) => s.id);

    if (sessionIds.length === 0) {
      return tickets.map((t) => ({
        ticket_serial: t.serial_number,
        correct: 0,
        answered: 0,
        total: 15,
        percentage: 0,
      }));
    }

    const { data: answers, error: answersError } = await supabase
      .from("player_answers")
      .select("*")
      .eq("event_id", eventId)
      .in("session_id", sessionIds);

    if (answersError) throw answersError;

    const ticketStats: TicketStats[] = tickets.map((ticket: any) => {
      const ticketQuestionNumbers = ticket.ticket_questions.map((tq: any) => tq.question_number);

      const ticketAnswers = answers.filter((answer: any) =>
        ticketQuestionNumbers.includes(answer.question_number)
      );

      const correct = ticketAnswers.filter((a: any) => a.is_correct).length;
      const answered = ticketAnswers.length;
      
      // CRITICAL: Each ticket ALWAYS has exactly 15 questions
      const total = 15;
      const percentage = Math.round((correct / total) * 100);

      return {
        ticket_serial: ticket.serial_number,
        correct,
        answered,
        total,
        percentage,
      };
    });

    return ticketStats.filter((stat) => stat.answered > 0);
  },

  /**
   * Subscribe to answer changes for real-time updates
   */
  subscribeToEventAnswers(
    eventId: string,
    callback: (payload: any) => void
  ) {
    return supabase
      .channel(`answers_${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "player_answers",
          filter: `event_id=eq.${eventId}`,
        },
        callback
      )
      .subscribe();
  },
};