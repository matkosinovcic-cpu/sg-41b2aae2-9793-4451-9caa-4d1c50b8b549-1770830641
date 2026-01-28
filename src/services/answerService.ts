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
   * CRITICAL: Now includes ticket_id for 100% reliable stats tracking
   */
  async submitAnswer(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    answerYesNo: string,
    correctAnswer: any,
    ticketId: string // NEW: Required ticket identifier
  ): Promise<PlayerAnswer> {
    console.log("[submitAnswer] Starting submission:", {
      sessionId,
      eventId,
      questionNumber,
      answerYesNo,
      correctAnswer,
      correctAnswerType: typeof correctAnswer,
      ticketId // NEW: Log ticket_id
    });

    // CRITICAL: Validate ticket_id is provided
    if (!ticketId || ticketId.trim() === "") {
      throw new Error("ticket_id je obavezan za slanje odgovora");
    }

    // CRITICAL: Validate ticket exists in database for this event
    const { data: ticketExists, error: ticketError } = await supabase
      .from("tickets")
      .select("id")
      .eq("serial_number", ticketId)
      .eq("event_id", eventId)
      .single();

    if (ticketError || !ticketExists) {
      console.error("[submitAnswer] Ticket validation failed:", ticketError);
      throw new Error(`Ulaznica ${ticketId} ne postoji za ovaj event`);
    }

    // Check for duplicate
    const { data: existingAnswer } = await supabase
      .from("player_answers")
      .select("*")
      .eq("session_id", sessionId)
      .eq("question_number", questionNumber)
      .eq("ticket_id", ticketId); // CRITICAL: Check per ticket

    if (existingAnswer && existingAnswer.length > 0) {
      throw new Error("Vec si odgovorio na ovo pitanje za ovu ulaznicu");
    }

    // ROBUST NORMALIZATION
    const normalizedUserAnswer = normalizeYesNo(answerYesNo);
    const normalizedCorrectAnswer = normalizeYesNo(correctAnswer);

    console.log("[submitAnswer] Normalized values:", {
      userAnswer: normalizedUserAnswer,
      correctAnswer: normalizedCorrectAnswer,
      ticketId
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
      isCorrect,
      ticketId // NEW: Log ticket_id
    });

    // CRITICAL: Insert with ticket_id for 100% reliable tracking
    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        answer_yesno: normalizedUserAnswer, // Will be "YES" or "NO"
        is_correct: isCorrect,
        ticket_id: ticketId, // NEW: Store exact ticket identifier
      })
      .select()
      .single();

    if (error) {
      console.error("[submitAnswer] Database error:", error);
      throw error;
    }

    console.log("[submitAnswer] ✅ Answer saved successfully for question", questionNumber, "ticket", ticketId);

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
      
      // CRITICAL: Filter answers strictly by ticket_id (100% reliable)
      const ticketAnswers = answers.filter(answer =>
        answer.ticket_id === ticket.serial_number && // NEW: Direct ticket_id match
        drawnOnTicket.includes(answer.question_number) // Still filter by drawn numbers
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
        percentage: `${percentage}%`,
        matchedByTicketId: true // NEW: Direct match, no pattern matching
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
      total_questions: totalDrawn,
      ticket_stats: ticketStats,
    };
  },

  /**
   * Get detailed results for a specific ticket
   * Shows all drawn questions that were on this ticket with answers and correctness
   * CRITICAL: Missed questions show "Nije odgovoreno" and count as "Propušteno"
   * CRITICAL: Now uses ticket_id for 100% reliable matching
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

    // Get player answers - CRITICAL: Filter by ticket_id for 100% accuracy
    const answers = await this.getSessionAnswers(sessionId);
    const ticketAnswers = answers.filter(a => a.ticket_id === ticket.serial_number);

    console.log(`[getTicketDetailedResults] Found ${ticketAnswers.length} answers for ticket ${ticket.serial_number}`);

    // CRITICAL: Build detailed results for ALL drawn questions on this ticket
    const questions: QuestionResult[] = drawnOnTicket
      .sort((a, b) => a - b)
      .map((qNum) => {
        const eventQuestion = eventQuestions?.find((eq) => eq.question_number === qNum);
        const playerAnswer = ticketAnswers.find((a) => a.question_number === qNum);

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

    console.log(`[getTicketDetailedResults] Ticket ${ticket.serial_number} final: ${correct}/${drawnCount} correct (100% reliable via ticket_id)`);

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
   * REUSES THE SAME LOGIC AS PLAYER STATS to ensure consistency
   * 
   * CRITICAL: Now uses ticket_id for 100% reliable matching (no more pattern matching!)
   * 
   * This function:
   * 1. Fetches ALL tickets for the event
   * 2. Fetches ALL answers for the event (with ticket_id)
   * 3. For each ticket, applies the SAME per-ticket stats logic as player view
   * 4. Returns stats ONLY for tickets with answered > 0
   * 5. Filters out legacy answers (ticket_id = NULL)
   */
  async getEventTicketStatsV2(eventId: string): Promise<{
    stats: TicketStats[];
    debug: {
      eventId: string;
      totalAnswers: number;
      totalTickets: number;
      drawnNumbers: number[];
    };
  }> {
    try {
      console.log("[getEventTicketStatsV2] 🎯 Fetching ticket stats for event:", eventId);

      // 1. Get the event to check drawn numbers
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

      if (eventError) {
        console.error("[getEventTicketStatsV2] ❌ Error fetching event:", eventError);
        throw eventError;
      }

      if (!event) {
        throw new Error("Event not found");
      }

      const drawnNumbers = event.drawn_numbers || [];
      console.log("[getEventTicketStatsV2] 📊 Event has drawn:", drawnNumbers.length, "numbers");

      // 2. Fetch ALL tickets for this event with their question numbers
      const { data: tickets, error: ticketsError } = await supabase
        .from("tickets")
        .select(`
          id,
          serial_number,
          event_id,
          is_winner,
          ticket_questions (
            question_number
          )
        `)
        .eq("event_id", eventId);

      if (ticketsError) {
        console.error("[getEventTicketStatsV2] ❌ Error fetching tickets:", ticketsError);
        throw ticketsError;
      }

      console.log("[getEventTicketStatsV2] 🎫 Found", tickets?.length || 0, "tickets");

      // 3. Fetch ALL answers for this event
      // CRITICAL: Filter out legacy answers (ticket_id = NULL)
      const { data: allAnswers, error: answersError } = await supabase
        .from("player_answers")
        .select("*")
        .eq("event_id", eventId)
        .not("ticket_id", "is", null); // CRITICAL: Ignore legacy data

      if (answersError) {
        console.error("[getEventTicketStatsV2] ❌ Error fetching answers:", answersError);
        throw answersError;
      }

      console.log("[getEventTicketStatsV2] 💬 Found", allAnswers?.length || 0, "answers (excluding legacy)");

      // CRITICAL: If no answers exist, return empty stats immediately
      if (!allAnswers || allAnswers.length === 0) {
        console.log("[getEventTicketStatsV2] ⚠️ No answers with ticket_id found for this event");
        return {
          stats: [],
          debug: {
            eventId,
            totalAnswers: 0,
            totalTickets: tickets?.length || 0,
            drawnNumbers,
          },
        };
      }

      // 4. For each ticket, compute stats using ticket_id (100% reliable)
      const ticketStatsArray: TicketStats[] = [];

      for (const ticket of tickets || []) {
        const ticketQuestionNumbers = ticket.ticket_questions.map((tq: any) => tq.question_number);

        // Calculate which questions on this ticket have been drawn
        const drawnOnTicket = ticketQuestionNumbers.filter((num: number) =>
          drawnNumbers.includes(num)
        );

        // CRITICAL: Filter answers strictly by ticket_id (no pattern matching!)
        const ticketAnswers = allAnswers.filter(
          (answer) => answer.ticket_id === ticket.serial_number
        );

        // Count correct answers
        const correct = ticketAnswers.filter((a) => a.is_correct === true).length;
        const answered = ticketAnswers.length;
        const missed = drawnOnTicket.length - answered;

        // Calculate percentage based on drawn_on_ticket (same as player)
        const percentage =
          drawnOnTicket.length > 0 ? Math.round((correct / drawnOnTicket.length) * 100) : 0;

        console.log(
          `[getEventTicketStatsV2] 📈 Ticket ${ticket.serial_number}: ${correct}/${drawnOnTicket.length} correct (${percentage}%), answered: ${answered}, missed: ${missed} [100% reliable via ticket_id]`
        );

        // CRITICAL: Only include if this ticket actually has answered questions
        if (answered > 0) {
          ticketStatsArray.push({
            ticket_serial: ticket.serial_number,
            correct,
            answered,
            drawn_on_ticket: drawnOnTicket.length,
            missed,
            total: 15,
            percentage,
          });
        } else {
          console.log(
            `[getEventTicketStatsV2] ⚠️ Ticket ${ticket.serial_number}: No answers found (answered=0), excluding from active list`
          );
        }
      }

      console.log(
        `[getEventTicketStatsV2] ✅ Returning stats for ${ticketStatsArray.length} active tickets (100% reliable via ticket_id)`
      );

      if (ticketStatsArray.length > 0) {
        console.log(
          `[getEventTicketStatsV2] 📋 Sample:`,
          ticketStatsArray.slice(0, 2).map((t) => ({
            serial: t.ticket_serial,
            correct: t.correct,
            drawn: t.drawn_on_ticket,
            answered: t.answered,
          }))
        );
      }

      return {
        stats: ticketStatsArray,
        debug: {
          eventId,
          totalAnswers: allAnswers.length,
          totalTickets: tickets?.length || 0,
          drawnNumbers,
        },
      };
    } catch (error) {
      console.error("[getEventTicketStatsV2] ❌ Error:", error);
      throw error;
    }
  },

  /**
   * Get statistics for all tickets in an event (for admin view)
   * 
   * CRITICAL LIMITATION:
   * The player_answers table does NOT have a ticket_id column.
   * We must infer ticket ownership from answer patterns, which is imperfect.
   * 
   * STRICT MATCHING RULES (to minimize false positives):
   * - Require at least 3 answered questions from the ticket, OR
   * - Require at least 75% of session's answers to be from that ticket
   * - ALWAYS include winner tickets (marked with is_winner = true)
   * - Only count tickets where we have HIGH confidence (strict threshold)
   * - Filter out tickets with 0 actual answered questions
   * 
   * This approach minimizes phantom activity but cannot be 100% accurate
   * without schema changes (adding ticket_id to player_answers).
   */
  async getEventTicketStats(eventId: string): Promise<TicketStats[]> {
    try {
      console.log("[getEventTicketStats] 🎯 Fetching ticket stats for event:", eventId);

      // 1. Get the event to check drawn numbers and winner
      const event = await this.getEvent(eventId);
      if (!event) {
        throw new Error("Event not found");
      }

      const drawnNumbers = event.drawn_numbers || [];
      const winnerTicketId = event.winner_ticket_id;
      console.log("[getEventTicketStats] 📊 Event has drawn:", drawnNumbers.length, "numbers");
      console.log("[getEventTicketStats] 🏆 Winner ticket ID:", winnerTicketId || "None");

      // 2. Fetch all tickets for this event with their question numbers
      const { data: tickets, error: ticketsError } = await supabase
        .from("tickets")
        .select(`
          id,
          serial_number,
          event_id,
          is_winner,
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

      // CRITICAL: If no answers exist, return empty array immediately
      if (!allAnswers || allAnswers.length === 0) {
        console.log("[getEventTicketStats] ⚠️ No answers found for this event");
        return [];
      }

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
          "questions:",
          answeredQuestionNumbers.slice(0, 5),
          answeredQuestionNumbers.length > 5 ? "..." : ""
        );

        // Find tickets where the answer pattern strongly matches
        // CRITICAL: Use STRICT matching to avoid false positives, BUT include winner always
        const candidateTickets = tickets?.filter((ticket: any) => {
          const ticketQuestionNumbers = ticket.ticket_questions.map((tq: any) => tq.question_number);

          // Count how many answered questions are on this ticket
          const matchCount = answeredQuestionNumbers.filter((qNum) =>
            ticketQuestionNumbers.includes(qNum)
          ).length;

          // Calculate match percentage
          const matchPercentage = answeredQuestionNumbers.length > 0 
            ? (matchCount / answeredQuestionNumbers.length) * 100 
            : 0;

          // CRITICAL: ALWAYS include winner ticket
          const isWinnerTicket = ticket.is_winner === true || ticket.id === winnerTicketId;

          // STRICT: Require EITHER:
          // 1. At least 3 questions match (prevents single-question false positives), OR
          // 2. At least 75% of answered questions are on this ticket (very high confidence), OR
          // 3. This is the winner ticket (always include)
          const isHighConfidenceMatch = matchCount >= 3 || matchPercentage >= 75 || isWinnerTicket;

          if (isWinnerTicket && isHighConfidenceMatch) {
            console.log(
              `[getEventTicketStats] 🏆 WINNER TICKET: ${ticket.serial_number}: ${matchCount}/${answeredQuestionNumbers.length} match (${matchPercentage.toFixed(0)}%)`
            );
          } else if (isHighConfidenceMatch) {
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
            `[getEventTicketStats] ⚠️ Session ${sessionId.slice(0, 8)}: No HIGH CONFIDENCE ticket match found`
          );
          continue;
        }

        if (candidateTickets.length > 1) {
          console.warn(
            `[getEventTicketStats] ⚠️ Session ${sessionId.slice(0, 8)}: Multiple HIGH CONFIDENCE matches found (${candidateTickets.length} tickets) - using best match`
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
          `[getEventTicketStats] 📊 Ticket ${bestMatchTicket.serial_number}: ${drawnOnTicket.length} / 15 numbers drawn`
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
          `[getEventTicketStats] 📈 Ticket ${bestMatchTicket.serial_number}: ${correct}/${drawnOnTicket.length} correct (${percentage}%), answered: ${answered}, missed: ${missed}`
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
        `[getEventTicketStats] ✅ Returning stats for ${trulyActiveTickets.length} active tickets (with answered > 0)`
      );
      
      if (trulyActiveTickets.length > 0) {
        console.log(`[getEventTicketStats] 📋 Sample tickets:`, trulyActiveTickets.slice(0, 3).map(t => ({
          serial: t.ticket_serial,
          correct: t.correct,
          drawn: t.drawn_on_ticket,
          answered: t.answered
        })));
      }

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
   * CRITICAL: Now includes ticket_id for 100% reliable stats tracking
   * We can identify missed answers by checking if is_correct=false and the question was drawn but not answered
   */
  async markUnansweredAsWrong(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    ticketId: string // NEW: Required ticket identifier
  ): Promise<PlayerAnswer | null> {
    console.log(`[markUnansweredAsWrong] Checking question ${questionNumber} for session ${sessionId} ticket ${ticketId}`);

    // CRITICAL: Validate ticket_id is provided
    if (!ticketId || ticketId.trim() === "") {
      console.error("[markUnansweredAsWrong] ticket_id is required");
      return null;
    }

    // Check if already answered for this ticket
    const { data: existingAnswer } = await supabase
      .from("player_answers")
      .select("*")
      .eq("session_id", sessionId)
      .eq("question_number", questionNumber)
      .eq("ticket_id", ticketId); // CRITICAL: Check per ticket

    if (existingAnswer && existingAnswer.length > 0) {
      console.log(`[markUnansweredAsWrong] Question ${questionNumber} already answered for ticket ${ticketId}, skipping`);
      return null;
    }

    // CRITICAL: Store as 'NO' with is_correct=false to satisfy CHECK constraint and include ticket_id
    console.log(`[markUnansweredAsWrong] Marking question ${questionNumber} as MISSED for ticket ${ticketId}`);

    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        answer_yesno: "NO", // Use "NO" to satisfy CHECK constraint
        is_correct: false,   // Always incorrect for missed answers
        ticket_id: ticketId, // NEW: Store exact ticket identifier
      })
      .select()
      .single();

    if (error) {
      console.error("[markUnansweredAsWrong] Failed to mark unanswered question:", error);
      return null;
    }

    console.log(`[markUnansweredAsWrong] ✅ MISSED saved for question ${questionNumber} ticket ${ticketId}`);
    
    return data as PlayerAnswer;
  },
};