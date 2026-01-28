import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type PlayerAnswer = Database["public"]["Tables"]["player_answers"]["Row"];

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

function checkCorrectness(playerAnswer: string | boolean, correctAnswer: string): boolean {
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
      .insert({ event_id: eventId })
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
   * Get session stats for a specific ticket (NUMBERS-ONLY logic)
   */
  async getSessionStats(
    sessionId: string,
    eventId: string,
    ticketSerial: string
  ): Promise<SessionStats> {
    // 1. Get answers for this ticket
    const { data: answers } = await supabase
      .from("player_answers")
      .select("is_correct")
      .eq("event_id", eventId)
      .eq("ticket_id", ticketSerial);

    const correct = answers?.filter(a => a.is_correct).length || 0;
    const answered = answers?.length || 0;

    // 2. Get drawn count for this ticket
    const { data: ticket } = await supabase
      .from("tickets")
      .select("ticket_questions(question_number)")
      .eq("serial_number", ticketSerial)
      .single();

    const { data: event } = await supabase
      .from("events")
      .select("drawn_numbers")
      .eq("id", eventId)
      .single();

    const drawnNumbers = new Set(event?.drawn_numbers || []);
    
    // Count how many questions on this ticket have been drawn
    const drawnOnTicket = ticket?.ticket_questions?.filter(tq => 
      drawnNumbers.has(tq.question_number)
    ).length || 0;

    // 3. Calculate stats
    const missed = Math.max(0, drawnOnTicket - answered);
    
    // Accuracy based on DRAWN count (not answered count)
    const accuracy = drawnOnTicket > 0 
      ? Math.min(100, Math.round((correct / drawnOnTicket) * 100))
      : 0;

    return { correct, answered, missed, drawnOnTicket, accuracy };
  },

  /**
   * Get aggregated stats for Admin/TV (NUMBERS-ONLY logic)
   */
  async getEventTicketStats(eventId: string): Promise<TicketStats[]> {
    // 1. Get all answers
    const { data: answers } = await supabase
      .from("player_answers")
      .select("ticket_id, is_correct")
      .eq("event_id", eventId);

    // Group by ticket
    const statsByTicket = new Map<string, { correct: number; answered: number }>();
    answers?.forEach(a => {
      const current = statsByTicket.get(a.ticket_id) || { correct: 0, answered: 0 };
      current.answered++;
      if (a.is_correct) current.correct++;
      statsByTicket.set(a.ticket_id, current);
    });

    // 2. Get all tickets and event drawn numbers
    const { data: tickets } = await supabase
      .from("tickets")
      .select("serial_number, ticket_questions(question_number)")
      .eq("event_id", eventId);

    const { data: event } = await supabase
      .from("events")
      .select("drawn_numbers")
      .eq("id", eventId)
      .single();

    const drawnNumbers = new Set(event?.drawn_numbers || []);

    // 3. Build result
    return (tickets || []).map(t => {
      const drawnOnTicket = t.ticket_questions.filter(tq => 
        drawnNumbers.has(tq.question_number)
      ).length;

      const stats = statsByTicket.get(t.serial_number) || { correct: 0, answered: 0 };
      
      const missed = Math.max(0, drawnOnTicket - stats.answered);
      const percentage = drawnOnTicket > 0
        ? Math.min(100, Math.round((stats.correct / drawnOnTicket) * 100))
        : 0;

      return {
        ticket_serial: t.serial_number,
        correct: stats.correct,
        answered: stats.answered,
        missed,
        drawn_on_ticket: drawnOnTicket,
        percentage
      };
    });
  },

  /**
   * Get detailed per-question results for a ticket
   */
  async getTicketDetailedResults(
    sessionId: string, // Kept for interface compat, unused
    ticket: any,
    eventId: string,
    drawnNumbers: number[]
  ): Promise<TicketDetailedResults> {
    const drawnSet = new Set(drawnNumbers);
    const ticketNumbers = ticket.ticket_questions.map((tq: any) => tq.question_number);

    // Get questions text and correct answer
    // We need to fetch event_questions to get question_ids, then questions
    const { data: eventQuestions } = await supabase
      .from("event_questions")
      .select("question_number, question_id")
      .eq("event_id", eventId)
      .in("question_number", ticketNumbers);

    const qMap = new Map();
    if (eventQuestions) {
        const qIds = eventQuestions.map(eq => eq.question_id);
        const { data: questions } = await supabase
            .from("questions")
            .select("id, text, correct_answer")
            .in("id", qIds);
        
        questions?.forEach(q => qMap.set(q.id, q));
    }
    
    // Map question_number -> question data
    const numToQuestion = new Map();
    eventQuestions?.forEach(eq => {
        const q = qMap.get(eq.question_id);
        if (q) numToQuestion.set(eq.question_number, q);
    });

    // Get player answers
    const { data: answers } = await supabase
      .from("player_answers")
      .select("question_number, answer_yesno, is_correct")
      .eq("event_id", eventId)
      .eq("ticket_id", ticket.serial_number);

    const answersMap = new Map();
    answers?.forEach(a => answersMap.set(a.question_number, a));

    const results = ticketNumbers.map((num: number) => {
      const question = numToQuestion.get(num);
      const answer = answersMap.get(num);
      const isDrawn = drawnSet.has(num);

      let result: "Točno" | "Netočno" | "Propušteno" | "Nije izvučeno" = "Nije izvučeno";
      
      if (isDrawn) {
        if (answer) {
            result = answer.is_correct ? "Točno" : "Netočno";
        } else {
            result = "Propušteno";
        }
      }

      return {
        question_number: num,
        question_text: question?.text || "Unknown question",
        correct_answer: question?.correct_answer || "?",
        player_answer: answer ? answer.answer_yesno : "Nije odgovoreno",
        is_correct: answer ? answer.is_correct : null,
        result
      };
    }).sort((a: any, b: any) => a.question_number - b.question_number);

    return {
      ticket_serial: ticket.serial_number,
      questions: results
    };
  },

  /**
   * Real-time subscription
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