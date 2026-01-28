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
  drawn_on_ticket: number;
  missed: number;
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
   * - Per-ticket: Shows correct/drawn on that specific ticket
   * - Overall totalDrawn: Total questions drawn in the EVENT (not per-ticket)
   * - Overall totalCorrect: Sum of correct answers across all player's tickets
   */
  async getSessionStats(
    sessionId: string,
    tickets: Array<{ 
      id: string; 
      serial_number: string; 
      ticket_questions: Array<{ question_number: number }> 
    }>,
    drawnNumbers: number[] // CRITICAL: Actual drawn list from event
  ): Promise<SessionStats> {
    console.log(`[getSessionStats] Session ${sessionId} with ${tickets.length} tickets`);
    console.log(`[getSessionStats] Total drawn in event:`, drawnNumbers.length);

    const answers = await this.getSessionAnswers(sessionId);
    console.log(`[getSessionStats] Found ${answers.length} total answers`);

    const ticketStats: TicketStats[] = tickets.map((ticket) => {
      const ticketNumbers = ticket.ticket_questions.map(tq => tq.question_number);

      // CRITICAL: Only count numbers that were ACTUALLY DRAWN (random draw support)
      const drawnOnTicket = ticketNumbers.filter(num => drawnNumbers.includes(num));
      
      // CRITICAL: Only count answers for THIS TICKET's drawn numbers
      const ticketAnswers = answers.filter(answer =>
        drawnOnTicket.includes(answer.question_number)
      );

      // CRITICAL: Only explicit correct answers (never MISSED)
      const correct = ticketAnswers.filter(a => 
        a.is_correct === true
      ).length;
      
      const answered = ticketAnswers.length;
      
      // CRITICAL: Missed = drawn but not answered
      const missed = drawnOnTicket.length - answered;
      
      // CRITICAL: Total is ALWAYS 15 (all ticket numbers)
      const total = 15;
      
      // CRITICAL: Percentage based on DRAWN numbers on this ticket
      const percentage = drawnOnTicket.length > 0 
        ? Math.round((correct / drawnOnTicket.length) * 100) 
        : 0;

      console.log(`[getSessionStats] Ticket ${ticket.serial_number}:`, {
        ticketNumbers: ticketNumbers.length,
        drawnOnTicket: drawnOnTicket.length,
        answered,
        correct,
        missed,
        percentage: `${percentage}%`
      });

      return {
        ticket_serial: ticket.serial_number,
        correct,
        answered,
        missed,
        total,
        drawn_on_ticket: drawnOnTicket.length,
        percentage,
      };
    });

    // CRITICAL: Overall stats are EVENT-SCOPED for totalDrawn, PLAYER-SCOPED for totalCorrect
    // totalDrawn = TOTAL questions drawn in the EVENT (same as admin shows)
    // totalCorrect = sum of correct answers across ALL this player's tickets
    const totalCorrect = ticketStats.reduce((sum, t) => sum + t.correct, 0);
    const totalAnswered = ticketStats.reduce((sum, t) => sum + t.answered, 0);
    const totalDrawn = drawnNumbers.length; // CRITICAL: Total drawn in EVENT, not per-ticket sum

    console.log(`[getSessionStats] Overall stats:`, {
      totalCorrect,
      totalAnswered,
      totalDrawn: `${totalDrawn} (event total)`,
      tickets: ticketStats.length
    });

    return {
      total_correct: totalCorrect,
      total_answered: totalAnswered,
      total_questions: totalDrawn, // CRITICAL: EVENT-scoped drawn count
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
   * 
   * CRITICAL LIMITATION:
   * The player_answers table does NOT have a ticket_id column.
   * We must infer ticket ownership from answer patterns, which is imperfect.
   * 
   * STRICT MATCHING RULES (to minimize false positives):
   * - Require at least 5 answered questions from the ticket, OR
   * - Require at least 75% of session's answers to be from that ticket
   * - Only count tickets where we have HIGH confidence (strict threshold)
   * - Filter out tickets with 0 actual answered questions
   * 
   * This approach minimizes phantom activity but cannot be 100% accurate
   * without schema changes (adding ticket_id to player_answers).
   */
  async getEventTicketStats(eventId: string): Promise<TicketStats[]> {
    try {
      console.log("[getEventTicketStats] 🎯 Fetching ticket stats for event:", eventId);

      // 1. Get the event to check drawn numbers
      const event = await this.getEvent(eventId);
      if (!event) {
        throw new Error("Event not found");
      }

      const drawnNumbers = event.drawn_numbers || [];
      console.log("[getEventTicketStats] 📊 Event has drawn:", drawnNumbers.length, "numbers");

      // 2. Fetch all tickets for this event with their question numbers
      const { data: tickets, error: ticketsError } = await supabase
        .from("tickets")
        .select(`
          id,
          serial_number,
          event_id,
          ticket_questions (
            question_number
          )
        `)
        .eq("event_id", eventId);

      if (ticketsError) {
        console.error("[getEventTicketStats] ❌ Error fetching tickets:", ticketsError);
        throw ticketsError;
      }

      console.log("[getEventTicketStats] 🎫 Found", tickets?.length || 0, "tickets");

      // 3. Fetch ALL answers for this event, grouped by session
      const { data: allAnswers, error: answersError } = await supabase
        .from("player_answers")
        .select("*")
        .eq("event_id", eventId);

      if (answersError) {
        console.error("[getEventTicketStats] ❌ Error fetching answers:", answersError);
        throw answersError;
      }

      console.log("[getEventTicketStats] 💬 Found", allAnswers?.length || 0, "total answers");

      // Group answers by session_id
      const answersBySession = new Map<string, typeof allAnswers>();
      allAnswers?.forEach((answer) => {
        if (!answersBySession.has(answer.session_id)) {
          answersBySession.set(answer.session_id, []);
        }
        answersBySession.get(answer.session_id)!.push(answer);
      });

      console.log("[getEventTicketStats] 👥 Grouped into", answersBySession.size, "sessions");

      // 4. For each session, find the BEST matching ticket using STRICT criteria
      const activeTicketStats: TicketStats[] = [];

      for (const [sessionId, sessionAnswers] of answersBySession.entries()) {
        const answeredQuestionNumbers = sessionAnswers.map((a) => a.question_number);
        console.log(
          `[getEventTicketStats] 📝 Session ${sessionId.slice(0, 8)}: answered`,
          answeredQuestionNumbers.length,
          "questions"
        );

        // Find tickets where the answer pattern strongly matches
        // CRITICAL: Use VERY STRICT matching to avoid false positives
        const candidateTickets = tickets?.filter((ticket: any) => {
          const ticketQuestionNumbers = ticket.ticket_questions.map((tq: any) => tq.question_number);

          // Count how many answered questions are on this ticket
          const matchCount = answeredQuestionNumbers.filter((qNum) =>
            ticketQuestionNumbers.includes(qNum)
          ).length;

          // Calculate match percentage
          const matchPercentage = (matchCount / answeredQuestionNumbers.length) * 100;

          // ULTRA STRICT: Require BOTH:
          // 1. At least 5 questions match (prevents small-sample false positives), OR
          // 2. At least 75% of answered questions are on this ticket (very high confidence)
          const isHighConfidenceMatch = matchCount >= 5 || matchPercentage >= 75;

          if (isHighConfidenceMatch) {
            console.log(
              `[getEventTicketStats] ✓ HIGH CONFIDENCE: Ticket ${ticket.serial_number}: ${matchCount}/${answeredQuestionNumbers.length} match (${matchPercentage.toFixed(0)}%)`
            );
          } else if (matchCount > 0) {
            console.log(
              `[getEventTicketStats] ✗ LOW CONFIDENCE: Ticket ${ticket.serial_number}: ${matchCount}/${answeredQuestionNumbers.length} match (${matchPercentage.toFixed(0)}%) - EXCLUDED`
            );
          }

          return isHighConfidenceMatch;
        }) || [];

        if (candidateTickets.length === 0) {
          console.log(
            `[getEventTicketStats] ⚠️ Session ${sessionId.slice(0, 8)}: No HIGH CONFIDENCE ticket match found (all candidates below 75% threshold)`
          );
          continue;
        }

        if (candidateTickets.length > 1) {
          console.warn(
            `[getEventTicketStats] ⚠️ Session ${sessionId.slice(0, 8)}: Multiple HIGH CONFIDENCE matches found (${candidateTickets.length} tickets) - using best match only`
          );
        }

        // If multiple candidates, choose the one with highest match percentage
        const bestMatchTicket = candidateTickets.reduce((best: any, current: any) => {
          const bestTicketNumbers = best.ticket_questions.map((tq: any) => tq.question_number);
          const currentTicketNumbers = current.ticket_questions.map((tq: any) => tq.question_number);

          const bestMatchCount = answeredQuestionNumbers.filter((qNum) =>
            bestTicketNumbers.includes(qNum)
          ).length;
          const currentMatchCount = answeredQuestionNumbers.filter((qNum) =>
            currentTicketNumbers.includes(qNum)
          ).length;

          return currentMatchCount > bestMatchCount ? current : best;
        });

        const ticketQuestionNumbers = bestMatchTicket.ticket_questions.map(
          (tq: any) => tq.question_number
        );

        // Calculate which questions on this ticket have been drawn
        const drawnOnTicket = ticketQuestionNumbers.filter((num: number) =>
          drawnNumbers.includes(num)
        );

        console.log(
          `[getEventTicketStats] Ticket ${bestMatchTicket.serial_number}: ${drawnOnTicket.length} / 15 numbers drawn`
        );

        // Filter answers to only those that:
        // 1. Are on this ticket's question numbers
        // 2. Were actually drawn in the event
        const ticketAnswers = sessionAnswers.filter(
          (answer) =>
            ticketQuestionNumbers.includes(answer.question_number) &&
            drawnOnTicket.includes(answer.question_number)
        );

        // Count correct answers
        const correct = ticketAnswers.filter((a) => a.is_correct === true).length;
        const answered = ticketAnswers.length;
        const missed = drawnOnTicket.length - answered;

        // Calculate percentage based on drawn_on_ticket (not total)
        const percentage =
          drawnOnTicket.length > 0 ? Math.round((correct / drawnOnTicket.length) * 100) : 0;

        console.log(
          `[getEventTicketStats] Ticket ${bestMatchTicket.serial_number}: ${correct}/${drawnOnTicket.length} correct (${percentage}%), answered: ${answered}, missed: ${missed}`
        );

        // CRITICAL: Only include if this ticket actually has answered questions
        if (answered > 0) {
          activeTicketStats.push({
            ticket_serial: bestMatchTicket.serial_number,
            correct,
            answered,
            drawn_on_ticket: drawnOnTicket.length,
            missed,
            total: 15, // Total questions on any ticket
            percentage,
          });
        } else {
          console.log(
            `[getEventTicketStats] ⚠️ Ticket ${bestMatchTicket.serial_number}: Matched pattern but answered=0, excluding from active list`
          );
        }
      }

      // CRITICAL: Final safety filter - only return tickets with answered > 0
      const trulyActiveTickets = activeTicketStats.filter((stat) => stat.answered > 0);

      console.log(
        `[getEventTicketStats] ✅ Returning stats for ${trulyActiveTickets.length} HIGH CONFIDENCE active tickets (≥5 matches OR ≥75% overlap, and answered > 0)`
      );
      console.log(`[getEventTicketStats] Sample:`, trulyActiveTickets.slice(0, 2));

      return trulyActiveTickets;
    } catch (error) {
      console.error("[getEventTicketStats] ❌ Error:", error);
      throw error;
    }
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