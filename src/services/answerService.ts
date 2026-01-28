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

export interface QuestionResult {
  question_number: number;
  question_text: string;
  correct_answer: string; // "DA" or "NE"
  player_answer: string; // "DA" or "NE" or "MISSED"
  is_correct: boolean;
}

export interface TicketDetailedResults {
  ticket_serial: string;
  correct: number;
  total: number;
  percentage: number;
  questions: QuestionResult[];
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
  
  // MISSED variations
  if (["MISSED", "TIMEOUT", "UNANSWERED"].includes(str)) return "MISSED";
  
  return null;
}

/**
 * Normalize for display (DA/NE instead of YES/NO)
 */
function normalizeForDisplay(value: string | null): string {
  if (value === "YES") return "DA";
  if (value === "NO") return "NE";
  if (value === "MISSED") return "MISSED";
  return "MISSED";
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
   * CRITICAL: Only explicit DA/NE answers can be correct
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
      console.error("[submitAnswer] Invalid correct answer:", correctAnswer);
      throw new Error("Pitanje nema ispravan odgovor u bazi");
    }

    // Validate user answer (must be explicit YES or NO, never MISSED)
    if (!normalizedUserAnswer || normalizedUserAnswer === "MISSED") {
      console.error("[submitAnswer] Invalid user answer:", answerYesNo);
      throw new Error("Neispravan odgovor");
    }

    // CRITICAL: Compare normalized answers
    // Only explicit DA/NE answers can be correct
    const isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;

    console.log("[submitAnswer] Recording answer:", {
      sessionId,
      questionNumber,
      userAnswer: normalizedUserAnswer,
      correctAnswer: normalizedCorrectAnswer,
      isCorrect
    });

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
   * CRITICAL: MISSED answers are ALWAYS wrong
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
      console.log(`[markUnansweredAsWrong] Question ${questionNumber} already answered, skipping`);
      return null; // Already answered, skip
    }

    // CRITICAL: Insert as MISSED with is_correct=false
    // MISSED answers can NEVER be correct
    console.log(`[markUnansweredAsWrong] Marking question ${questionNumber} as MISSED for session ${sessionId}`);

    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        answer_yesno: "MISSED",
        is_correct: false,
      })
      .select()
      .single();

    if (error) {
      console.error("[markUnansweredAsWrong] Failed to mark unanswered question:", error);
      return null;
    }

    console.log(`[markUnansweredAsWrong] ✅ MISSED saved for question ${questionNumber}`);
    
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
   * CRITICAL: MISSED answers are ALWAYS wrong
   */
  async getSessionStats(
    sessionId: string,
    tickets: Array<{ id: string; serial_number: string; ticket_questions: Array<{ question_number: number }> }>
  ): Promise<SessionStats> {
    const answers = await this.getSessionAnswers(sessionId);

    // CRITICAL: Only count explicit correct answers (never MISSED)
    const totalCorrect = answers.filter((a) => 
      a.is_correct === true && a.answer_yesno !== "MISSED"
    ).length;
    const totalAnswered = answers.length;
    
    // Total questions = sum of all ticket questions (each ticket has exactly 15)
    const totalQuestions = tickets.length * 15;

    const ticketStats: TicketStats[] = tickets.map((ticket) => {
      const ticketQuestionNumbers = ticket.ticket_questions.map((tq) => tq.question_number);

      const ticketAnswers = answers.filter((answer) =>
        ticketQuestionNumbers.includes(answer.question_number)
      );

      // CRITICAL: Only count explicit correct answers (never MISSED)
      const correct = ticketAnswers.filter((a) => 
        a.is_correct === true && a.answer_yesno !== "MISSED"
      ).length;
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
   * Get detailed results for a specific ticket
   * Shows all 15 questions with answers and correctness
   */
  async getTicketDetailedResults(
    sessionId: string,
    ticket: { id: string; serial_number: string; ticket_questions: Array<{ question_number: number }> },
    eventId: string
  ): Promise<TicketDetailedResults> {
    const ticketQuestionNumbers = ticket.ticket_questions
      .map((tq) => tq.question_number)
      .sort((a, b) => a - b);

    // Get event questions for this ticket
    const { data: eventQuestions, error: eqError } = await supabase
      .from("event_questions")
      .select(`
        question_number,
        questions (
          text,
          correct_answer
        )
      `)
      .eq("event_id", eventId)
      .in("question_number", ticketQuestionNumbers);

    if (eqError) throw eqError;

    // Get player answers
    const answers = await this.getSessionAnswers(sessionId);

    // Build detailed results
    const questions: QuestionResult[] = ticketQuestionNumbers.map((qNum) => {
      const eventQuestion = eventQuestions?.find((eq) => eq.question_number === qNum);
      const playerAnswer = answers.find((a) => a.question_number === qNum);

      const correctAnswerRaw = (eventQuestion as any)?.questions?.correct_answer;
      const correctAnswer = normalizeForDisplay(normalizeYesNo(correctAnswerRaw));

      const playerAnswerRaw = playerAnswer?.answer_yesno || "MISSED";
      const playerAnswerDisplay = normalizeForDisplay(normalizeYesNo(playerAnswerRaw));

      // CRITICAL: MISSED answers are ALWAYS wrong
      const isCorrect = playerAnswer?.is_correct === true && playerAnswerRaw !== "MISSED";

      return {
        question_number: qNum,
        question_text: (eventQuestion as any)?.questions?.text || "Pitanje nije dostupno",
        correct_answer: correctAnswer,
        player_answer: playerAnswerDisplay,
        is_correct: isCorrect,
      };
    });

    const correct = questions.filter((q) => q.is_correct).length;
    const total = 15;
    const percentage = Math.round((correct / total) * 100);

    return {
      ticket_serial: ticket.serial_number,
      correct,
      total,
      percentage,
      questions,
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
   * CRITICAL: MISSED answers are ALWAYS wrong
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

      // CRITICAL: Only count explicit correct answers (never MISSED)
      const correct = ticketAnswers.filter((a: any) => 
        a.is_correct === true && a.answer_yesno !== "MISSED"
      ).length;
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