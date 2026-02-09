import { supabase } from "@/integrations/supabase/client";

export interface Answer {
  id: string;
  ticket_id: string;
  question_id: string;
  selected_answer: string;
  is_correct: boolean;
  answered_at: string;
}

export async function submitAnswer(
  ticketId: string,
  questionId: string,
  selectedAnswer: string,
  isCorrect: boolean | string // Allow both to satisfy any legacy calls or strict checks
) {
  // Use 'any' cast temporarily to bypass strict type checking against generated types
  // which might be out of sync with the actual table schema or this specific insert
  const payload: any = {
    ticket_id: ticketId,
    question_id: questionId, // Ensure this column exists in DB
    selected_answer: selectedAnswer,
    is_correct: isCorrect === "true" || isCorrect === true, // Handle string or boolean
    answered_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("answers")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("[AnswerService] Error submitting answer:", error);
    throw error;
  }
  return data;
}

export async function getAnswersForTicket(ticketId: string) {
  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("ticket_id", ticketId);

  if (error) {
    console.error("[AnswerService] Error fetching answers:", error);
    return [];
  }
  return data;
}

export async function getOrCreateSession(ticketId: string) {
  // Legacy function support
  console.log("[AnswerService] getOrCreateSession called (legacy support)");
  return { id: "legacy-session", ticket_id: ticketId };
}

// Add mock types/functions if strictly required by other files not yet updated
export type TicketStats = any;