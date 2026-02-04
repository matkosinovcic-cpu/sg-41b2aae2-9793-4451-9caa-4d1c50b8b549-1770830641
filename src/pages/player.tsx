import { SEO } from "@/components/SEO";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { answerService } from "@/services/answerService";
import ticketService from "@/services/ticketService";
import { Ticket as TicketIcon, Check, X, AlertCircle, Trophy, Loader2, RefreshCw, Plus, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { computeEventLevelGlobalStats } from "@/lib/statsHelper";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Event } from "@/services/eventService";
import { eventService } from "@/services/eventService";

// Interface definitions
interface Question {
  id: string;
  text: string;
  correct_answer: boolean;
}

// localStorage helpers for multi-ticket support
function getStoredFreeTickets(eventId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const key = `ps_free_tickets_${eventId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addStoredFreeTicket(eventId: string, serial: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `ps_free_tickets_${eventId}`;
    const stored = getStoredFreeTickets(eventId);
    if (!stored.includes(serial)) {
      stored.push(serial);
      localStorage.setItem(key, JSON.stringify(stored));
    }
  } catch (err) {
    console.error("[localStorage] Failed to add ticket:", err);
  }
}

// SELF-HEAL: Clear old event context
function clearOldEventContext(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("ps_last_event_id");
    localStorage.removeItem("ps_selected_event_id");
    console.log("[Player] 🔄 Cleared old event context for self-heal");
  } catch (err) {
    console.error("[Player] Failed to clear old context:", err);
  }
}

interface TicketData {
  id: string;
  serial_number: string;
  event_id: string;
  ticket_questions: Array<{ question_number: number }>;
  is_winner?: boolean;
}

interface Answer {
  ticket_id: string;
  question_number: number;
  answer: boolean | null;
  created_at: string;
}

// Normalize answer values to boolean
function normalizeAnswer(value: any): boolean | null {
  if (value === true || value === "true" || value === 1) return true;
  if (value === false || value === "false" || value === 0) return false;
  return null;
}

// CORE FUNCTION: Compute stats for ONE ticket (IDENTICAL for all tickets)
function computeTicketStats(
  ticketNumbers: number[],
  drawnNumbers: number[],
  answersMap: Map<number, { answer: boolean | null; isCorrect: boolean }>,
  ticketSerial: string
): {
  drawnOnTicketCount: number;
  answeredOnTicket: number;
  correctOnTicket: number;
  incorrectOnTicket: number;
  missedOnTicket: number;
  accuracyPct: number;
} {
  // 1. Intersection: drawn numbers that are on this ticket
  const ticketNumbersSet = new Set(ticketNumbers);
  const drawnOnTicket = drawnNumbers.filter(n => ticketNumbersSet.has(n));
  const drawnOnTicketCount = drawnOnTicket.length;

  if (drawnOnTicketCount === 0) {
    console.log(`[STATS] ${ticketSerial}: No drawn numbers on this ticket`);
    return {
      drawnOnTicketCount: 0,
      answeredOnTicket: 0,
      correctOnTicket: 0,
      incorrectOnTicket: 0,
      missedOnTicket: 0,
      accuracyPct: 0
    };
  }

  // 2. Count stats from answersMap (global map by question number)
  let answeredOnTicket = 0;
  let correctOnTicket = 0;
  let incorrectOnTicket = 0;

  for (const qNum of drawnOnTicket) {
    const ans = answersMap.get(qNum);
    if (ans) {
      answeredOnTicket++;
      if (ans.isCorrect) {
        correctOnTicket++;
      } else {
        incorrectOnTicket++;
      }
    }
  }

  const missedOnTicket = drawnOnTicketCount - answeredOnTicket;
  
  // ❗ PROPUŠTENA PITANJA = NETOČNA U POSTOTKU
  const accuracyPct = drawnOnTicketCount > 0 
    ? Math.round((correctOnTicket / drawnOnTicketCount) * 100)
    : 0;

  // DEBUG LOG
  console.log(`[STATS] ${ticketSerial}:`, {
    intersection: drawnOnTicketCount,
    answered: answeredOnTicket,
    correct: correctOnTicket,
    incorrect: incorrectOnTicket,
    missed: missedOnTicket,
    accuracy: accuracyPct
  });

  return {
    drawnOnTicketCount,
    answeredOnTicket,
    correctOnTicket,
    incorrectOnTicket,
    missedOnTicket,
    accuracyPct
  };
}

// CORE FUNCTION: Get cell state for grid coloring (IDENTICAL for all tickets)
function getCellState(
  questionNumber: number,
  drawnNumbers: number[],
  answersMap: Map<number, { answer: boolean | null; isCorrect: boolean }>
): "not-drawn" | "correct" | "wrong" | "missed" {
  const isDrawn = drawnNumbers.includes(questionNumber);
  
  if (!isDrawn) {
    return "not-drawn";
  }
  
  const ans = answersMap.get(questionNumber);
  if (ans) {
    return ans.isCorrect ? "correct" : "wrong";
  }
  
  return "missed";
}

// GLOBAL STATS: Aggregate across ALL tickets
function computeGlobalStats(
  tickets: TicketData[],
  drawnNumbers: number[],
  answersMap: Map<number, { answer: boolean | null; isCorrect: boolean }>
): {
  totalDrawn: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  missedCount: number;
  accuracyPct: number;
} {
  const totalDrawn = drawnNumbers.length;

  if (totalDrawn === 0 || tickets.length === 0) {
    return {
      totalDrawn: 0,
      answeredCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      missedCount: 0,
      accuracyPct: 0
    };
  }

  // Aggregate stats across ALL tickets
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalMissed = 0;
  let totalAnswered = 0;
  let totalDrawnOnTickets = 0;

  for (const ticket of tickets) {
    const ticketNumbers = ticket.ticket_questions.map(tq => Number(tq.question_number));
    const ticketStats = computeTicketStats(
      ticketNumbers,
      drawnNumbers,
      answersMap,
      ticket.serial_number
    );

    totalDrawnOnTickets += ticketStats.drawnOnTicketCount;
    totalAnswered += ticketStats.answeredOnTicket;
    totalCorrect += ticketStats.correctOnTicket;
    totalIncorrect += ticketStats.incorrectOnTicket;
    totalMissed += ticketStats.missedOnTicket;
  }

  // ❗ PROPUŠTENA PITANJA = NETOČNA U POSTOTKU
  const accuracyPct = totalDrawnOnTickets > 0 
    ? Math.round((totalCorrect / totalDrawnOnTickets) * 100)
    : 0;

  console.log("[GLOBAL STATS]:", {
    totalDrawn,
    totalDrawnOnTickets,
    totalAnswered,
    totalCorrect,
    totalIncorrect,
    totalMissed,
    accuracyPct
  });

  return {
    totalDrawn,
    answeredCount: totalAnswered,
    correctCount: totalCorrect,
    incorrectCount: totalIncorrect,
    missedCount: totalMissed,
    accuracyPct
  };
}

export default function PlayerPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checkingNewEvent, setCheckingNewEvent] = useState(false);

  // Multi-ticket state
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [eventMode, setEventMode] = useState<"active" | "finished">("active");
  const [sessionId, setSessionId] = useState<string>("");
  const [playerNickname, setPlayerNickname] = useState<string>("");

  useEffect(() => {
    // Load nickname from localStorage
    const savedNickname = localStorage.getItem("player_nickname");
    if (savedNickname) {
      setPlayerNickname(savedNickname);
    }
  }, []);

  // Hydration check
  const [mounted, setMounted] = useState(false);

  // Game state
  const [currentDrawnNumber, setCurrentDrawnNumber] = useState<number | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [winnerSerial, setWinnerSerial] = useState<string | null>(null);
  
  // Stores correct answer for ALL drawn questions
  const [correctAnswersMap, setCorrectAnswersMap] = useState<Record<number, boolean>>({});

  // Add ticket modal state
  const [addTicketOpen, setAddTicketOpen] = useState(false);
  const [newTicketSerial, setNewTicketSerial] = useState("");
  const [addingTicket, setAddingTicket] = useState(false);

  // Ticket detail modal state (for win screen)
  const [ticketDetailOpen, setTicketDetailOpen] = useState(false);
  const [selectedTicketForDetail, setSelectedTicketForDetail] = useState<TicketData | null>(null);

  // Post-event review state
  const [showDetailedReview, setShowDetailedReview] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<"all" | "correct" | "incorrect">("all");
  const [allDrawnQuestions, setAllDrawnQuestions] = useState<Array<{ number: number; text: string; correct_answer: boolean }>>([]);

  // Event-level global stats state
  const [globalStats, setGlobalStats] = useState<{
    totalDrawn: number;
    answeredTotal: number;
    correctTotal: number;
    incorrectTotal: number;
    skippedTotal: number;
    accuracyPct: number;
  }>({
    totalDrawn: 0,
    answeredTotal: 0,
    correctTotal: 0,
    incorrectTotal: 0,
    skippedTotal: 0,
    accuracyPct: 0
  });

  // SELF-HEAL: Retry state
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [healingInProgress, setHealingInProgress] = useState(false);
  const MAX_RETRY_ATTEMPTS = 2;

  // SELF-HEAL: Load tickets with automatic fallback to active event
  const loadTicketsWithSelfHeal = async (isRetry = false) => {
    console.log("[Player] 🎬 Starting ticket load with self-heal", isRetry ? `(retry ${retryAttempt + 1})` : "");
    setLoading(true);
    
    try {
      const ticketSerial = router.query.ticket as string;
      const eventIdParam = router.query.event as string;

      let ticketsToLoad: string[] = [];
      let eventId: string | null = null;

      // STEP 1: Try to get tickets from URL params
      if (ticketSerial) {
        console.log("[Player] 📋 Loading ticket from URL:", ticketSerial);
        ticketsToLoad = [ticketSerial];
        const ticket = await ticketService.getTicketBySerial(ticketSerial);
        if (ticket) {
          eventId = ticket.event_id;
          console.log("[Player] 🎫 Ticket found, event_id:", eventId);
          const storedTickets = getStoredFreeTickets(eventId);
          ticketsToLoad = [...new Set([ticketSerial, ...storedTickets])];
          console.log("[Player] 📚 Combined with stored tickets:", ticketsToLoad);
        }
      } else if (eventIdParam) {
        console.log("[Player] 🎯 Loading tickets for event:", eventIdParam);
        eventId = eventIdParam;
        ticketsToLoad = getStoredFreeTickets(eventId);
        console.log("[Player] 📚 Found stored tickets:", ticketsToLoad);
      }

      // STEP 2: If no tickets or failed to load, try ACTIVE event (self-heal)
      if (ticketsToLoad.length === 0 || !eventId) {
        console.log("[Player] 🔄 No tickets found, checking for ACTIVE event...");
        
        const { data: events, error } = await supabase
          .from("events")
          .select("*")
          .eq("status", "active")
          .limit(1);

        if (error) {
          console.error("[Player] ❌ Error fetching active event:", error);
          throw error;
        }

        const activeEvent = events && events.length > 0 ? events[0] : null;

        if (activeEvent) {
          console.log("[Player] ✅ Active event found:", activeEvent.id);
          eventId = activeEvent.id;
          ticketsToLoad = getStoredFreeTickets(eventId);
          console.log("[Player] 📚 Loading tickets for active event:", ticketsToLoad.length);
        }
      }

      // STEP 3: If still no tickets, show friendly UI (not a crash)
      if (ticketsToLoad.length === 0) {
        console.log("[Player] ℹ️ No tickets to load");
        setLoading(false);
        setHealingInProgress(false);
        
        // Check if there's an active event to redirect to /play
        const { data: events } = await supabase
          .from("events")
          .select("*")
          .eq("status", "active")
          .limit(1);
        
        const activeEvent = events && events.length > 0 ? events[0] : null;
        
        if (activeEvent && !isRetry) {
          console.log("[Player] 🔄 Active event exists, suggesting to get ticket");
          toast({
            title: "Nemaš tikete za aktivni event",
            description: "Preuzimaš li besplatni tiket?",
            duration: 5000
          });
        }
        
        return;
      }

      // STEP 4: Fetch all tickets
      console.log("[Player] 🔄 Fetching ticket details...");
      const ticketPromises = ticketsToLoad.map(serial => ticketService.getTicketBySerial(serial));
      const rawTickets = (await Promise.all(ticketPromises)).filter(t => t !== null);
      
      const loadedTickets: TicketData[] = rawTickets.map(t => ({
        id: t!.id,
        serial_number: t!.serial_number,
        event_id: t!.event_id,
        ticket_questions: t!.ticket_questions || [], // Ensure array exists
        is_winner: t!.is_winner
      }));
      
      if (loadedTickets.length === 0) {
        console.log("[Player] ⚠️ No valid tickets loaded");
        
        // SELF-HEAL: Retry with context clear
        if (!isRetry && retryAttempt < MAX_RETRY_ATTEMPTS) {
          console.log("[Player] 🔄 Clearing old context and retrying...");
          setHealingInProgress(true);
          clearOldEventContext();
          setRetryAttempt(prev => prev + 1);
          
          toast({
            title: "🔄 Prebacivanje na aktivni event...",
            description: "Trenutak...",
            duration: 2000
          });
          
          setTimeout(() => loadTicketsWithSelfHeal(true), 800);
          return;
        }
        
        // Final fallback: show friendly error
        setLoading(false);
        setHealingInProgress(false);
        toast({
          title: "Nemaš tikete",
          description: "Preuzmi besplatni tiket za aktivni event.",
          duration: 5000
        });
        return;
      }

      setTickets(loadedTickets);
      console.log("[Player] ✅ Loaded tickets:", loadedTickets.map(t => ({
        id: t.id,
        serial: t.serial_number,
        event_id: t.event_id
      })));

      // Set focused ticket
      if (ticketSerial) {
        const focused = loadedTickets.find(t => t.serial_number === ticketSerial);
        setFocusedTicketId(focused?.id || loadedTickets[0]?.id || null);
      } else {
        setFocusedTicketId(loadedTickets[0]?.id || null);
      }

      // Load event data
      const currentEventId = eventId || loadedTickets[0].event_id;
      console.log("[Player] 🎪 Loading event data for:", currentEventId);
      await refetchEventData(currentEventId, loadedTickets);
      
      // Subscribe to realtime only if event is active
      const event = await eventService.getEventById(currentEventId);
      console.log("[Player] 🎪 Event status:", event.status);
      
      if (event && event.status === "active") {
        console.log("[Player] 🔔 Setting up realtime subscription");
        setupRealtimeSubscription(currentEventId);
      } else {
        console.log("[Player] 📊 Event is finished, entering RESULTS mode");
      }

      // Success - reset retry counter
      setRetryAttempt(0);
      setHealingInProgress(false);

    } catch (error) {
      console.error("[Player] ❌ Failed to load tickets:", error);
      
      // SELF-HEAL: Retry with context clear
      if (!isRetry && retryAttempt < MAX_RETRY_ATTEMPTS) {
        console.log("[Player] 🔄 Error occurred, attempting self-heal...");
        setHealingInProgress(true);
        clearOldEventContext();
        setRetryAttempt(prev => prev + 1);
        
        toast({
          title: "🔄 Prebacivanje na aktivni event...",
          description: "Trenutak...",
          duration: 2000
        });
        
        setTimeout(() => loadTicketsWithSelfHeal(true), 800);
        return;
      }
      
      // Final fallback: show user-friendly error but don't crash
      console.error("[Player] ❌ Self-heal failed after retries");
      setHealingInProgress(false);
      toast({
        title: "Privremeni problem",
        description: "Pokušaj osvježiti stranicu. Ako problem traje, kontaktiraj podršku.",
        variant: "destructive",
        duration: 5000
      });
    } finally {
      if (!isRetry || retryAttempt >= MAX_RETRY_ATTEMPTS) {
        setLoading(false);
      }
    }
  };

  // Load tickets on mount
  useEffect(() => {
    if (router.isReady) {
      loadTicketsWithSelfHeal();
    }
  }, [router.isReady, router.query.ticket, router.query.event]);

  // Refetch event data
  const refetchEventData = async (eventId: string, loadedTickets: TicketData[]) => {
    console.log("[Player] 🔄 Refetching event data for:", eventId);
    try {
      const event = await eventService.getEventById(eventId);
      console.log("[Player] 🎪 Event data:", {
        id: event.id,
        name: event.name,
        status: event.status,
        current_drawn_number: event.current_drawn_number,
        drawn_numbers_count: event.drawn_numbers?.length || 0,
        winner_ticket_id: event.winner_ticket_id
      });
      
      setActiveEvent({ ...event });
      setEventMode(event.status === "finished" ? "finished" : "active");
      setCurrentDrawnNumber(event.current_drawn_number);
      
      console.log("[Player] 🎯 Event mode set to:", event.status === "finished" ? "FINISHED" : "ACTIVE");
      
      // Handle winner
      if (event.winner_ticket_id) {
        const winnerTicket = await ticketService.getTicket(event.winner_ticket_id);
        setWinnerSerial(winnerTicket?.serial_number || null);
        console.log("[Player] 🏆 Winner ticket:", winnerTicket?.serial_number);
      } else {
        setWinnerSerial(null);
      }

      // Create/Get session (only for active events)
      if (event.status === "active") {
        console.log("[Player] 🔑 Creating/getting session for active event");
        const session = await answerService.getOrCreateSession(eventId);
        setSessionId(session.id);
        console.log("[Player] 🔑 Session ID:", session.id);
      } else {
        console.log("[Player] ⏸️ Skipping session creation (event is finished)");
      }

      // Load current question (only for active events)
      if (event.status === "active" && event.current_drawn_number) {
        console.log("[Player] ❓ Loading current question:", event.current_drawn_number);
        const questionData = await eventService.getQuestionForNumber(eventId, event.current_drawn_number);
        if (questionData && questionData.questions) {
          setCurrentQuestion({
            id: questionData.question_id,
            text: questionData.questions.text,
            correct_answer: questionData.questions.correct_answer
          });
          const expiresAt = event.question_open_until ? new Date(event.question_open_until).getTime() : 0;
          const now = Date.now();
          const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
          setTimeLeft(remaining);
          console.log("[Player] ⏱️ Time left:", remaining, "seconds");
        }
      } else {
        setCurrentQuestion(null);
        setTimeLeft(0);
        console.log("[Player] ⏸️ No current question (event finished or no drawn number)");
      }

      // Load ALL drawn questions correct answers
      try {
        console.log("[Player] 📚 Loading drawn questions map...");
        const answersMap = await eventService.getDrawnQuestions(eventId);
        setCorrectAnswersMap(answersMap);
        console.log("[Player] 📚 Drawn questions loaded:", Object.keys(answersMap).length, "questions");
        
        // If event is finished, load full question data for review
        if (event.status === "finished") {
          console.log("[Player] 📖 Loading full question data for review...");
          try {
            const detailedQuestions = await eventService.getDrawnQuestionsDetailed(eventId);
            setAllDrawnQuestions(detailedQuestions);
            console.log("[Player] 📖 Loaded", detailedQuestions.length, "questions for review");
            
            // If we got 0 questions but event has drawn_numbers, log warning
            if (detailedQuestions.length === 0 && event.drawn_numbers && event.drawn_numbers.length > 0) {
              console.warn("[Player] ⚠️ Event has drawn_numbers but no drawn questions in database!");
              console.warn("[Player] drawn_numbers:", event.drawn_numbers);
            }
          } catch (err) {
            console.error("[Player] ❌ Failed to load detailed questions:", err);
            // Don't fail the entire load, just log error
            setAllDrawnQuestions([]);
          }
        } else {
          setAllDrawnQuestions([]);
        }
      } catch (err) {
        console.error("[Player] ❌ Failed to load drawn questions map:", err);
      }

      // Load answers for ALL tickets using SERIAL_NUMBER as key
      console.log("[Player] 💬 Loading answers for all tickets...");
      const allAnswers: Answer[] = [];
      for (const ticket of loadedTickets) {
        console.log(`[Player] 💬 Loading answers for ticket: ${ticket.serial_number}`);
        const ticketAnswers = await answerService.getAnswersForTicket(ticket.serial_number);
        console.log(`[Player] 💬 Found ${ticketAnswers.length} answers for ${ticket.serial_number}`);
        allAnswers.push(...ticketAnswers);
      }
      setAnswers([...allAnswers]);
      
      console.log(`[Player] ✅ Total answers loaded: ${allAnswers.length}`);
      console.log("[Player] ✅ Event data refetch complete");

      // Compute EVENT-LEVEL global stats
      console.log("[Player] 📊 Computing event-level global stats...");
      const ticketSerials = loadedTickets.map(t => t.serial_number);
      const eventGlobalStats = await computeEventLevelGlobalStats(eventId, ticketSerials);
      setGlobalStats(eventGlobalStats);
      console.log("[Player] 📊 Event-level global stats set:", eventGlobalStats);
    } catch (error) {
      console.error("[Player] ❌ Failed to refetch event data:", error);
    }
  };

  // Setup realtime subscription (only for active events)
  const setupRealtimeSubscription = (eventId: string) => {
    let reconnectAttempts = 0;
    const maxReconnects = 10;
    let channel: any = null;

    const subscribe = () => {
      console.log("[Player] 🔌 Subscribing to event:", eventId);
      
      channel = supabase
        .channel(`player_event_${eventId}_${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "events",
            filter: `id=eq.${eventId}`
          },
          async (payload) => {
            console.log("[Player] 🔔 Realtime update received:", payload.eventType);
            const updatedEvent = payload.new as Event;
            
            console.log("[Player] 🎪 Updated event status:", updatedEvent.status);
            
            setActiveEvent({ ...updatedEvent });
            setEventMode(updatedEvent.status === "finished" ? "finished" : "active");
            setCurrentDrawnNumber(updatedEvent.current_drawn_number);
            
            // Update winner
            if (updatedEvent.winner_ticket_id) {
              ticketService.getTicket(updatedEvent.winner_ticket_id).then(t => {
                setWinnerSerial(t?.serial_number || null);
                console.log("[Player] 🏆 Winner updated:", t?.serial_number);
              });
            } else {
              setWinnerSerial(null);
            }

            // Load new question (only if still active)
            if (updatedEvent.status === "active" && updatedEvent.current_drawn_number && updatedEvent.question_open_until) {
              console.log("[Player] ❓ Loading new question:", updatedEvent.current_drawn_number);
              const questionData = await eventService.getQuestionForNumber(eventId, updatedEvent.current_drawn_number);
              if (questionData && questionData.questions) {
                setCurrentQuestion({
                  id: questionData.question_id,
                  text: questionData.questions.text,
                  correct_answer: questionData.questions.correct_answer
                });
                
                setCorrectAnswersMap(prev => ({
                  ...prev,
                  [updatedEvent.current_drawn_number!]: questionData.questions!.correct_answer
                }));

                const expiresAt = new Date(updatedEvent.question_open_until).getTime();
                const now = Date.now();
                const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
                setTimeLeft(remaining);
                console.log("[Player] ⏱️ Timer set to:", remaining, "seconds");
              }
            } else {
              setCurrentQuestion(null);
              setTimeLeft(0);
              console.log("[Player] ⏸️ No new question (event finished or no drawn number)");
            }
          }
        )
        .subscribe((status) => {
          console.log("[Player] 🔌 Subscription status:", status);
          if (status === "CHANNEL_ERROR" && reconnectAttempts < maxReconnects) {
            reconnectAttempts++;
            console.log("[Player] 🔄 Reconnecting... Attempt:", reconnectAttempts);
            setTimeout(() => {
              supabase.removeChannel(channel);
              subscribe();
            }, 1500);
          }
        });
    };

    subscribe();

    return () => {
      console.log("[Player] 🔌 Unsubscribing from realtime");
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  };

  // Fallback polling (only for active events)
  useEffect(() => {
    if (!activeEvent || activeEvent.status !== "active" || !tickets.length) return;

    console.log("[Player] 🔄 Starting fallback polling");
    
    const pollInterval = setInterval(async () => {
      try {
        const event = await eventService.getEventById(activeEvent.id);
        
        if (
          event.current_drawn_number !== currentDrawnNumber ||
          event.drawn_numbers?.length !== activeEvent.drawn_numbers?.length
        ) {
          console.log("[Player] 🔄 Polling detected change, refetching data");
          await refetchEventData(activeEvent.id, tickets);
        }
      } catch (error) {
        console.error("[Player] ❌ Polling error:", error);
      }
    }, 1000);

    return () => {
      console.log("[Player] ⏸️ Stopping fallback polling");
      clearInterval(pollInterval);
    };
  }, [activeEvent?.id, activeEvent?.status, currentDrawnNumber, tickets.length]);

  // Resync on window focus (only for active events)
  useEffect(() => {
    if (!activeEvent || !tickets.length) return;

    const handleFocus = () => {
      console.log("[Player] 🔄 Window focused, resyncing data");
      refetchEventData(activeEvent.id, tickets);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[Player] 🔄 Tab visible, resyncing data");
        refetchEventData(activeEvent.id, tickets);
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeEvent?.id, tickets]);

  // Countdown timer (only for active events)
  useEffect(() => {
    if (timeLeft <= 0 || eventMode !== "active") return;
    const timer = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, eventMode]);

  // Handle answer submission (only for active events)
  const handleAnswer = async (answer: boolean) => {
    if (eventMode !== "active" || !focusedTicketId || !currentDrawnNumber || !currentQuestion || timeLeft <= 0 || submitting) return;

    const focusedTicket = tickets.find(t => t.id === focusedTicketId);
    if (!focusedTicket) return;

    const existingAnswer = answers.find(a => a.ticket_id === focusedTicket.serial_number && a.question_number === currentDrawnNumber);
    if (existingAnswer) {
      toast({
        title: "Već si odgovorio/la",
        description: "Ne možeš promijeniti odgovor.",
        variant: "destructive"
      });
      return;
    }

    setSubmitting(true);
    try {
      console.log("[Player] 💬 Submitting answer:", { ticket: focusedTicket.serial_number, question: currentDrawnNumber, answer });
      
      await answerService.submitAnswer(
          sessionId, 
          focusedTicket.event_id, 
          currentDrawnNumber, 
          answer, 
          focusedTicket.serial_number
      );
      
      const newAnswer: Answer = {
        ticket_id: focusedTicket.serial_number,
        question_number: currentDrawnNumber,
        answer,
        created_at: new Date().toISOString()
      };
      setAnswers(prev => [...prev, newAnswer]);

      // Refresh global stats from server to ensure accuracy
      computeEventLevelGlobalStats(focusedTicket.event_id, tickets.map(t => t.serial_number))
        .then(stats => setGlobalStats(stats))
        .catch(err => console.error("[Player] Failed to update global stats:", err));

      const isCorrect = normalizeAnswer(answer) === normalizeAnswer(currentQuestion.correct_answer);
      console.log("[Player] ✅ Answer submitted:", isCorrect ? "CORRECT" : "INCORRECT");
      
      toast({
        title: isCorrect ? "✅ Točno!" : "❌ Netočno",
        description: isCorrect ? "Odgovor je točan!" : "Odgovor nije točan.",
        variant: isCorrect ? "default" : "destructive"
      });
    } catch (error) {
      console.error("[Player] ❌ Failed to submit answer:", error);
      toast({
        title: "Greška",
        description: "Greška pri slanju odgovora.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle add ticket
  const handleAddTicket = async () => {
    if (!newTicketSerial.trim() || !activeEvent) return;

    setAddingTicket(true);
    try {
      console.log("[Player] 🎫 Adding ticket:", newTicketSerial.trim());
      
      // Fetch ticket by serial
      const ticket = await ticketService.getTicketBySerial(newTicketSerial.trim());
      
      if (!ticket) {
        toast({
          title: "Tiket nije pronađen",
          description: "Provjerite serijski broj i pokušajte ponovo.",
          variant: "destructive"
        });
        setAddingTicket(false);
        return;
      }

      // Check if ticket belongs to the same event
      if (ticket.event_id !== activeEvent.id) {
        toast({
          title: "Pogrešan event",
          description: "Ovaj tiket pripada drugom eventu.",
          variant: "destructive"
        });
        setAddingTicket(false);
        return;
      }

      // Check if ticket is already added
      if (tickets.some(t => t.serial_number === ticket.serial_number)) {
        toast({
          title: "Tiket već dodan",
          description: "Ovaj tiket je već u vašoj listi.",
          variant: "destructive"
        });
        setAddingTicket(false);
        return;
      }

      // Add ticket to localStorage
      addStoredFreeTicket(activeEvent.id, ticket.serial_number);

      // Add ticket to state
      const newTicketData: TicketData = {
        id: ticket.id,
        serial_number: ticket.serial_number,
        event_id: ticket.event_id,
        ticket_questions: ticket.ticket_questions || [],
        is_winner: ticket.is_winner
      };
      const updatedTickets = [...tickets, newTicketData];
      setTickets(updatedTickets);

      // Load answers for new ticket
      const ticketAnswers = await answerService.getAnswersForTicket(ticket.serial_number);
      setAnswers(prev => [...prev, ...ticketAnswers]);

      // Set as focused ticket
      setFocusedTicketId(ticket.id);

      console.log("[Player] ✅ Ticket added:", ticket.serial_number);
      
      toast({
        title: "✅ Tiket dodan",
        description: `Tiket ${ticket.serial_number} uspješno dodan!`
      });

      // Close modal and reset input
      setAddTicketOpen(false);
      setNewTicketSerial("");
    } catch (error) {
      console.error("[Player] ❌ Failed to add ticket:", error);
      toast({
        title: "Greška",
        description: "Greška pri dodavanju tiketa.",
        variant: "destructive"
      });
    } finally {
      setAddingTicket(false);
    }
  };

  // Check for new active event
  const handleCheckNewEvent = async () => {
    if (!activeEvent) return;
    
    console.log("[Player] 🔍 Checking for new active event...");
    setCheckingNewEvent(true);
    try {
      const { event: newEvent, mode } = await eventService.getActiveOrLastFinished();
      
      console.log("[Player] 🔍 Check result:", { newEventId: newEvent.id, mode, currentEventId: activeEvent.id });
      
      if (mode === "active" && newEvent.id !== activeEvent.id) {
        // New active event found
        console.log("[Player] 🎉 New active event found:", newEvent.name);
        toast({
          title: "🎉 Novi event pokrenut!",
          description: `Event "${newEvent.name}" je aktivan. Želite li preuzeti novi tiket?`
        });
        
        // Redirect to /play to get new ticket
        router.push("/play");
      } else {
        console.log("[Player] ℹ️ No new active event found");
        toast({
          title: "Nema novog eventa",
          description: "Trenutno nema aktivnog eventa. Pokušajte kasnije.",
          variant: "default"
        });
      }
    } catch (error) {
      console.error("[Player] ❌ Failed to check for new event:", error);
      toast({
        title: "Greška",
        description: "Greška pri provjeri novog eventa.",
        variant: "destructive"
      });
    } finally {
      setCheckingNewEvent(false);
    }
  };

  // Handle ticket detail view
  const handleViewTicketDetail = (ticket: TicketData) => {
    console.log("[Player] 🔍 Opening ticket detail:", ticket.serial_number);
    setSelectedTicketForDetail(ticket);
    setTicketDetailOpen(true);
  };

  // CRITICAL: Normalize all numbers and build global answersMap
  const drawnNumbers = (activeEvent?.drawn_numbers || []).map(Number);
  const globalAnswersMap = new Map<number, { answer: boolean | null; isCorrect: boolean }>();
  
  // Build global answers map by question number (NOT by ticket!)
  for (const ans of answers) {
    const qNum = Number(ans.question_number);
    if (!drawnNumbers.includes(qNum)) continue;
    
    const correctAns = correctAnswersMap[qNum];
    const isCorrect = correctAns !== undefined && 
                      normalizeAnswer(ans.answer) === normalizeAnswer(correctAns);
    
    // Keep latest answer (already sorted in state)
    if (!globalAnswersMap.has(qNum)) {
      globalAnswersMap.set(qNum, { answer: ans.answer, isCorrect });
    }
  }

  console.log(`[Player] 📊 Stats computation:`, {
    answersMapSize: globalAnswersMap.size,
    drawnCount: drawnNumbers.length,
    totalAnswers: answers.length,
    mode: eventMode,
    ticketsCount: tickets.length
  });

  const focusedTicket = tickets.find(t => t.id === focusedTicketId);
  const canAddTicket = activeEvent && eventMode === "active" && tickets.length < 4;

  if (loading || healingInProgress) {
    return (
      <>
        <SEO title="Igrač - Pitalica Skitalica" />
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 p-4">
          <Loader2 className="h-12 w-12 animate-spin text-white mb-4" />
          {healingInProgress && (
            <p className="text-white text-center">
              Prebacivanje na aktivni event...
            </p>
          )}
        </div>
      </>
    );
  }

  if (tickets.length === 0) {
    console.log("[Player] ℹ️ No tickets found, showing empty state");
    return (
      <>
        <SEO title="Igrač - Pitalica Skitalica" />
        <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Nemaš aktivne tikete</CardTitle>
              <CardDescription>Preuzmi tiket za aktivni event</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push("/play")} className="w-full" size="lg">
                <TicketIcon className="mr-2 h-5 w-5" />
                Preuzmi tiket
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // Winner screen (only if user has winning ticket)
  if (winnerSerial && tickets.some(t => t.serial_number === winnerSerial)) {
    console.log("[Player] 🏆 Showing winner screen for:", winnerSerial);
    return (
      <>
        <SEO title="POBJEDNIK! 🎉" />
        <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
          <Card className="w-full max-w-2xl">
            <CardHeader className="text-center space-y-4">
              <Trophy className="h-24 w-24 mx-auto text-yellow-500" />
              <CardTitle className="text-4xl font-bold">🎉 ČESTITAMO! 🎉</CardTitle>
              <CardDescription className="text-xl">TI SI POBJEDNIK!</CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-6">
              <p className="text-2xl font-bold">Pobjednički tiket: {winnerSerial}</p>
              
              {/* Show global stats summary */}
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-2">Tvoja statistika:</p>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="font-semibold">{globalStats.correctTotal}</p>
                    <p className="text-muted-foreground">Točno</p>
                  </div>
                  <div>
                    <p className="font-semibold">{globalStats.incorrectTotal}</p>
                    <p className="text-muted-foreground">Netočno</p>
                  </div>
                  <div>
                    <p className="font-semibold">{globalStats.accuracyPct}%</p>
                    <p className="text-muted-foreground">Točnost</p>
                  </div>
                </div>
              </div>

              {/* All user tickets section */}
              <div className="mt-6 p-4 bg-muted rounded-lg text-left">
                <p className="text-sm font-semibold mb-3">Svi tvoji tiketi ({tickets.length})</p>
                <div className="flex flex-wrap gap-2">
                  {tickets.map((ticket) => (
                    <Badge
                      key={ticket.id}
                      variant={ticket.serial_number === winnerSerial ? "default" : "outline"}
                      className={cn(
                        "cursor-pointer hover:opacity-80 transition-opacity",
                        ticket.serial_number === winnerSerial && "bg-yellow-500 text-black"
                      )}
                      onClick={() => handleViewTicketDetail(ticket)}
                    >
                      {ticket.serial_number === winnerSerial && "🏆 "}
                      {ticket.serial_number}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Klikni na tiket za pregled detalja</p>
              </div>

              <div className="flex gap-2 mt-6">
                <Button 
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }} 
                  variant="outline" 
                  size="lg"
                  className="flex-1"
                >
                  Pregledaj tikete
                </Button>
                <Button 
                  onClick={() => router.push("/play")} 
                  size="lg"
                  className="flex-1"
                >
                  <TicketIcon className="mr-2 h-5 w-5" />
                  Nova igra
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ticket Detail Modal */}
        <Dialog open={ticketDetailOpen} onOpenChange={setTicketDetailOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl">📋 Detaljni Pregled Tiketa</DialogTitle>
              <DialogDescription>
                Tiket: <span className="font-bold">{selectedTicketForDetail?.serial_number}</span>
                {selectedTicketForDetail?.serial_number === winnerSerial && " 🏆 POBJEDNIČKI TIKET"}
              </DialogDescription>
            </DialogHeader>
            
            {selectedTicketForDetail && (
              <div className="space-y-6">
                {/* SUMMARY STATS */}
                {(() => {
                  const ticketNumbers = selectedTicketForDetail.ticket_questions.map(tq => Number(tq.question_number));
                  const ticketStats = computeTicketStats(
                    ticketNumbers,
                    drawnNumbers,
                    globalAnswersMap,
                    selectedTicketForDetail.serial_number
                  );

                  return (
                    <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border-2 border-purple-200">
                      <p className="text-sm font-semibold text-purple-900 mb-3">Sažetak Statistike</p>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div className="text-center">
                          <p className="text-muted-foreground">Ukupno pitanja</p>
                          <p className="text-2xl font-bold text-purple-700">{drawnNumbers.length}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">Izvučeno na tiketu</p>
                          <p className="text-2xl font-bold text-purple-700">{ticketStats.drawnOnTicketCount}/15</p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">Točnost</p>
                          <p className="text-2xl font-bold text-purple-700">{ticketStats.accuracyPct}%</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm mt-3 pt-3 border-t border-purple-200">
                        <div className="text-center">
                          <p className="text-green-600 font-bold text-xl">{ticketStats.correctOnTicket}</p>
                          <p className="text-xs text-muted-foreground">Točno</p>
                        </div>
                        <div className="text-center">
                          <p className="text-red-600 font-bold text-xl">{ticketStats.incorrectOnTicket}</p>
                          <p className="text-xs text-muted-foreground">Netočno</p>
                        </div>
                        <div className="text-center">
                          <p className="text-gray-600 font-bold text-xl">{ticketStats.missedOnTicket}</p>
                          <p className="text-xs text-muted-foreground">Propušteno</p>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* TICKET GRID VISUAL */}
                <div>
                  <p className="text-sm font-semibold mb-2">Vizualni Prikaz Tiketa (15 brojeva)</p>
                  <div className="grid grid-cols-5 gap-2">
                    {selectedTicketForDetail.ticket_questions
                      .sort((a, b) => a.question_number - b.question_number)
                      .map((tq) => {
                        const qNum = Number(tq.question_number);
                        const cellState = getCellState(qNum, drawnNumbers, globalAnswersMap);
                        
                        let bgColor = "bg-gray-200 dark:bg-gray-700";
                        let textColor = "text-gray-900 dark:text-gray-100";
                        let borderClass = "";
                        
                        switch (cellState) {
                          case "correct":
                            bgColor = "bg-[#22C55E]";
                            textColor = "text-white";
                            break;
                          case "wrong":
                            bgColor = "bg-[#DC2626]";
                            textColor = "text-white";
                            break;
                          case "missed":
                            bgColor = "bg-[#DC2626]";
                            textColor = "text-white";
                            borderClass = "border-2 border-[#111111]";
                            break;
                          case "not-drawn":
                            break;
                        }
                        
                        return (
                          <div
                            key={qNum}
                            className={cn(
                              "aspect-square flex items-center justify-center rounded text-sm font-bold",
                              bgColor,
                              textColor,
                              borderClass
                            )}
                          >
                            {qNum}
                          </div>
                        );
                      })}
                  </div>
                  <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 bg-[#22C55E] rounded"></div>
                      <span>Točno</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 bg-[#DC2626] rounded"></div>
                      <span>Netočno</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 bg-[#DC2626] border-2 border-[#111111] rounded"></div>
                      <span>Propušteno</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 bg-gray-200 border border-gray-300 rounded"></div>
                      <span>Nije izvučeno</span>
                    </div>
                  </div>
                </div>

                {/* ALL DRAWN QUESTIONS LIST */}
                <div className="border-t pt-4">
                  <p className="text-sm font-semibold mb-3">
                    📋 Sva Pitanja iz Eventa ({allDrawnQuestions.length} izvučeno, redoslijed izvlačenja)
                  </p>
                  
                  {allDrawnQuestions.length === 0 && (
                    <div className="text-center py-6 bg-gray-50 rounded-lg">
                      <p className="text-sm text-muted-foreground">
                        {activeEvent?.drawn_numbers && activeEvent.drawn_numbers.length > 0 
                          ? "⚠️ Event ima izvučene brojeve, ali nema podataka o pitanjima u bazi."
                          : "Nema izvučenih pitanja u ovom eventu."}
                      </p>
                      {activeEvent?.drawn_numbers && activeEvent.drawn_numbers.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Izvučeni brojevi: {activeEvent.drawn_numbers.join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                  
                  <div className="space-y-3">
                    {allDrawnQuestions.map((q, index) => {
                      const qNum = q.number;
                      const ticketNumbers = selectedTicketForDetail.ticket_questions.map(tq => Number(tq.question_number));
                      const isOnThisTicket = ticketNumbers.includes(qNum);
                      
                      const ans = answers.find(
                        a => a.ticket_id === selectedTicketForDetail.serial_number && Number(a.question_number) === qNum
                      );
                      
                      const isMissed = !ans;
                      const isCorrect = ans ? normalizeAnswer(ans.answer) === normalizeAnswer(q.correct_answer) : false;
                      
                      let statusBadge;
                      let borderColor = "border-gray-300";
                      let bgColor = "bg-white";
                      
                      if (!isOnThisTicket) {
                        statusBadge = <Badge variant="outline" className="bg-gray-100">Nije na tiketu</Badge>;
                        borderColor = "border-gray-200";
                        bgColor = "bg-gray-50/50";
                      } else if (isMissed) {
                        statusBadge = <Badge variant="secondary" className="bg-red-600 text-white border-2 border-black">⏭️ PROPUŠTENO</Badge>;
                        borderColor = "border-red-500";
                        bgColor = "bg-red-50";
                      } else if (isCorrect) {
                        statusBadge = <Badge variant="default" className="bg-green-600">✅ TOČNO</Badge>;
                        borderColor = "border-green-500";
                        bgColor = "bg-green-50/30";
                      } else {
                        statusBadge = <Badge variant="destructive">❌ NETOČNO</Badge>;
                        borderColor = "border-red-500";
                        bgColor = "bg-red-50/30";
                      }
                      
                      return (
                        <div
                          key={qNum}
                          className={cn(
                            "border-l-4 p-4 rounded-lg transition-all",
                            borderColor,
                            bgColor
                          )}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-sm font-bold">
                                #{index + 1} → Q{qNum}
                              </Badge>
                              {!isOnThisTicket && (
                                <span className="text-xs text-muted-foreground italic">(nije na ovom tiketu)</span>
                              )}
                            </div>
                            {statusBadge}
                          </div>
                          
                          <p className="text-base font-medium mb-3">{q.text}</p>
                          
                          {isOnThisTicket && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className={cn(
                                "p-3 rounded-md",
                                isMissed ? "bg-red-100 border-2 border-red-600" : isCorrect ? "bg-green-100" : "bg-red-100"
                              )}>
                                <p className="text-xs text-muted-foreground mb-1">Tvoj odgovor:</p>
                                <p className={cn(
                                  "text-xl font-bold",
                                  isMissed ? "text-red-700" : isCorrect ? "text-green-700" : "text-red-700"
                                )}>
                                  {isMissed ? "—" : ans?.answer ? "DA" : "NE"}
                                </p>
                              </div>
                              
                              <div className="bg-green-100 p-3 rounded-md">
                                <p className="text-xs text-muted-foreground mb-1">Točan odgovor:</p>
                                <p className="text-xl font-bold text-green-700">
                                  {q.correct_answer ? "DA" : "NE"}
                                </p>
                              </div>
                            </div>
                          )}
                          
                          {!isOnThisTicket && (
                            <div className="mt-2 p-2 bg-gray-100 rounded text-sm">
                              <span className="text-muted-foreground">Točan odgovor: </span>
                              <span className="font-bold">{q.correct_answer ? "DA" : "NE"}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => setTicketDetailOpen(false)}
                  >
                    ← Natrag na sve tikete
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  console.log("[Player] 📊 Rendering main player view, mode:", eventMode);

  return (
    <>
      <SEO title={eventMode === "finished" ? "Rezultati - Pitalica Skitalica" : "Igrač - Pitalica Skitalica"} />
      <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 p-2 sm:p-4">
        <div className="max-w-6xl mx-auto space-y-3">
          
          {/* EVENT STATUS BANNER (FINISHED MODE) */}
          {eventMode === "finished" && (
            <Card className="bg-gradient-to-r from-blue-500 to-purple-600 text-white border-none">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Trophy className="h-6 w-6" />
                    <div>
                      <p className="font-bold text-lg">Event je završen</p>
                      <p className="text-sm text-white/80">
                        {winnerSerial 
                          ? `Pobjednik: ${winnerSerial}` 
                          : "Možeš pregledati rezultate"}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="secondary" 
                    size="sm"
                    onClick={handleCheckNewEvent}
                    disabled={checkingNewEvent}
                  >
                    {checkingNewEvent ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Provjeravam...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Provjeri novi event
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* GLOBAL STATS HEADER */}
          {focusedTicket && (
            <Card className="bg-white/95 backdrop-blur shadow-sm" data-testid="global-summary-card">
              <CardHeader className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <CardTitle className="text-base font-bold leading-none">
                      {playerNickname || "Igrač"}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {activeEvent?.name || "Event"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={activeEvent?.status === "active" ? "default" : "secondary"} className="h-5 px-2 text-[10px]">
                      {activeEvent?.status === "active" ? "U toku" : "Završen"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {tickets.findIndex(t => t.id === focusedTicketId) + 1}/{tickets.length}
                    </span>
                  </div>
                </div>

                {/* GLOBAL STATS - 6 METRICS (2 rows x 3 cols) - COMPACT */}
                <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-center">
                  {/* Row 1 */}
                  <div className="flex items-center justify-center">
                    <span className="text-base font-bold text-black leading-none">
                      {globalStats.totalDrawn}/90
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-center">
                    <span className="text-base font-bold text-green-600 leading-none">T {globalStats.correctTotal}</span>
                  </div>
                  
                  <div className="flex items-center justify-center">
                    <Badge variant="secondary" className="bg-red-500 text-white border border-black text-[10px] font-bold h-5 px-1.5">
                      P {globalStats.skippedTotal}
                    </Badge>
                  </div>

                  {/* Row 2 */}
                  <div className="col-start-1 flex items-center justify-center">
                     {/* Placeholder for alignment if needed, or maybe empty per previous request "Odgovoreno hidden" */}
                     {/* We need N here? Previous layout had N in second row */}
                  </div>

                  <div className="col-start-2 flex items-center justify-center">
                    <span className="text-base font-bold text-red-600 leading-none">N {globalStats.incorrectTotal}</span>
                  </div>
                  
                  <div className="col-start-3 flex items-center justify-center">
                    <span className={`text-base font-bold ${
                      globalStats.accuracyPct <= 50 ? "text-red-600" : 
                      globalStats.accuracyPct <= 70 ? "text-yellow-600" : 
                      "text-green-600"
                    } leading-none`}>{globalStats.accuracyPct}%</span>
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* MULTI-TICKET GRID */}
          <div className={`grid gap-2 ${tickets.length === 1 ? "grid-cols-1" : tickets.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>
            {tickets.map((ticket) => {
              const isFocused = ticket.id === focusedTicketId;
              
              const ticketNumbers = ticket.ticket_questions.map(tq => Number(tq.question_number));
              const ticketStats = computeTicketStats(
                ticketNumbers,
                drawnNumbers,
                globalAnswersMap,
                ticket.serial_number
              );
              
              const isOnThisTicket = currentDrawnNumber !== null && ticketNumbers.includes(currentDrawnNumber);
              const hasAnsweredCurrent = currentDrawnNumber !== null && 
                answers.some(a => a.ticket_id === ticket.serial_number && Number(a.question_number) === currentDrawnNumber);

              return (
                <Card 
                  key={ticket.id} 
                  className={cn(
                    "cursor-pointer transition-all",
                    isFocused ? "ring-2 ring-primary shadow-lg" : "hover:shadow-md"
                  )}
                  onClick={() => setFocusedTicketId(ticket.id)}
                >
                  <CardHeader className="p-3 sm:p-4">
                    <CardTitle className="text-sm sm:text-base truncate">{ticket.serial_number}</CardTitle>
                    
                    <div className="text-xs text-muted-foreground mt-1">
                      <span style={{ color: "#9CA3AF" }}>{ticketStats.drawnOnTicketCount}/15</span>
                      <span className="mx-1">|</span>
                      <span style={{ color: "#22C55E" }}>T {ticketStats.correctOnTicket}</span>
                      <span className="mx-1">•</span>
                      <span style={{ color: "#EF4444" }}>N {ticketStats.incorrectOnTicket}</span>
                      <span className="mx-1">|</span>
                      <span 
                        style={{ 
                          background: "#EF4444", 
                          color: "white",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          border: "1px solid #000000"
                        }}
                      >
                        P {ticketStats.missedOnTicket}
                      </span>
                      <span className="mx-1">|</span>
                      <span style={{ 
                        color: ticketStats.accuracyPct <= 50 ? "#EF4444" : 
                               ticketStats.accuracyPct <= 70 ? "#EAB308" : 
                               "#22C55E"
                      }}>{ticketStats.accuracyPct}%</span>
                    </div>
                    
                    {ticket.is_winner && (
                      <div className="mt-2">
                        <Badge variant="default" className="bg-green-600">
                          🎉 DOBITNIK!
                        </Badge>
                      </div>
                    )}
                    
                    {eventMode === "active" && isOnThisTicket && currentDrawnNumber !== null && (
                      <div className="mt-2">
                        {hasAnsweredCurrent ? (
                          <Badge variant="secondary">
                            Odgovoreno na br. {currentDrawnNumber}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-yellow-500 text-yellow-600">
                            Pitanje br. {currentDrawnNumber} - čeka odgovor
                          </Badge>
                        )}
                      </div>
                    )}
                  </CardHeader>
                  
                  <CardContent className="p-3 sm:p-4 pt-0">
                    <div className="grid grid-cols-5 gap-2">
                      {ticket.ticket_questions
                        .sort((a, b) => a.question_number - b.question_number)
                        .map((tq) => {
                          const qNum = Number(tq.question_number);
                          const isCurrent = currentDrawnNumber === qNum && eventMode === "active";
                          const cellState = getCellState(qNum, drawnNumbers, globalAnswersMap);
                          
                          let bgColor = "bg-gray-200 dark:bg-gray-700";
                          let textColor = "text-gray-900 dark:text-gray-100";
                          let borderClass = "";
                          
                          switch (cellState) {
                            case "correct":
                              bgColor = "bg-[#22C55E]";
                              textColor = "text-white";
                              break;
                            case "wrong":
                              bgColor = "bg-[#DC2626]";
                              textColor = "text-white";
                              break;
                            case "missed":
                              bgColor = "bg-[#DC2626]";
                              textColor = "text-white";
                              borderClass = "border-2 border-[#111111]";
                              break;
                            case "not-drawn":
                              break;
                          }
                          
                          return (
                            <div
                              key={qNum}
                              className={cn(
                                "aspect-square flex items-center justify-center rounded text-xs font-bold transition-all",
                                bgColor,
                                textColor,
                                borderClass
                              )}
                            >
                              {qNum}
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Add ticket card */}
            {canAddTicket && (
              <Dialog open={addTicketOpen} onOpenChange={setAddTicketOpen}>
                <DialogTrigger asChild>
                  <Card className="cursor-pointer bg-white/60 hover:bg-white/80 transition-all border-2 border-dashed">
                    <CardContent className="flex flex-col items-center justify-center h-full py-8">
                      <Plus className="h-8 w-8 sm:h-12 sm:w-12 text-purple-600 mb-2" />
                      <p className="text-xs sm:text-sm font-semibold text-center">Dodaj tiket</p>
                      <p className="text-xs text-muted-foreground text-center mt-1">({tickets.length}/4)</p>
                    </CardContent>
                  </Card>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Dodaj novi tiket</DialogTitle>
                    <DialogDescription>
                      Unesite serijski broj tiketa za dodavanje u igru.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="serial">Serijski broj tiketa</Label>
                      <Input
                        id="serial"
                        placeholder="Npr. T-A7F3K9M2"
                        value={newTicketSerial}
                        onChange={(e) => setNewTicketSerial(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !addingTicket) {
                            handleAddTicket();
                          }
                        }}
                        disabled={addingTicket}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAddTicketOpen(false);
                        setNewTicketSerial("");
                      }}
                      disabled={addingTicket}
                      className="flex-1"
                    >
                      Odustani
                    </Button>
                    <Button
                      onClick={handleAddTicket}
                      disabled={addingTicket || !newTicketSerial.trim()}
                      className="flex-1"
                    >
                      {addingTicket ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Dodajem...
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Dodaj
                        </>
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {tickets.length >= 4 && eventMode === "active" && (
            <p className="text-center text-xs text-white/80">Limit 4 tiketa (promo faza)</p>
          )}

          {/* Current question */}
          {eventMode === "active" && focusedTicket && currentQuestion && currentDrawnNumber && (
            <Card className="bg-white/95 backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-lg">
                    Pitanje #{currentDrawnNumber}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    <span className={`text-2xl font-bold ${timeLeft <= 3 ? "text-red-500 animate-pulse" : ""}`}>
                      {timeLeft}s
                    </span>
                  </div>
                </div>
                <CardTitle className="text-xl sm:text-2xl mt-4">{currentQuestion.text}</CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const existingAnswer = answers.find(
                    (a) => a.ticket_id === focusedTicket?.serial_number && Number(a.question_number) === currentDrawnNumber
                  );

                  if (existingAnswer) {
                    const isCorrect =
                      normalizeAnswer(existingAnswer.answer) ===
                      normalizeAnswer(currentQuestion.correct_answer);
                    return (
                      <div className="text-center py-8 space-y-4">
                        <div
                          className={`text-6xl ${
                            isCorrect ? "text-green-500" : "text-red-500"
                          }`}
                        >
                          {isCorrect ? "✅" : "❌"}
                        </div>
                        <p className="text-lg font-bold">
                          {isCorrect ? "Točan odgovor!" : "Netočan odgovor"}
                        </p>
                        <p className="text-muted-foreground">
                          Tvoj odgovor:{" "}
                          {existingAnswer.answer ? "DA" : "NE"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Točan odgovor:{" "}
                          {currentQuestion.correct_answer ? "DA" : "NE"}
                        </p>
                      </div>
                    );
                  }

                  if (timeLeft <= 0) {
                    return (
                      <div className="text-center py-8 space-y-4">
                        <Clock className="h-16 w-16 mx-auto text-muted-foreground" />
                        <p className="text-lg text-muted-foreground">Vrijeme za odgovor je isteklo</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <Button
                          size="lg"
                          className="h-24 text-2xl font-bold"
                          onClick={() => handleAnswer(true)}
                          disabled={submitting}
                        >
                          {submitting ? "..." : "DA"}
                        </Button>
                        <Button
                          size="lg"
                          className="h-24 text-2xl font-bold"
                          onClick={() => handleAnswer(false)}
                          disabled={submitting}
                        >
                          {submitting ? "..." : "NE"}
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Waiting message */}
          {eventMode === "active" && !currentQuestion && (
            <Card className="bg-white/80 backdrop-blur">
              <CardContent className="text-center py-12">
                <Loader2 className="h-12 w-12 animate-spin mx-auto text-purple-600" />
                <p className="text-lg text-muted-foreground">Čekamo sljedeće pitanje...</p>
              </CardContent>
            </Card>
          )}

          {/* Results mode */}
          {eventMode === "finished" && (
            <Card className="bg-white/80 backdrop-blur">
              <CardContent className="text-center py-12">
                <Trophy className="h-16 w-16 mx-auto text-yellow-500" />
                <p className="text-xl font-bold mb-2">Rezultati za {activeEvent?.name}</p>
                <p className="text-muted-foreground mb-6">
                  Izvučeno {drawnNumbers.length} od 90 brojeva
                </p>
                
                {winnerSerial && (
                  <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 mb-6">
                    <p className="text-lg font-bold text-yellow-800">🏆 Pobjednik: {winnerSerial}</p>
                  </div>
                )}
                
                <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                  <Button 
                    onClick={() => setShowDetailedReview(!showDetailedReview)} 
                    variant="outline"
                    size="lg"
                    className="flex-1"
                  >
                    📊 {showDetailedReview ? "Sakrij" : "Prikaži"} detaljan pregled
                  </Button>
                  <Button 
                    onClick={() => router.push("/play")} 
                    size="lg"
                    className="flex-1"
                  >
                    <TicketIcon className="mr-2 h-5 w-5" />
                    Novi event
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Detailed Review Section */}
          {eventMode === "finished" && showDetailedReview && allDrawnQuestions.length > 0 && (
            <Card className="bg-white/95 backdrop-blur">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl">📊 Detaljan Pregled Pitanja</CardTitle>
                    <CardDescription>
                      Izvučeno {allDrawnQuestions.length} pitanja - Tvoji odgovori vs Točni odgovori
                    </CardDescription>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={reviewFilter === "all" ? "default" : "outline"}
                      onClick={() => setReviewFilter("all")}
                    >
                      Sva ({allDrawnQuestions.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={reviewFilter === "correct" ? "default" : "outline"}
                      onClick={() => setReviewFilter("correct")}
                      className="text-green-600 border-green-600 hover:bg-green-50"
                    >
                      Točna ({globalStats.correctTotal})
                    </Button>
                    <Button
                      size="sm"
                      variant={reviewFilter === "incorrect" ? "default" : "outline"}
                      onClick={() => setReviewFilter("incorrect")}
                      className="text-red-600 border-red-600 hover:bg-red-50"
                    >
                      Netočna ({globalStats.incorrectTotal + globalStats.skippedTotal})
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-3">
                {allDrawnQuestions
                  .filter((q) => {
                    if (reviewFilter === "all") return true;
                    
                    const ans = globalAnswersMap.get(q.number);
                    if (!ans) {
                      return reviewFilter === "incorrect";
                    }
                    
                    if (reviewFilter === "correct") return ans.isCorrect;
                    if (reviewFilter === "incorrect") return !ans.isCorrect;
                    return true;
                  })
                  .map((q) => {
                    const ans = globalAnswersMap.get(q.number);
                    const isCorrect = ans?.isCorrect || false;
                    const isMissed = !ans;
                    
                    return (
                      <div
                        key={q.number}
                        className={cn(
                          "border-l-4 p-4 rounded-lg transition-all",
                          isCorrect && "border-green-500 bg-green-50/50",
                          !isCorrect && !isMissed && "border-red-500 bg-red-50/50",
                          isMissed && "border-red-500 bg-red-50/50"
                        )}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <Badge variant="outline" className="text-base font-bold">
                            #{q.number}
                          </Badge>
                          <Badge
                            variant={isCorrect ? "default" : "destructive"}
                            className={cn(
                              "text-sm",
                              isCorrect && "bg-green-600",
                              isMissed && "bg-red-600 border-2 border-black"
                            )}
                          >
                            {isMissed ? "⏭️ Propušteno" : isCorrect ? "✅ Točno" : "❌ Netočno"}
                          </Badge>
                        </div>
                        
                        <p className="text-lg font-medium mb-4">{q.text}</p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className={cn(
                            "p-3 rounded-md",
                            isMissed ? "bg-red-100 border-2 border-red-600" : isCorrect ? "bg-green-100" : "bg-red-100"
                          )}>
                            <p className="text-xs text-muted-foreground mb-1">Tvoj odgovor:</p>
                            <p className={cn(
                              "text-xl font-bold",
                              isMissed ? "text-red-700" : isCorrect ? "text-green-700" : "text-red-700"
                            )}>
                              {isMissed ? "—" : ans?.answer ? "DA" : "NE"}
                            </p>
                          </div>
                          
                          <div className="bg-green-100 p-3 rounded-md">
                            <p className="text-xs text-muted-foreground mb-1">Točan odgovor:</p>
                            <p className="text-xl font-bold text-green-700">
                              {q.correct_answer ? "DA" : "NE"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                
                {allDrawnQuestions.filter((q) => {
                  if (reviewFilter === "all") return true;
                  const ans = globalAnswersMap.get(q.number);
                  if (!ans) return reviewFilter === "incorrect";
                  if (reviewFilter === "correct") return ans.isCorrect;
                  if (reviewFilter === "incorrect") return !ans.isCorrect;
                  return true;
                }).length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      {reviewFilter === "correct" 
                        ? "Nemaš točnih odgovora" 
                        : "Nemaš netočnih odgovora"}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}