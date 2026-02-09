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
  answer: boolean,
  isCorrect: boolean | string
) {
  // Normalize isCorrect to boolean
  const isCorrectBool = typeof isCorrect === "boolean" ? isCorrect : isCorrect === "true";
  
  const payload = {
    ticket_id: ticketId,
    question_number: parseInt(questionId) || 0,
    answer: answer,
    is_correct: isCorrectBool
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
  console.log("[AnswerService] getOrCreateSession called (legacy support)");
  return { id: "legacy-session", ticket_id: ticketId };
}

export type TicketStats = any;