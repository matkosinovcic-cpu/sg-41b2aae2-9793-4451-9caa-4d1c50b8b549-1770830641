import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Normalize answer values to boolean for comparison
 * Handles: boolean, string ("YES"/"NO"/"DA"/"NE"), number (1/0)
 */
function normalizeAnswer(value: any): boolean | null {
  if (value === null || value === undefined) return null;
  
  if (typeof value === "boolean") return value;
  
  if (typeof value === "number") return value === 1;
  
  if (typeof value === "string") {
    const v = value.trim().toUpperCase();
    if (["YES", "DA", "Y", "TRUE", "1"].includes(v)) return true;
    if (["NO", "NE", "N", "FALSE", "0"].includes(v)) return false;
  }
  
  return null;
}

export interface PlayerSession {
  id: string;
  event_id: string;
  session_token: string;
  created_at?: string;
}

export interface PlayerAnswer {
  id: string;
  session_id: string;
  event_id: string;
  question_number: number;
  question_id: string;
  answer_yesno: string;
  is_correct: boolean;
  ticket_id: string;
  created_at?: string;
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

export interface DetailedQuestionResult {
  question_number: number;
  question_text: string;
  correct_answer: string;
  player_answer: string;
  result: string;
}

export interface TicketDetailedResults {
  ticket_serial: string;
  questions: DetailedQuestionResult[];
}

export const answerService = {
  /**
   * Get or create a player session
   */
  async getOrCreateSession(eventId: string): Promise<PlayerSession> {
    const sessionToken = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const { data, error } = await supabase
      .from("player_sessions")
      .insert({
        event_id: eventId,
        session_token: sessionToken,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create session: ${error.message}`);
    }

    console.log("[answerService] ✅ Session created:", data.id);
    return data as PlayerSession;
  },

  /**
   * Submit an answer for a question
   * UPSERT ensures idempotency using UNIQUE constraint (event_id, ticket_id, question_number)
   */
  async submitAnswer(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    answerValue: boolean,
    isCorrect: boolean,
    ticketSerial: string
  ): Promise<PlayerAnswer> {
    console.log("[answerService] Submitting answer:", {
      sessionId,
      eventId,
      questionNumber,
      answerValue,
      isCorrect,
      ticketSerial,
    });

    // Step 1: Get question_id from event_questions
    const { data: eventQuestion, error: eqError } = await supabase
      .from("event_questions")
      .select("question_id")
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();

    if (eqError || !eventQuestion) {
      throw new Error(`Question #${questionNumber} not found in event`);
    }

    // Step 2: Convert boolean to YES/NO
    const answerYesNo = answerValue ? "YES" : "NO";

    // Step 3: UPSERT with proper conflict target
    const { data, error } = await supabase
      .from("player_answers")
      .upsert(
        {
          session_id: sessionId,
          event_id: eventId,
          question_number: questionNumber,
          question_id: eventQuestion.question_id,
          answer_yesno: answerYesNo,
          is_correct: isCorrect,
          ticket_id: ticketSerial,
        },
        {
          onConflict: "event_id,ticket_id,question_number",
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (error) {
      console.error("[answerService] ❌ Submit failed:", error);
      throw new Error(error.message);
    }

    console.log("[answerService] ✅ Answer submitted:", data.id);

    // Check for winner
    try {
      // @ts-expect-error - RPC function exists in DB but types might be missing
      await supabase.rpc("check_winner_tickets", { p_event_id: eventId });
    } catch (winnerError) {
      console.error("[answerService] Winner check failed:", winnerError);
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
      .eq("session_id", sessionId);

    if (error) {
      console.error("[answerService] Failed to load answers:", error);
      return [];
    }

    return (data || []) as PlayerAnswer[];
  },

  /**
   * Get player statistics for a specific session and ticket
   * TWO-PHASE FETCH: Avoids PGRST200 schema cache issues
   * 
   * Stats calculation:
   * - drawnOnTicket = questions on this ticket that were drawn
   * - answered = unique questions the player answered
   * - correct = answers matching correct_answer
   * - missed = drawnOnTicket - answered
   * - accuracy = (correct / answered) * 100
   */
  async getSessionStats(
    sessionId: string,
    eventId: string,
    ticketSerial: string
  ): Promise<SessionStats> {
    console.log("[answerService] Loading stats for:", {
      sessionId,
      eventId,
      ticketSerial,
    });

    // Step 1: Get player answers (no join)
    const { data: answers, error: answersError } = await supabase
      .from("player_answers")
      .select("question_id, question_number, answer_yesno")
      .eq("session_id", sessionId)
      .eq("event_id", eventId)
      .eq("ticket_id", ticketSerial);

    if (answersError) {
      console.error("[answerService] Failed to load answers:", answersError);
      return {
        correct: 0,
        answered: 0,
        missed: 0,
        drawnOnTicket: 0,
        accuracy: 0,
      };
    }

    const playerAnswers = answers || [];

    // Step 2: Get event data
    const { data: event } = await supabase
      .from("events")
      .select("drawn_numbers")
      .eq("id", eventId)
      .single();

    const drawnNumbers = new Set(event?.drawn_numbers || []);

    // Step 3: Get ticket questions
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, ticket_questions(question_number)")
      .eq("serial_number", ticketSerial)
      .single();

    const ticketQuestions =
      ticket?.ticket_questions?.map((tq: any) => tq.question_number) || [];
    const drawnOnTicket = ticketQuestions.filter((qn: number) =>
      drawnNumbers.has(qn)
    );

    // Step 4: Get correct answers for answered questions
    if (playerAnswers.length === 0) {
      return {
        correct: 0,
        answered: 0,
        missed: Math.max(0, drawnOnTicket.length),
        drawnOnTicket: drawnOnTicket.length,
        accuracy: 0,
      };
    }

    const questionIds = playerAnswers.map((a) => a.question_id);
    const { data: questions } = await supabase
      .from("questions")
      .select("id, correct_answer")
      .in("id", questionIds);

    const correctAnswerMap = new Map(
      (questions || []).map((q: any) => [q.id, q.correct_answer])
    );

    // Step 5: Calculate stats
    let correct = 0;
    const uniqueAnswered = new Set<number>();

    playerAnswers.forEach((ans) => {
      uniqueAnswered.add(ans.question_number);

      const playerNormalized = normalizeAnswer(ans.answer_yesno);
      const correctNormalized = normalizeAnswer(
        correctAnswerMap.get(ans.question_id)
      );

      if (
        playerNormalized !== null &&
        correctNormalized !== null &&
        playerNormalized === correctNormalized
      ) {
        correct++;
      }
    });

    const answered = uniqueAnswered.size;
    const missed = Math.max(0, drawnOnTicket.length - answered);
    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;

    console.log("[answerService] ✅ Stats calculated:", {
      correct,
      answered,
      missed,
      drawnOnTicket: drawnOnTicket.length,
      accuracy,
    });

    return {
      correct,
      answered,
      missed,
      drawnOnTicket: drawnOnTicket.length,
      accuracy,
    };
  },

  /**
   * Get detailed results for a ticket (for expandable view)
   */
  async getTicketDetailedResults(
    sessionId: string,
    ticket: any,
    eventId: string,
    drawnNumbers: number[]
  ): Promise<TicketDetailedResults> {
    const drawnSet = new Set(drawnNumbers);
    const ticketNumbers =
      ticket.ticket_questions?.map((tq: any) => tq.question_number) || [];
    const drawnOnTicket = ticketNumbers.filter((qn: number) =>
      drawnSet.has(qn)
    );

    // Get player answers
    const { data: answers } = await supabase
      .from("player_answers")
      .select("question_id, question_number, answer_yesno")
      .eq("session_id", sessionId)
      .eq("event_id", eventId)
      .eq("ticket_id", ticket.serial_number);

    const answerMap = new Map(
      (answers || []).map((a: any) => [a.question_number, a])
    );

    // Get event questions
    const { data: eventQuestions } = await supabase
      .from("event_questions")
      .select("question_number, question_id, questions(text, correct_answer)")
      .eq("event_id", eventId)
      .in("question_number", drawnOnTicket);

    const results: DetailedQuestionResult[] = (eventQuestions || []).map(
      (eq: any) => {
        const qNum = eq.question_number;
        const playerAns = answerMap.get(qNum);
        const correctAns = eq.questions?.correct_answer;

        const correctNormalized = normalizeAnswer(correctAns);
        const playerNormalized = playerAns
          ? normalizeAnswer(playerAns.answer_yesno)
          : null;

        let result = "Propušteno";
        if (playerNormalized !== null) {
          result =
            playerNormalized === correctNormalized ? "Točno" : "Netočno";
        }

        return {
          question_number: qNum,
          question_text: eq.questions?.text || "N/A",
          correct_answer: correctNormalized ? "DA" : "NE",
          player_answer: playerNormalized === null
            ? "Nije odgovoreno"
            : playerNormalized
            ? "DA"
            : "NE",
          result,
        };
      }
    );

    return {
      ticket_serial: ticket.serial_number,
      questions: results,
    };
  },

  /**
   * Mark a question as unanswered (missed) when time expires
   */
  async markUnansweredAsWrong(
    sessionId: string,
    eventId: string,
    questionNumber: number,
    ticketSerial: string
  ): Promise<PlayerAnswer> {
    console.log("[answerService] ⏱️ Marking as MISSED:", {
      sessionId,
      eventId,
      questionNumber,
      ticketSerial,
    });

    // Check if already answered
    const { data: existing } = await supabase
      .from("player_answers")
      .select("id")
      .eq("session_id", sessionId)
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .eq("ticket_id", ticketSerial)
      .single();

    if (existing) {
      console.log("[answerService] Already answered, skipping");
      return existing as PlayerAnswer;
    }

    // Get question_id
    const { data: eventQuestion, error: eqError } = await supabase
      .from("event_questions")
      .select("question_id")
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();

    if (eqError || !eventQuestion) {
      throw new Error(`Question #${questionNumber} not found`);
    }

    // Insert missed answer
    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        question_id: eventQuestion.question_id,
        answer_yesno: "NO",
        is_correct: false,
        ticket_id: ticketSerial,
      })
      .select()
      .single();

    if (error) {
      console.error("[answerService] Failed to mark missed:", error);
      throw new Error(error.message);
    }

    console.log("[answerService] ✅ Marked as MISSED");
    return data as PlayerAnswer;
  },

  /**
   * Get statistics for all tickets in an event (admin view)
   * MUST MATCH player view exactly
   */
  async getEventTicketStats(eventId: string): Promise<TicketStats[]> {
    console.log("[answerService] Loading event stats for:", eventId);

    // Step 1: Get event data
    const { data: event } = await supabase
      .from("events")
      .select("drawn_numbers")
      .eq("id", eventId)
      .single();

    const drawnNumbers = new Set(event?.drawn_numbers || []);

    // Step 2: Get all tickets
    const { data: tickets } = await supabase
      .from("tickets")
      .select("serial_number, ticket_questions(question_number)")
      .eq("event_id", eventId);

    if (!tickets || tickets.length === 0) {
      return [];
    }

    // Step 3: Get all player answers (no join)
    const { data: answers } = await supabase
      .from("player_answers")
      .select("ticket_id, question_id, question_number, answer_yesno")
      .eq("event_id", eventId);

    const playerAnswers = answers || [];

    // Step 4: Get correct answers for all answered questions
    const questionIds = [...new Set(playerAnswers.map((a: any) => a.question_id))];
    const { data: questions } = await supabase
      .from("questions")
      .select("id, correct_answer")
      .in("id", questionIds);

    const correctAnswerMap = new Map(
      (questions || []).map((q: any) => [q.id, q.correct_answer])
    );

    // Step 5: Calculate stats per ticket
    const stats: TicketStats[] = tickets.map((ticket: any) => {
      const ticketNumbers =
        ticket.ticket_questions?.map((tq: any) => tq.question_number) || [];
      const drawnOnTicket = ticketNumbers.filter((qn: number) =>
        drawnNumbers.has(qn)
      ).length;

      const ticketAnswers = playerAnswers.filter(
        (a: any) => a.ticket_id === ticket.serial_number
      );

      const uniqueAnswered = new Set(
        ticketAnswers.map((a: any) => a.question_number)
      ).size;

      let correct = 0;
      ticketAnswers.forEach((ans: any) => {
        const playerNormalized = normalizeAnswer(ans.answer_yesno);
        const correctNormalized = normalizeAnswer(
          correctAnswerMap.get(ans.question_id)
        );

        if (
          playerNormalized !== null &&
          correctNormalized !== null &&
          playerNormalized === correctNormalized
        ) {
          correct++;
        }
      });

      const missed = Math.max(0, drawnOnTicket - uniqueAnswered);
      const percentage =
        uniqueAnswered > 0 ? Math.round((correct / uniqueAnswered) * 100) : 0;

      return {
        ticket_serial: ticket.serial_number,
        correct,
        answered: uniqueAnswered,
        missed,
        drawn_on_ticket: drawnOnTicket,
        percentage,
      };
    });

    console.log("[answerService] ✅ Event stats calculated:", stats.length);
    return stats;
  },

  /**
   * Subscribe to event answers for real-time updates
   */
  subscribeToEventAnswers(eventId: string, callback: () => void) {
    return supabase
      .channel(`answers:${eventId}`)
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