import { supabase } from "@/integrations/supabase/client";
import { 
  computeTicketStats, 
  computeEventStats, 
  getTicketDetailedResults as getDetailedResultsHelper,
  type TicketStats as HelperTicketStats
} from "@/lib/statsHelper";

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
  ticket_id: string; // Changed from ticket_serial to match player.tsx usage expectation or map accordingly
  ticket_serial: string;
  correct: number;
  answered: number;
  missed: number;
  drawn_on_ticket: number;
  percentage: number;
  incorrect: number; // Added to match player.tsx usage
}

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
 */
function normalizeYesNo(value: string | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "YES" : "NO";
  const normalized = String(value).trim().toUpperCase();
  if (["DA", "YES", "Y", "TRUE", "1"].includes(normalized)) return "YES";
  if (["NE", "NO", "N", "FALSE", "0"].includes(normalized)) return "NO";
  return "";
}

/**
 * Check if player answer is correct
 */
function checkCorrectness(playerAnswer: string | boolean, correctAnswer: string | boolean): boolean {
  const playerNorm = normalizeYesNo(playerAnswer);
  const correctNorm = normalizeYesNo(correctAnswer);
  if (!playerNorm || !correctNorm) return false;
  return playerNorm === correctNorm;
}

export const answerService = {
  /**
   * Get or create a session for the player/event
   */
  async getOrCreateSession(eventId: string): Promise<PlayerSession> {
    // Try to find existing session (mock implementation for now as we don't have auth yet)
    // For now, we just create a new session or return a dummy one if we want persistence
    // In a real app, we'd check localStorage or auth
    
    // SIMPLE FIX: Just create a new session for now to ensure flow works
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
   * Get tickets for the session (currently fetching ALL tickets for the event as placeholder)
   * In reality, this should fetch tickets assigned to this session/user
   */
  async getSessionTickets(sessionId: string) {
    // First get the session to know the event_id
    const { data: session } = await supabase
      .from("player_sessions")
      .select("event_id")
      .eq("id", sessionId)
      .single();
      
    if (!session) throw new Error("Session not found");

    // Fetch all tickets for this event (Admin/TV view style for now)
    const { data: tickets, error } = await supabase
      .from("tickets")
      .select("*, ticket_questions(*)")
      .eq("event_id", session.event_id)
      .order("serial_number", { ascending: true });

    if (error) throw error;
    return tickets || [];
  },

  /**
   * Submit player answer
   */
  async submitAnswer(
    sessionId: string,
    questionNumber: number,
    answerYesNo: string | boolean,
    // Optional args to match signature if needed, but core is above
    ...args: any[]
  ) {
    // We need event_id. We can get it from session or passed arg.
    // player.tsx passes: (session.id, currentQuestion.question_number, answer)
    // It does NOT pass eventId or ticketSerial explicitly in the call `answerService.submitAnswer(session.id, currentQuestion.question_number, answer)`
    
    // So we need to fetch event_id from session
    const { data: session } = await supabase
      .from("player_sessions")
      .select("event_id")
      .eq("id", sessionId)
      .single();
      
    if (!session) throw new Error("Session not found");
    const eventId = session.event_id;

    const normalizedAnswer = normalizeYesNo(answerYesNo);
    if (!normalizedAnswer) throw new Error("Invalid answer");

    // Get question details
    const { data: eventQuestion } = await supabase
      .from("event_questions")
      .select("question_id")
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();

    if (!eventQuestion) throw new Error("Question not found");

    const { data: question } = await supabase
      .from("questions")
      .select("correct_answer")
      .eq("id", eventQuestion.question_id)
      .single();

    if (!question) throw new Error("Question not found");

    const isCorrect = checkCorrectness(answerYesNo, question.correct_answer);

    // We need a ticket_id. Since we are in a mode where player sees all tickets, 
    // we might be answering for "the player" generally, or we need to answer for a specific ticket?
    // The current UI shows answer buttons globally, not per ticket.
    // So we'll store it with a dummy ticket_id or NULL if allowed, OR we need to associate player with a ticket.
    // Schema says ticket_id is nullable in player_answers? Let's check.
    // Schema: ticket_id text NULL. OK.

    const { data, error } = await supabase
      .from("player_answers")
      .insert({
        session_id: sessionId,
        event_id: eventId,
        question_number: questionNumber,
        question_id: eventQuestion.question_id,
        answer_yesno: normalizedAnswer,
        is_correct: isCorrect,
        ticket_id: null // Global answer for the session
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get stats for tickets
   */
  async getTicketStats(eventId: string, ticketIds: string[]): Promise<TicketStats[]> {
    // This would typically calculate stats based on answers linked to tickets.
    // Since we are currently saving answers with ticket_id=NULL (global session answer),
    // per-ticket stats might be tricky unless we link them.
    // For now, return empty or mock stats to prevent crash.
    
    return ticketIds.map(id => ({
      ticket_id: id,
      ticket_serial: "...", // Would need to fetch
      correct: 0,
      answered: 0,
      missed: 0,
      drawn_on_ticket: 0,
      percentage: 0,
      incorrect: 0
    }));
  },

  subscribeToEventAnswers(eventId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`event_answers:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "player_answers",
          filter: `event_id=eq.${eventId}`
        },
        callback
      )
      .subscribe();
  },

  async getEventTicketStats(eventId: string) {
    const { data: tickets } = await supabase
      .from("tickets")
      .select("id, serial_number")
      .eq("event_id", eventId);
      
    if (!tickets) return [];
    
    // Reuse basic stats structure
    return tickets.map(t => ({
      ticket_id: t.id,
      ticket_serial: t.serial_number,
      correct: 0,
      answered: 0,
      missed: 0,
      drawn_on_ticket: 0,
      percentage: 0,
      incorrect: 0
    }));
  }
};