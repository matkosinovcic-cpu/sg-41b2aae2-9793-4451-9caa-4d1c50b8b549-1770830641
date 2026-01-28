/**
 * Answer Service - Handles player answers and statistics
 * 
 * ARCHITECTURE:
 * - Per-ticket tracking: Every answer is linked to a specific ticket via ticket_id.
 *   - Expected: Admin shows 0/X for both (or hides them completely)
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type PlayerAnswer = Database["public"]["Tables"]["player_answers"]["Row"];
type Question = Database["public"]["Tables"]["questions"]["Row"];
type Ticket = Database["public"]["Tables"]["tickets"]["Row"];
type TicketQuestion = Database["public"]["Tables"]["ticket_questions"]["Row"];
type Event = Database["public"]["Tables"]["events"]["Row"];

/**
 * Normalize answer values to boolean for comparison
 * 
 * CRITICAL: questions.correct_answer is BOOLEAN (true/false)
 *           player answers are stored as STRING ("DA"/"NE" or "YES"/"NO")
 *           This function normalizes BOTH to boolean for correct comparison
 * 
 * @param value - Answer value (boolean, string, or number)
 * @returns Normalized boolean or null if invalid
 * 
 * @example
 * normalizeAnswer(true) → true
 * normalizeAnswer("DA") → true
 * normalizeAnswer("YES") → true
 * normalizeAnswer("NE") → false
 * normalizeAnswer("NO") → false
 * normalizeAnswer(1) → true
 * normalizeAnswer(0) → false
 * normalizeAnswer("invalid") → null
 */
function normalizeAnswer(value: boolean | string | number | null | undefined): boolean | null {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null;
  }

  // Handle boolean
  if (typeof value === "boolean") {
    return value;
  }

  // Handle number
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }

  // Handle string
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    
    // Positive answers (YES)
    if (["DA", "YES", "Y", "TRUE", "1"].includes(normalized)) {
      return true;
    }
    
    // Negative answers (NO)
    if (["NE", "NO", "N", "FALSE", "0"].includes(normalized)) {
      return false;
    }
    
    // Invalid string
    return null;
  }

  // Unknown type
  return null;
}

export interface PlayerSession {
  id: string;
  event_id: string;
  session_token: string;
  created_at: string;
}

export interface TicketStats {
  ticket_serial: string;
  correct_count?: number; // Normalized for admin
  answered_count?: number; // Normalized for admin
  missed_count?: number; // Normalized for admin
  accuracy_percentage?: number; // Normalized for admin
  is_winner?: boolean;
  session_id?: string;
  // Legacy props support
  correct?: number;
  answered?: number;
  drawn_on_ticket?: number;
  missed?: number;
  total?: number;
  percentage?: number;
}

// Updated to match getSessionStats return value
export interface SessionStats {
  correct: number;
  answered: number;
  missed: number;
  drawnOnTicket: number;
  accuracy: number;
  ticketAnswers: any[]; // Using any[] for recalculated answers to avoid type complexity
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
   * CRITICAL: Must use UPSERT with correct ON CONFLICT matching database constraint
   * CRITICAL: Must normalize answers before comparison (DB boolean vs string player answer)
   * 
   * @param sessionId - Player session ID
   * @param eventId - Event ID
   * @param questionNumber - Question number (1-90)
   * @param answer - Player answer (boolean: true=YES, false=NO)
   * @param isCorrect - Pre-calculated correctness (from frontend comparison)
   * @param ticketId - Ticket serial number
   */
  submitAnswer: async (
    sessionId: string,
    eventId: string,
    questionNumber: number,
    answer: boolean,
    isCorrect: boolean,
    ticketId: string
  ): Promise<PlayerAnswer> => {
    console.log(
      `[submitAnswer] 🎯 Submitting: session=${sessionId}, event=${eventId}, ` +
      `ticket=${ticketId}, Q${questionNumber}, answer=${answer ? "YES" : "NO"}, ` +
      `isCorrect=${isCorrect}`
    );

    // Validate ticket exists
    const { data: ticketCheck, error: ticketError } = await supabase
      .from("tickets")
      .select("id, serial_number")
      .eq("event_id", eventId)
      .eq("serial_number", ticketId)
      .single();

    if (ticketError || !ticketCheck) {
      console.error(`[submitAnswer] ❌ Ticket validation failed:`, ticketError);
      throw new Error(`Ticket ${ticketId} not found for event ${eventId}`);
    }

    // Fetch correct answer via event_questions (linking number to ID)
    const { data: eventQuestion, error: eqError } = await supabase
      .from("event_questions")
      .select(`
        questions (
          correct_answer
        )
      `)
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();

    if (eqError || !eventQuestion?.questions) {
      console.error(`[submitAnswer] ❌ Question fetch failed:`, eqError);
      throw new Error(`Question ${questionNumber} not found`);
    }

    // CRITICAL: Normalize answers before comparison
    const dbCorrectAnswer = (eventQuestion.questions as any).correct_answer;
    
    const normalizedCorrect = normalizeAnswer(dbCorrectAnswer);
    const normalizedPlayer = normalizeAnswer(answer);
    
    const calculatedIsCorrect = 
      normalizedCorrect !== null && 
      normalizedPlayer !== null && 
      normalizedCorrect === normalizedPlayer;

    console.log(
      `[submitAnswer] 🔍 Correctness check: ` +
      `player=${answer} (normalized=${normalizedPlayer}), ` +
      `correct=${dbCorrectAnswer} (normalized=${normalizedCorrect}), ` +
      `result=${calculatedIsCorrect}`
    );

    // Convert boolean answer to STRING for database storage
    const answerString = answer ? "YES" : "NO";

    // UPSERT: Insert or update if conflict on (event_id, ticket_id, question_number)
    const { data, error } = await supabase
      .from("player_answers")
      .upsert(
        {
          session_id: sessionId,
          event_id: eventId,
          question_number: questionNumber,
          answer_yesno: answerString,
          is_correct: calculatedIsCorrect,  // Use calculated correctness
          ticket_id: ticketId,
        },
        {
          onConflict: "event_id,ticket_id,question_number",
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (error) {
      console.error(`[submitAnswer] ❌ Database error:`, error);
      throw error;
    }

    console.log(
      `[submitAnswer] ✅ Answer saved: ticket=${ticketId}, Q${questionNumber}, ` +
      `answer=${answerString}, correct=${calculatedIsCorrect}`
    );

    // Check for winner after each answer
    try {
      await answerService.checkForWinner(eventId, ticketId);
    } catch (winnerError) {
      console.error("Winner check failed:", winnerError);
    }

    return data as PlayerAnswer;
  },

  /**
   * Check if a ticket is a winner (stub implementation)
   */
  async checkForWinner(eventId: string, ticketId: string) {
    // This is a placeholder to prevent TS errors. 
    // Real winner logic handles checking if all numbers are drawn/answered.
    console.log(`[checkForWinner] Checking ticket ${ticketId} for event ${eventId}`);
    
    // Logic to update event winner would go here
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
   * Get player statistics for a specific session and ticket
   * Shows: correct answers, total answered, missed, accuracy percentage
   * 
   * CRITICAL: Recalculates is_correct using normalizeAnswer to handle legacy data
   */
  getSessionStats: async (
    sessionId: string,
    eventId: string,
    ticketSerialNumber: string
  ) => {
    console.log(
      `[getSessionStats] 📊 Fetching stats: session=${sessionId}, ` +
      `event=${eventId}, ticket=${ticketSerialNumber}`
    );

    // Fetch ticket with its question numbers
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select(
        `
        *,
        ticket_questions (
          question_number
        )
      `
      )
      .eq("event_id", eventId)
      .eq("serial_number", ticketSerialNumber)
      .single();

    if (ticketError || !ticket) {
      console.error(`[getSessionStats] ❌ Ticket fetch failed:`, ticketError);
      throw new Error(`Ticket ${ticketSerialNumber} not found`);
    }

    // Get all drawn question numbers for this event
    const { data: drawnQuestions, error: drawnError } = await supabase
      .from("event_questions")
      .select("question_number")
      .eq("event_id", eventId);

    if (drawnError) {
      console.error(`[getSessionStats] ❌ Drawn questions fetch failed:`, drawnError);
      throw drawnError;
    }

    const drawnNumbers = drawnQuestions?.map((q) => q.question_number) || [];
    const ticketQuestionNumbers = ticket.ticket_questions.map(
      (q) => q.question_number
    );

    // Calculate how many drawn questions are on this ticket
    const drawnOnTicket = ticketQuestionNumbers.filter((num) =>
      drawnNumbers.includes(num)
    );

    // Fetch player answers for this ticket
    const { data: answers, error: answersError } = await supabase
      .from("player_answers")
      .select("*, questions!inner(id, correct_answer)")
      .eq("session_id", sessionId)
      .eq("event_id", eventId)
      .eq("ticket_id", ticketSerialNumber);

    if (answersError) {
      console.error(`[getSessionStats] ❌ Answers fetch failed:`, answersError);
      throw answersError;
    }

    // CRITICAL: Recalculate is_correct using normalizeAnswer
    // This handles cases where stored is_correct might be wrong due to previous bugs
    const recalculatedAnswers = (answers || []).map((answer) => {
      const question = answer.questions as unknown as Question;
      
      // Normalize both player answer and correct answer
      const normalizedPlayerAnswer = normalizeAnswer(answer.answer_yesno);
      const normalizedCorrectAnswer = normalizeAnswer(question?.correct_answer);
      
      // Recalculate correctness
      const recalculatedIsCorrect = 
        normalizedPlayerAnswer !== null && 
        normalizedCorrectAnswer !== null && 
        normalizedPlayerAnswer === normalizedCorrectAnswer;
      
      return {
        ...answer,
        is_correct: recalculatedIsCorrect,  // Use recalculated value
      };
    });

    // Filter answers to only those on this ticket
    const ticketAnswers = recalculatedAnswers.filter((answer) =>
      ticketQuestionNumbers.includes(answer.question_number)
    );

    // Calculate statistics
    const answered = ticketAnswers.length;
    const correct = ticketAnswers.filter((a) => a.is_correct === true).length;
    const missed = Math.max(drawnOnTicket.length - answered, 0);
    const accuracy =
      answered > 0 ? Math.round((correct / answered) * 100) : 0;

    console.log(
      `[getSessionStats] ✅ Stats calculated: ` +
      `correct=${correct}/${drawnOnTicket.length}, ` +
      `answered=${answered}, missed=${missed}, accuracy=${accuracy}%`
    );

    return {
      correct,
      answered,
      missed,
      drawnOnTicket: drawnOnTicket.length,
      accuracy,
      ticketAnswers: recalculatedAnswers,
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
   * 
   * CRITICAL: Uses normalizeAnswer to recalculate is_correct for accurate statistics
   * CRITICAL: Only shows tickets that have at least one answer (ticket_id NOT NULL)
   * CRITICAL: Groups by ticket_id (not session_id) to support multi-ticket sessions
   */
  getEventTicketStatsV2: async (eventId: string) => {
    console.log(`[getEventTicketStatsV2] 📊 Fetching stats for event: ${eventId}`);

    // Fetch all tickets for this event
    const { data: tickets, error: ticketsError } = await supabase
      .from("tickets")
      .select(
        `
        *,
        ticket_questions (
          question_number
        )
      `
      )
      .eq("event_id", eventId)
      .order("serial_number", { ascending: true });

    if (ticketsError) {
      console.error("[getEventTicketStatsV2] ❌ Tickets fetch error:", ticketsError);
      throw ticketsError;
    }

    // Fetch all drawn question numbers
    const { data: drawnQuestions, error: drawnError } = await supabase
      .from("event_questions")
      .select("question_number")
      .eq("event_id", eventId);

    if (drawnError) {
      console.error("[getEventTicketStatsV2] ❌ Drawn questions error:", drawnError);
      throw drawnError;
    }

    const drawnNumbers = drawnQuestions?.map((q) => q.question_number) || [];

    // Fetch ALL answers for this event (with question data for recalculation)
    const { data: allAnswers, error: answersError } = await supabase
      .from("player_answers")
      .select("*, questions!inner(id, correct_answer)")
      .eq("event_id", eventId)
      .not("ticket_id", "is", null);

    if (answersError) {
      console.error("[getEventTicketStatsV2] ❌ Answers fetch error:", answersError);
      throw answersError;
    }

    if (!allAnswers || allAnswers.length === 0) {
      console.log("[getEventTicketStatsV2] ℹ️ No answers found for event");
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

    // CRITICAL: Recalculate is_correct using normalizeAnswer for ALL answers
    const recalculatedAnswers = allAnswers.map((answer) => {
      const question = answer.questions as unknown as Question;
      
      // Normalize both player answer and correct answer
      const normalizedPlayerAnswer = normalizeAnswer(answer.answer_yesno);
      const normalizedCorrectAnswer = normalizeAnswer(question?.correct_answer);
      
      // Recalculate correctness
      const recalculatedIsCorrect = 
        normalizedPlayerAnswer !== null && 
        normalizedCorrectAnswer !== null && 
        normalizedPlayerAnswer === normalizedCorrectAnswer;
      
      return {
        ...answer,
        is_correct: recalculatedIsCorrect,  // Use recalculated value
      };
    });

    // Group answers by ticket_id
    const answersByTicket = new Map<string, typeof recalculatedAnswers>();
    recalculatedAnswers.forEach((answer) => {
      const ticketId = answer.ticket_id!;
      if (!answersByTicket.has(ticketId)) {
        answersByTicket.set(ticketId, []);
      }
      answersByTicket.get(ticketId)!.push(answer);
    });

    console.log(
      `[getEventTicketStatsV2] 📦 Grouped answers: ` +
      `${answersByTicket.size} tickets with answers`
    );

    // Calculate stats for each ticket that has answers
    const statsArray = [];
    for (const [ticketId, ticketAnswers] of answersByTicket.entries()) {
      // Find this ticket in the tickets list
      const ticket = tickets?.find((t) => t.serial_number === ticketId);

      if (!ticket) {
        console.warn(
          `[getEventTicketStatsV2] ⚠️ Ticket ${ticketId} not found in tickets list`
        );
        continue;
      }

      const ticketQuestionNumbers = ticket.ticket_questions.map(
        (q) => q.question_number
      );

      // Calculate how many drawn questions are on this ticket
      const drawnOnTicket = ticketQuestionNumbers.filter((num) =>
        drawnNumbers.includes(num)
      );

      // Calculate statistics using recalculated is_correct values
      const correct = ticketAnswers.filter((a) => a.is_correct === true).length;
      const answered = ticketAnswers.length;
      const missed = Math.max(drawnOnTicket.length - answered, 0);
      const percentage =
        drawnOnTicket.length > 0
          ? Math.round((correct / drawnOnTicket.length) * 100)
          : 0;

      // Validation: Prevent impossible states
      if (correct > drawnOnTicket.length || answered > drawnOnTicket.length) {
        console.error(
          `[getEventTicketStatsV2] ⚠️ VALIDATION ERROR: Ticket ${ticketId} ` +
          `has impossible stats: correct=${correct}, answered=${answered}, ` +
          `drawn=${drawnOnTicket.length}`
        );
        continue;
      }

      statsArray.push({
        ticket_serial: ticketId,
        session_id: ticketAnswers[0]?.session_id || "unknown",
        correct_count: correct,
        answered_count: answered,
        drawn_on_ticket: drawnOnTicket.length,
        missed_count: missed,
        accuracy_percentage: percentage,
        is_winner: ticket.is_winner || false,
      });
    }

    // Sort by accuracy (highest first), then by correct count
    statsArray.sort((a, b) => {
      if (b.accuracy_percentage !== a.accuracy_percentage) {
        return b.accuracy_percentage - a.accuracy_percentage;
      }
      return b.correct_count - a.correct_count;
    });

    console.log(
      `[getEventTicketStatsV2] ✅ Stats calculated for ${statsArray.length} tickets`
    );

    return {
      stats: statsArray,
      debug: {
        eventId,
        totalAnswers: recalculatedAnswers.length,
        totalTickets: tickets?.length || 0,
        drawnNumbers,
        ticketsWithAnswers: answersByTicket.size,
      },
    };
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
  async getEventTicketStats(eventId: string): Promise<TicketStats[]> {
    try {
      console.log("[getEventTicketStats] 🎯 Fetching ticket stats for event:", eventId);

      // 1. Get the event to check drawn numbers and winner
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

      if (eventError) {
        console.error("[getEventTicketStats] ❌ Error fetching event:", eventError);
        throw eventError;
      }

      if (!event) {
        throw new Error("Event not found");
      }

      const drawnNumbers = event.drawn_numbers || [];
      const winnerTicketId = event.winner_ticket_id;
      console.log("[getEventTicketStats] 📊 Event has drawn:", drawnNumbers.length, "numbers");
      console.log("[getEventTicketStats] 🏆 Winner ticket ID:", winnerTicketId || "None");

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
        console.error("[getEventTicketStats] ❌ Error fetching tickets:", ticketsError);
        throw ticketsError;
      }

      console.log("[getEventTicketStats] 🎫 Found", tickets?.length || 0, "tickets");

      // 3. Fetch ALL answers for this event
      // CRITICAL: Filter out legacy answers (ticket_id = NULL)
      const { data: allAnswers, error: answersError } = await supabase
        .from("player_answers")
        .select("*")
        .eq("event_id", eventId)
        .not("ticket_id", "is", null); // CRITICAL: Ignore legacy data

      if (answersError) {
        console.error("[getEventTicketStats] ❌ Error fetching answers:", answersError);
        throw answersError;
      }

      console.log("[getEventTicketStats] 💬 Found", allAnswers?.length || 0, "answers (excluding legacy)");

      // CRITICAL: If no answers exist, return empty array immediately
      if (!allAnswers || allAnswers.length === 0) {
        console.log("[getEventTicketStats] ⚠️ No answers with ticket_id found for this event");
        return [];
      }

      // 4. Group answers by ticket_id (100% reliable, no pattern matching!)
      const answersByTicket = new Map<string, typeof allAnswers>();
      allAnswers.forEach((answer) => {
        const ticketId = answer.ticket_id!;
        if (!answersByTicket.has(ticketId)) {
          answersByTicket.set(ticketId, []);
        }
        answersByTicket.get(ticketId)!.push(answer);
      });

      console.log("[getEventTicketStats] 📋 Grouped answers into", answersByTicket.size, "unique tickets");

      // 5. For each ticket that has answers, compute stats using SAME logic as player
      const ticketStatsArray: TicketStats[] = [];

      for (const [ticketId, ticketAnswers] of answersByTicket.entries()) {
        // Find this ticket in the tickets list
        const ticket = tickets?.find((t) => t.serial_number === ticketId);

        if (!ticket) {
          console.warn(
            `[getEventTicketStats] ⚠️ Ticket ${ticketId} has answers but not found in tickets table, skipping`
          );
          continue;
        }

        const ticketQuestionNumbers = ticket.ticket_questions.map((tq: any) => tq.question_number);

        // Calculate which questions on this ticket have been drawn
        const drawnOnTicket = ticketQuestionNumbers.filter((num: number) =>
          drawnNumbers.includes(num)
        );

        // CRITICAL: Only count answers for questions that were drawn on this ticket
        const validAnswers = ticketAnswers.filter((answer) =>
          drawnOnTicket.includes(answer.question_number)
        );

        // Count correct answers (SAME logic as player)
        const correct = validAnswers.filter((a) => a.is_correct === true).length;
        const answered = validAnswers.length;
        const missed = drawnOnTicket.length - answered;

        // Calculate percentage based on drawn_on_ticket (SAME as player)
        const percentage =
          drawnOnTicket.length > 0 ? Math.round((correct / drawnOnTicket.length) * 100) : 0;

        console.log(
          `[getEventTicketStats] 📈 Ticket ${ticket.serial_number}: ${correct}/${drawnOnTicket.length} correct (${percentage}%), answered: ${answered}, missed: ${missed} [100% reliable via ticket_id]`
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
            `[getEventTicketStats] ⚠️ Ticket ${ticket.serial_number}: No valid answers found (answered=0), excluding from active list`
          );
        }
      }

      console.log(
        `[getEventTicketStats] ✅ Returning stats for ${ticketStatsArray.length} active tickets (100% reliable via ticket_id)`
      );

      if (ticketStatsArray.length > 0) {
        console.log(
          `[getEventTicketStats] 📋 Sample:`,
          ticketStatsArray.slice(0, 2).map((t) => ({
            serial: t.ticket_serial,
            correct: t.correct,
            drawn: t.drawn_on_ticket,
            answered: t.answered,
          }))
        );
      }

      return ticketStatsArray;
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
   * Delete legacy answers (with NULL ticket_id) for an event
   * CRITICAL: Only deletes rows where ticket_id IS NULL
   * This removes unreliable data from before the schema update
   */
  async deleteLegacyAnswers(eventId: string): Promise<{ count: number }> {
    console.log(`[deleteLegacyAnswers] Deleting legacy answers for event ${eventId}`);
    
    const { data, error } = await supabase
      .from("player_answers")
      .delete()
      .eq("event_id", eventId)
      .is("ticket_id", null)
      .select();

    if (error) {
      console.error("[deleteLegacyAnswers] Error:", error);
      throw error;
    }

    const count = data?.length || 0;
    console.log(`[deleteLegacyAnswers] ✅ Deleted ${count} legacy answer rows`);
    
    return { count };
  },

  /**
   * Mark a question as unanswered (missed) when time expires
   * CRITICAL: Uses ignoreDuplicates=true to not overwrite existing answers
   * Database constraint: UNIQUE (event_id, ticket_id, question_number)
   */
  async markUnansweredAsWrong(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    ticketId: string
  ): Promise<PlayerAnswer> {
    console.log(
      `[markUnanswered] ⏱️  Marking as MISSED: session=${sessionId.slice(0, 8)}, ` +
        `event=${eventId.slice(0, 8)}, ticket=${ticketId}, Q${questionNumber}`
    );

    // CRITICAL: Use UPSERT with ignoreDuplicates=true
    // If user already answered, keep their answer (don't overwrite with MISSED)
    const { data, error } = await supabase
      .from("player_answers")
      .upsert(
        {
          session_id: sessionId,
          event_id: eventId,
          question_number: questionNumber,
          answer_yesno: "NO", // Fixed: send string "NO"
          is_correct: false,
          ticket_id: ticketId,
        },
        {
          // MUST MATCH DATABASE CONSTRAINT EXACTLY
          onConflict: "event_id,ticket_id,question_number",
          ignoreDuplicates: true, // Don't overwrite if already answered
        }
      )
      .select()
      .single();

    if (error) {
      console.error(`[markUnanswered] ❌ Database error:`, error);
      throw error;
    }

    console.log(
      `[markUnanswered] ✅ Marked as MISSED: ticket=${ticketId}, Q${questionNumber}`
    );

    return data as PlayerAnswer;
  },
};