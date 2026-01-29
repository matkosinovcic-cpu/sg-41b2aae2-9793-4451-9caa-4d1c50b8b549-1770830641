import { supabase } from "@/integrations/supabase/client";

/**
 * DEFINITIVE STATS COMPUTATION
 * Rules:
 * - Only count DRAWN questions (from events.drawn_numbers)
 * - Deduplicate player_answers by question_number (take latest if multiple)
 * - correct <= drawn, answered <= drawn, missed = drawn - answered
 * - accuracy max 100%
 */

export interface TicketStats {
  ticketSerial: string;
  drawnCount: number;
  answeredCount: number;
  correctCount: number;
  missedCount: number;
  accuracyPercent: number;
}

export interface EventStats {
  totalDrawn: number;
  totalCorrect: number;
  totalAnswered: number;
  totalMissed: number;
  averageAccuracy: number;
  ticketStats: TicketStats[];
}

/**
 * Get list of drawn question numbers for an event
 */
export async function getDrawnQuestionNumbers(eventId: string): Promise<number[]> {
  const { data: event, error } = await supabase
    .from("events")
    .select("drawn_numbers")
    .eq("id", eventId)
    .single();

  if (error) {
    console.error("[statsHelper] Failed to fetch drawn_numbers:", error);
    return [];
  }

  return event?.drawn_numbers || [];
}

/**
 * Get deduplicated player answers for a specific ticket
 * If multiple answers exist for same question_number, takes the latest (by created_at)
 */
export async function getTicketAnswersDedup(
  eventId: string,
  ticketSerial: string
): Promise<Array<{ question_number: number; is_correct: boolean; answer_yesno: string; created_at: string }>> {
  const { data: answers, error } = await supabase
    .from("player_answers")
    .select("question_number, is_correct, answer_yesno, created_at")
    .eq("event_id", eventId)
    .eq("ticket_id", ticketSerial)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[statsHelper] Failed to fetch answers:", error);
    return [];
  }

  if (!answers || answers.length === 0) return [];

  // Deduplicate by question_number (keep first = latest due to DESC sort)
  const seen = new Set<number>();
  const deduped: Array<{ question_number: number; is_correct: boolean; answer_yesno: string; created_at: string }> = [];

  for (const answer of answers) {
    if (!seen.has(answer.question_number)) {
      seen.add(answer.question_number);
      deduped.push(answer);
    }
  }

  return deduped;
}

/**
 * Compute stats for a single ticket
 * ONLY counts questions that are in drawn_numbers list
 */
export async function computeTicketStats(
  eventId: string,
  ticketSerial: string
): Promise<TicketStats> {
  // 1. Get drawn numbers
  const drawnNumbers = await getDrawnQuestionNumbers(eventId);
  const drawnSet = new Set(drawnNumbers);
  const drawnCount = drawnNumbers.length;

  // 2. Get deduplicated answers
  const answers = await getTicketAnswersDedup(eventId, ticketSerial);

  // 3. Filter answers to only those that are drawn
  const drawnAnswers = answers.filter(a => drawnSet.has(a.question_number));

  // 4. Calculate stats
  const answeredCount = drawnAnswers.length;
  const correctCount = drawnAnswers.filter(a => a.is_correct === true).length;
  const missedCount = Math.max(0, drawnCount - answeredCount);

  // 5. Calculate accuracy (max 100%)
  const accuracyPercent = drawnCount > 0
    ? Math.min(100, Math.round((correctCount / drawnCount) * 100))
    : 0;

  // 6. Guardrails
  const safeCorrect = Math.min(correctCount, drawnCount);
  const safeAnswered = Math.min(answeredCount, drawnCount);

  return {
    ticketSerial,
    drawnCount,
    answeredCount: safeAnswered,
    correctCount: safeCorrect,
    missedCount,
    accuracyPercent,
  };
}

/**
 * Compute stats for all tickets in an event
 * Returns per-ticket breakdown + aggregated totals
 */
export async function computeEventStats(eventId: string): Promise<EventStats> {
  // 1. Get all tickets for this event
  const { data: tickets, error: ticketsError } = await supabase
    .from("tickets")
    .select("serial_number")
    .eq("event_id", eventId);

  if (ticketsError || !tickets || tickets.length === 0) {
    console.error("[statsHelper] Failed to fetch tickets:", ticketsError);
    return {
      totalDrawn: 0,
      totalCorrect: 0,
      totalAnswered: 0,
      totalMissed: 0,
      averageAccuracy: 0,
      ticketStats: [],
    };
  }

  // 2. Compute stats for each ticket
  const ticketStatsPromises = tickets.map(t => 
    computeTicketStats(eventId, t.serial_number)
  );
  const ticketStats = await Promise.all(ticketStatsPromises);

  // 3. Filter to only tickets with at least 1 answer (active tickets)
  const activeTicketStats = ticketStats.filter(ts => ts.answeredCount > 0);

  // 4. Aggregate totals
  const totalDrawn = ticketStats.length > 0 ? ticketStats[0].drawnCount : 0;
  const totalCorrect = activeTicketStats.reduce((sum, ts) => sum + ts.correctCount, 0);
  const totalAnswered = activeTicketStats.reduce((sum, ts) => sum + ts.answeredCount, 0);
  const totalMissed = activeTicketStats.reduce((sum, ts) => sum + ts.missedCount, 0);
  const averageAccuracy = activeTicketStats.length > 0
    ? Math.round(
        activeTicketStats.reduce((sum, ts) => sum + ts.accuracyPercent, 0) / activeTicketStats.length
      )
    : 0;

  return {
    totalDrawn,
    totalCorrect,
    totalAnswered,
    totalMissed,
    averageAccuracy,
    ticketStats: activeTicketStats,
  };
}

/**
 * Get questions on a specific ticket that have been drawn
 */
export async function getDrawnQuestionsOnTicket(
  eventId: string,
  ticketSerial: string
): Promise<number[]> {
  // Get drawn numbers
  const drawnNumbers = await getDrawnQuestionNumbers(eventId);
  const drawnSet = new Set(drawnNumbers);

  // Get ticket questions
  const { data: ticket, error } = await supabase
    .from("tickets")
    .select("ticket_questions(question_number)")
    .eq("serial_number", ticketSerial)
    .eq("event_id", eventId)
    .single();

  if (error || !ticket) {
    console.error("[statsHelper] Failed to fetch ticket questions:", error);
    return [];
  }

  // Filter to only drawn questions
  const ticketQuestions = (ticket.ticket_questions as Array<{ question_number: number }>)
    .map(tq => tq.question_number)
    .filter(qn => drawnSet.has(qn))
    .sort((a, b) => a - b);

  return ticketQuestions;
}

/**
 * Get detailed results for a ticket (for expanded view)
 */
export async function getTicketDetailedResults(
  eventId: string,
  ticketSerial: string
): Promise<{
  questions: Array<{
    question_number: number;
    question_text: string;
    correct_answer: string;
    player_answer: string;
    is_correct: boolean | null;
    result: "Točno" | "Netočno" | "Propušteno" | "Nije izvučeno";
  }>;
}> {
  // 1. Get drawn questions on this ticket
  const drawnOnTicket = await getDrawnQuestionsOnTicket(eventId, ticketSerial);

  if (drawnOnTicket.length === 0) {
    return { questions: [] };
  }

  // 2. Get deduplicated answers
  const answers = await getTicketAnswersDedup(eventId, ticketSerial);
  const answerMap = new Map(
    answers.map(a => [a.question_number, a])
  );

  // 3. Get event questions to map question_number → question_id
  const { data: eventQuestions, error: eqError } = await supabase
    .from("event_questions")
    .select("question_number, question_id")
    .eq("event_id", eventId)
    .in("question_number", drawnOnTicket);

  if (eqError || !eventQuestions) {
    console.error("[statsHelper] Failed to fetch event_questions:", eqError);
    return { questions: [] };
  }

  const questionIdMap = new Map(
    eventQuestions.map(eq => [eq.question_number, eq.question_id])
  );

  // 4. Get question texts and correct answers
  const questionIds = Array.from(questionIdMap.values());
  const { data: questions, error: qError } = await supabase
    .from("questions")
    .select("id, text, correct_answer")
    .in("id", questionIds);

  if (qError || !questions) {
    console.error("[statsHelper] Failed to fetch questions:", qError);
    return { questions: [] };
  }

  const questionDataMap = new Map(
    questions.map(q => [q.id, { text: q.text, correct_answer: q.correct_answer }])
  );

  // 5. Build detailed results
  const results = drawnOnTicket.map(qn => {
    const questionId = questionIdMap.get(qn);
    const questionData = questionId ? questionDataMap.get(questionId) : null;
    const answer = answerMap.get(qn);

    const questionText = questionData?.text || "N/A";
    const correctAnswer = questionData?.correct_answer ? "DA" : "NE";
    const playerAnswer = answer ? answer.answer_yesno : "Nije odgovoreno";
    
    // Determine is_correct
    let isCorrect: boolean | null = null;
    if (answer) {
      isCorrect = answer.is_correct;
    }

    const result = !answer
      ? "Propušteno"
      : answer.is_correct
      ? "Točno"
      : "Netočno";

    return {
      question_number: qn,
      question_text: questionText,
      correct_answer: correctAnswer,
      player_answer: playerAnswer,
      is_correct: isCorrect,
      result: result as "Točno" | "Netočno" | "Propušteno" | "Nije izvučeno",
    };
  });

  return { questions: results };
}