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
  drawn: number;
  missed: number;
  total: number;
  percentage: number;
}

export interface SessionStats {
  total_correct: number;
  total_answered: number;
  total_drawn: number;
  total_questions: number;
  ticket_stats: TicketStats[];
}

export interface QuestionResult {
  question_number: number;
  question_text: string;
  correct_answer: string;
  player_answer: string;
  result: "Točno" | "Netočno" | "Propušteno";
}

export interface TicketDetailedResults {
  ticket_serial: string;
  correct: number;
  drawn: number;
  total: number;
  percentage: number;
  questions: QuestionResult[];
}

/**
 * ROBUST YES/NO NORMALIZATION
 * Handles: boolean, string, number, null, undefined
 * Returns: "YES" | "NO" | "MISSED" | null
 * 
 * CRITICAL: Database CHECK constraint requires EXACTLY "YES" or "NO" (uppercase)
 * CHECK ((answer_yesno = ANY (ARRAY['YES'::text, 'NO'::text])))
 * 
 * Rules:
 * - true/"true"/1/"1"/"DA"/"YES"/"Y" => "YES"
 * - false/"false"/0/"0"/"NE"/"NO"/"N" => "NO"
 * - "MISSED"/"TIMEOUT" => "MISSED" (used internally for timeouts)
 * - null/undefined/"" => null
 */
function normalizeYesNo(value: any): "YES" | "NO" | "MISSED" | null {
  // Handle null/undefined/empty
  if (value === null || value === undefined || value === "") return null;
  
  // Handle boolean
  if (typeof value === "boolean") {
    return value ? "YES" : "NO";
  }
  
  // Handle number
  if (typeof value === "number") {
    return value > 0 ? "YES" : "NO";
  }
  
  // Handle string (safe conversion)
  try {
    const str = String(value).trim().toUpperCase();
    
    // YES variations
    if (["DA", "YES", "Y", "TRUE", "1"].includes(str)) return "YES";
    
    // NO variations
    if (["NE", "NO", "N", "FALSE", "0"].includes(str)) return "NO";
    
    // MISSED variations (internal use only, not for DB storage in normal answers)
    if (["MISSED", "TIMEOUT", "UNANSWERED"].includes(str)) return "MISSED";
    
    return null;
  } catch (error) {
    console.error("[normalizeYesNo] Error normalizing value:", value, error);
    return null;
  }
}

/**
 * Normalize for display in UI (converts back to Croatian)
 * YES -> DA, NO -> NE, MISSED -> Propušteno
 */
function normalizeForDisplay(value: string | null): string {
  if (!value) return "—";
  
  const upper = String(value).toUpperCase();
  
  if (upper === "YES") return "DA";
  if (upper === "NO") return "NE";
  if (upper === "MISSED") return "Propušteno";
  
  return value;
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
   * CRITICAL: Only explicit YES/NO answers can be submitted by players
   * CRITICAL: Database CHECK constraint requires answer_yesno to be 'YES' or 'NO'
   * CRITICAL: Triggers winner check after successful submission
   */
  async submitAnswer(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    answerYesNo: string,
    correctAnswer: any
  ): Promise<PlayerAnswer> {
    console.log("[submitAnswer] Starting submission:", {
      sessionId,
      eventId,
      questionNumber,
      answerYesNo,
      correctAnswer,
      correctAnswerType: typeof correctAnswer
    });

    // Check for duplicate
    const { data: existingAnswer } = await supabase
      .from("player_answers")
      .select("*")
      .eq("session_id", sessionId)
      .eq("question_number", questionNumber)
      .single();

    if (existingAnswer) {
      throw new Error("Vec si odgovorio na ovo pitanje");
    }

    // ROBUST NORMALIZATION
    const normalizedUserAnswer = normalizeYesNo(answerYesNo);
    const normalizedCorrectAnswer = normalizeYesNo(correctAnswer);

    console.log("[submitAnswer] Normalized values:", {
      userAnswer: normalizedUserAnswer,
      correctAnswer: normalizedCorrectAnswer
    });

    // Validate correct answer exists
    if (!normalizedCorrectAnswer || normalizedCorrectAnswer === "MISSED") {
      console.error("[submitAnswer] Invalid correct answer:", correctAnswer);
      throw new Error("Pitanje nema ispravan odgovor u bazi");
    }

    // CRITICAL: Validate user answer is explicit YES or NO (never MISSED for player submissions)
    if (!normalizedUserAnswer || normalizedUserAnswer === "MISSED") {
      console.error("[submitAnswer] Invalid user answer:", answerYesNo);
      throw new Error("Neispravan odgovor");
    }

    // CRITICAL: Ensure answer is exactly "YES" or "NO" for database constraint
    if (normalizedUserAnswer !== "YES" && normalizedUserAnswer !== "NO") {
      console.error("[submitAnswer] Answer not YES or NO:", normalizedUserAnswer);
      throw new Error("Odgovor mora biti DA ili NE");
    }

    // CRITICAL: Compare normalized answers
    const isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;

    console.log("[submitAnswer] Recording answer:", {
      sessionId,
      questionNumber,
      userAnswer: normalizedUserAnswer,
      correctAnswer: normalizedCorrectAnswer,
      isCorrect
    });

    // CRITICAL: Insert with exactly "YES" or "NO" to satisfy CHECK constraint
    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        answer_yesno: normalizedUserAnswer, // Will be "YES" or "NO"
        is_correct: isCorrect,
      })
      .select()
      .single();

    if (error) {
      console.error("[submitAnswer] Database error:", error);
      throw error;
    }

    console.log("[submitAnswer] ✅ Answer saved successfully for question", questionNumber);

    // CRITICAL: Check for winner after each answer
    try {
      await eventService.checkForWinner(eventId);
    } catch (winnerError) {
      console.error("Winner check failed:", winnerError);
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
   * CRITICAL RULES:
   * - Total is ALWAYS 15 per ticket
   * - Only count answers for questions that were DRAWN AND are ON this ticket
   * - Missed = drawn - answered (computed, not stored)
   * - Correct = count where is_correct === true AND answer_yesno is DA or NE
   * - Use actual drawn_numbers array from event (random draw support)
   */
  async getSessionStats(
    sessionId: string,
    tickets: Array<{ id: string; serial_number: string; ticket_questions: Array<{ question_number: number }> }>,
    drawnNumbers: number[]
  ): Promise<SessionStats> {
    console.log(`[getSessionStats] Calculating stats for session ${sessionId} with ${tickets.length} tickets`);
    console.log(`[getSessionStats] Drawn numbers:`, drawnNumbers);

    const answers = await this.getSessionAnswers(sessionId);
    console.log(`[getSessionStats] Found ${answers.length} total answers for session`);

    // CRITICAL: Only count explicit correct answers (DA or NE, never null)
    const totalCorrect = answers.filter((a) => 
      a.is_correct === true && 
      (a.answer_yesno === "DA" || a.answer_yesno === "NE")
    ).length;
    const totalAnswered = answers.length;
    
    // Total drawn across event
    const totalDrawn = drawnNumbers.length;
    
    // Total questions = sum of all ticket questions (each ticket has exactly 15)
    const totalQuestions = tickets.length * 15;

    const ticketStats: TicketStats[] = tickets.map((ticket) => {
      const ticketQuestionNumbers = ticket.ticket_questions.map((tq) => tq.question_number);

      // CRITICAL: Only consider questions that are BOTH:
      // 1. On this ticket (in ticketQuestionNumbers)
      // 2. Have been drawn (in drawnNumbers)
      const drawnOnTicket = ticketQuestionNumbers.filter(num => drawnNumbers.includes(num));
      const drawnCount = drawnOnTicket.length;

      // CRITICAL: Only count answers for questions that were drawn AND on this ticket
      const ticketAnswers = answers.filter((answer) =>
        drawnOnTicket.includes(answer.question_number)
      );

      // CRITICAL: Only count explicit correct answers (DA or NE)
      const correct = ticketAnswers.filter((a) => 
        a.is_correct === true && 
        (a.answer_yesno === "DA" || a.answer_yesno === "NE")
      ).length;
      
      const answered = ticketAnswers.length;
      
      // CRITICAL: Missed = drawn on ticket but not answered
      const missed = drawnCount - answered;
      
      // CRITICAL: Each ticket ALWAYS has exactly 15 questions
      const total = 15;
      
      // Percentage based on drawn questions (if drawn > 0)
      const percentage = drawnCount > 0 ? Math.round((correct / drawnCount) * 100) : 0;

      console.log(`[getSessionStats] Ticket ${ticket.serial_number}:`, {
        drawnOnTicket: drawnCount,
        correct,
        answered,
        missed,
        total,
        percentage,
        correctAnswers: ticketAnswers
          .filter(a => a.is_correct === true)
          .map(a => ({ q: a.question_number, ans: a.answer_yesno }))
      });

      return {
        ticket_serial: ticket.serial_number,
        correct,
        answered,
        drawn: drawnCount,
        missed,
        total,
        percentage,
      };
    });

    return {
      total_correct: totalCorrect,
      total_answered: totalAnswered,
      total_drawn: totalDrawn,
      total_questions: totalQuestions,
      ticket_stats: ticketStats,
    };
  },

  /**
   * Get detailed results for a specific ticket
   * Shows all drawn questions that were on this ticket with answers and correctness
   * CRITICAL: Missed questions show "Nije odgovoreno" and count as "Propušteno"
   */
  async getTicketDetailedResults(
    sessionId: string,
    ticket: { id: string; serial_number: string; ticket_questions: Array<{ question_number: number }> },
    eventId: string,
    drawnNumbers: number[]
  ): Promise<TicketDetailedResults> {
    const ticketQuestionNumbers = ticket.ticket_questions.map((tq) => tq.question_number);
    
    // CRITICAL: Only consider questions that were DRAWN AND on this ticket
    const drawnOnTicket = ticketQuestionNumbers.filter(num => drawnNumbers.includes(num));
    const drawnCount = drawnOnTicket.length;

    console.log(`[getTicketDetailedResults] Loading details for ticket ${ticket.serial_number}`);
    console.log(`[getTicketDetailedResults] Drawn on ticket:`, drawnOnTicket);

    // Get event questions for drawn numbers
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
      .in("question_number", drawnOnTicket);

    if (eqError) throw eqError;

    // Get player answers
    const answers = await this.getSessionAnswers(sessionId);

    // CRITICAL: Build detailed results for ALL drawn questions on this ticket
    const questions: QuestionResult[] = drawnOnTicket
      .sort((a, b) => a - b)
      .map((qNum) => {
        const eventQuestion = eventQuestions?.find((eq) => eq.question_number === qNum);
        const playerAnswer = answers.find((a) => a.question_number === qNum);

        const correctAnswerRaw = (eventQuestion as any)?.questions?.correct_answer;
        const correctAnswer = normalizeYesNo(correctAnswerRaw) || "NE";

        // CRITICAL: Determine player answer and result
        let playerAnswerDisplay: string;
        let result: "Točno" | "Netočno" | "Propušteno";

        if (playerAnswer && (playerAnswer.answer_yesno === "DA" || playerAnswer.answer_yesno === "NE")) {
          // Player answered explicitly
          playerAnswerDisplay = playerAnswer.answer_yesno;
          result = playerAnswer.is_correct === true ? "Točno" : "Netočno";
        } else {
          // No answer or invalid = Missed
          playerAnswerDisplay = "Nije odgovoreno";
          result = "Propušteno";
        }

        return {
          question_number: qNum,
          question_text: (eventQuestion as any)?.questions?.text || "Pitanje nije dostupno",
          correct_answer: correctAnswer,
          player_answer: playerAnswerDisplay,
          result,
        };
      });

    // CRITICAL: Count only explicit correct answers
    const correct = questions.filter((q) => q.result === "Točno").length;
    const percentage = drawnCount > 0 ? Math.round((correct / drawnCount) * 100) : 0;

    console.log(`[getTicketDetailedResults] Ticket ${ticket.serial_number} final: ${correct}/${drawnCount} correct`);

    return {
      ticket_serial: ticket.serial_number,
      correct,
      drawn: drawnCount,
      total: 15,
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
   * CRITICAL: Only show stats for tickets that have been joined by a session
   * CRITICAL: Use actual drawn_numbers array from event
   * CRITICAL: Missed questions computed as drawn - answered
   */
  async getEventTicketStats(eventId: string, drawnNumbers: number[]): Promise<TicketStats[]> {
    console.log(`[getEventTicketStats] Loading stats for event ${eventId}`);
    console.log(`[getEventTicketStats] Drawn numbers:`, drawnNumbers);

    // Get all tickets for this event
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

    // Get all sessions for this event
    const { data: sessions, error: sessionsError } = await supabase
      .from("player_sessions")
      .select("id")
      .eq("event_id", eventId);

    if (sessionsError) throw sessionsError;

    const sessionIds = sessions.map((s) => s.id);

    if (sessionIds.length === 0) {
      console.log("[getEventTicketStats] No sessions found, returning empty stats");
      return [];
    }

    // Get all answers for all sessions in this event
    const { data: answers, error: answersError } = await supabase
      .from("player_answers")
      .select("*")
      .eq("event_id", eventId)
      .in("session_id", sessionIds);

    if (answersError) throw answersError;

    console.log(`[getEventTicketStats] Found ${answers.length} total answers across ${sessionIds.length} sessions`);

    // CRITICAL: Calculate stats per ticket
    const ticketStats: TicketStats[] = tickets.map((ticket: any) => {
      const ticketQuestionNumbers = ticket.ticket_questions.map((tq: any) => tq.question_number);

      // CRITICAL: Only consider questions that are BOTH drawn AND on this ticket
      const drawnOnTicket = ticketQuestionNumbers.filter((num: number) => drawnNumbers.includes(num));
      const drawnCount = drawnOnTicket.length;

      // CRITICAL: Get answers that match THIS ticket's drawn question numbers
      const ticketAnswers = answers.filter((answer: any) =>
        drawnOnTicket.includes(answer.question_number)
      );

      // CRITICAL: Only count explicit correct answers (DA or NE)
      const correct = ticketAnswers.filter((a: any) => 
        a.is_correct === true && 
        (a.answer_yesno === "DA" || a.answer_yesno === "NE")
      ).length;
      
      const answered = ticketAnswers.length;
      
      // CRITICAL: Missed = drawn on ticket but not answered
      const missed = drawnCount - answered;
      
      // CRITICAL: Each ticket ALWAYS has exactly 15 questions
      const total = 15;
      const percentage = drawnCount > 0 ? Math.round((correct / drawnCount) * 100) : 0;

      return {
        ticket_serial: ticket.serial_number,
        correct,
        answered,
        drawn: drawnCount,
        missed,
        total,
        percentage,
      };
    });

    // CRITICAL: Only return tickets that have at least one answer
    const activeTicketStats = ticketStats.filter((stat) => stat.answered > 0);
    
    console.log(`[getEventTicketStats] Returning stats for ${activeTicketStats.length} active tickets (out of ${tickets.length} total)`);

    return activeTicketStats;
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

  /**
   * Mark a question as unanswered (missed) when time expires
   * CRITICAL: Since CHECK constraint only allows 'YES' or 'NO', we store missed as 'NO' with is_correct=false
   * We can identify missed answers by checking if is_correct=false and the question was drawn but not answered
   */
  async markUnansweredAsWrong(
    sessionId: string,
    eventId: string,
    questionNumber: number
  ): Promise<PlayerAnswer | null> {
    console.log(`[markUnansweredAsWrong] Checking question ${questionNumber} for session ${sessionId}`);

    // Check if already answered
    const { data: existingAnswer } = await supabase
      .from("player_answers")
      .select("*")
      .eq("session_id", sessionId)
      .eq("question_number", questionNumber)
      .single();

    if (existingAnswer) {
      console.log(`[markUnansweredAsWrong] Question ${questionNumber} already answered, skipping`);
      return null;
    }

    // CRITICAL: Store as 'NO' with is_correct=false to satisfy CHECK constraint
    // We mark missed answers with a special pattern: answer_yesno='NO' and is_correct=false
    // This is different from an explicit wrong answer (where player chose NO but answer was YES)
    console.log(`[markUnansweredAsWrong] Marking question ${questionNumber} as MISSED (storing as NO with is_correct=false)`);

    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        answer_yesno: "NO", // Use "NO" to satisfy CHECK constraint
        is_correct: false,   // Always incorrect for missed answers
      })
      .select()
      .single();

    if (error) {
      console.error("[markUnansweredAsWrong] Failed to mark unanswered question:", error);
      return null;
    }

    console.log(`[markUnansweredAsWrong] ✅ MISSED saved as NO for question ${questionNumber}`);
    
    return data as PlayerAnswer;
  },
};