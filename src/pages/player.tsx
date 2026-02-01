import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { eventService, Event, Question } from "@/services/eventService";
import { answerService } from "@/services/answerService";
import { ticketService } from "@/services/ticketService";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Clock, Trophy, Ticket, Plus, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { computeEventLevelGlobalStats } from "@/lib/statsHelper";

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

  // Load tickets from URL or localStorage
  useEffect(() => {
    const loadTickets = async () => {
      console.log("[PLAYER] 🎬 Starting ticket load...");
      setLoading(true);
      try {
        const ticketSerial = router.query.ticket as string;
        const eventIdParam = router.query.event as string;

        let ticketsToLoad: string[] = [];
        let eventId: string | null = null;

        // Priority 1: URL has ticket serial (newly created)
        if (ticketSerial) {
          console.log("[PLAYER] 📋 Loading ticket from URL:", ticketSerial);
          ticketsToLoad = [ticketSerial];
          const ticket = await ticketService.getTicketBySerial(ticketSerial);
          if (ticket) {
             eventId = ticket.event_id;
             console.log("[PLAYER] 🎫 Ticket found, event_id:", eventId);
             const storedTickets = getStoredFreeTickets(eventId);
             ticketsToLoad = [...new Set([ticketSerial, ...storedTickets])];
             console.log("[PLAYER] 📚 Combined with stored tickets:", ticketsToLoad);
          }
        }
        // Priority 2: URL has eventId (open my tickets)
        else if (eventIdParam) {
          console.log("[PLAYER] 🎯 Loading tickets for event:", eventIdParam);
          eventId = eventIdParam;
          ticketsToLoad = getStoredFreeTickets(eventId);
          console.log("[PLAYER] 📚 Found stored tickets:", ticketsToLoad);
        }

        // If no tickets found, show empty state
        if (ticketsToLoad.length === 0) {
          console.log("[PLAYER] ❌ No tickets to load");
          setLoading(false);
          return;
        }

        // Fetch all tickets
        console.log("[PLAYER] 🔄 Fetching ticket details...");
        const ticketPromises = ticketsToLoad.map(serial => ticketService.getTicketBySerial(serial));
        const loadedTickets = (await Promise.all(ticketPromises)).filter(t => t !== null) as TicketData[];
        setTickets(loadedTickets);

        console.log("[PLAYER] ✅ Loaded tickets:", loadedTickets.map(t => ({
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

        // Load event (active or last finished)
        if (eventId || loadedTickets[0]?.event_id) {
          const currentEventId = eventId || loadedTickets[0].event_id;
          console.log("[PLAYER] 🎪 Loading event data for:", currentEventId);
          await refetchEventData(currentEventId, loadedTickets);
          
          // Only subscribe to realtime if event is active
          const event = await eventService.getEventById(currentEventId);
          console.log("[PLAYER] 🎪 Event status:", event.status);
          
          if (event && event.status === "active") {
            console.log("[PLAYER] 🔔 Setting up realtime subscription");
            setupRealtimeSubscription(currentEventId);
          } else {
            console.log("[PLAYER] 📊 Event is finished, entering RESULTS mode");
          }
        }
      } catch (error) {
        console.error("[Player] ❌ Failed to load tickets:", error);
        toast({
          title: "Greška",
          description: "Greška pri učitavanju tiketa.",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
        console.log("[PLAYER] ✅ Ticket load complete");
      }
    };

    if (router.isReady) {
      loadTickets();
    }
  }, [router.isReady, router.query.ticket, router.query.event]);

  // Refetch event data
  const refetchEventData = async (eventId: string, loadedTickets: TicketData[]) => {
    console.log("[PLAYER] 🔄 Refetching event data for:", eventId);
    try {
      const event = await eventService.getEventById(eventId);
      console.log("[PLAYER] 🎪 Event data:", {
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
      
      console.log("[PLAYER] 🎯 Event mode set to:", event.status === "finished" ? "FINISHED" : "ACTIVE");
      
      // Handle winner
      if (event.winner_ticket_id) {
        const winnerTicket = await ticketService.getTicket(event.winner_ticket_id);
        setWinnerSerial(winnerTicket?.serial_number || null);
        console.log("[PLAYER] 🏆 Winner ticket:", winnerTicket?.serial_number);
      } else {
        setWinnerSerial(null);
      }

      // Create/Get session (only for active events)
      if (event.status === "active") {
        console.log("[PLAYER] 🔑 Creating/getting session for active event");
        const session = await answerService.getOrCreateSession(eventId);
        setSessionId(session.id);
        console.log("[PLAYER] 🔑 Session ID:", session.id);
      } else {
        console.log("[PLAYER] ⏸️ Skipping session creation (event is finished)");
      }

      // Load current question (only for active events)
      if (event.status === "active" && event.current_drawn_number) {
        console.log("[PLAYER] ❓ Loading current question:", event.current_drawn_number);
        const questionData = await eventService.getQuestionForNumber(event.id, event.current_drawn_number);
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
          console.log("[PLAYER] ⏱️ Time left:", remaining, "seconds");
        }
      } else {
        setCurrentQuestion(null);
        setTimeLeft(0);
        console.log("[PLAYER] ⏸️ No current question (event finished or no drawn number)");
      }

      // Load ALL drawn questions correct answers
      try {
        console.log("[PLAYER] 📚 Loading drawn questions map...");
        const answersMap = await eventService.getDrawnQuestions(event.id);
        setCorrectAnswersMap(answersMap);
        console.log("[PLAYER] 📚 Drawn questions loaded:", Object.keys(answersMap).length, "questions");
        
        // If event is finished, load full question data for review
        if (event.status === "finished" && event.drawn_numbers && event.drawn_numbers.length > 0) {
          console.log("[PLAYER] 📖 Loading full question data for review...");
          const questionsData: Array<{ number: number; text: string; correct_answer: boolean }> = [];
          
          for (const qNum of event.drawn_numbers) {
            try {
              const questionData = await eventService.getQuestionForNumber(event.id, qNum);
              if (questionData && questionData.questions) {
                questionsData.push({
                  number: qNum,
                  text: questionData.questions.text,
                  correct_answer: questionData.questions.correct_answer
                });
              }
            } catch (err) {
              console.warn(`[PLAYER] ⚠️ Failed to load question ${qNum}:`, err);
            }
          }
          
          setAllDrawnQuestions(questionsData.sort((a, b) => a.number - b.number));
          console.log("[PLAYER] 📖 Loaded", questionsData.length, "questions for review");
        }
      } catch (err) {
        console.error("[PLAYER] ❌ Failed to load drawn questions map:", err);
      }

      // Load answers for ALL tickets using SERIAL_NUMBER as key
      console.log("[PLAYER] 💬 Loading answers for all tickets...");
      const allAnswers: Answer[] = [];
      for (const ticket of loadedTickets) {
        console.log(`[PLAYER] 💬 Loading answers for ticket: ${ticket.serial_number}`);
        const ticketAnswers = await answerService.getAnswersForTicket(ticket.serial_number);
        console.log(`[PLAYER] 💬 Found ${ticketAnswers.length} answers for ${ticket.serial_number}`);
        allAnswers.push(...ticketAnswers);
      }
      setAnswers([...allAnswers]);
      
      console.log(`[PLAYER] ✅ Total answers loaded: ${allAnswers.length}`);
      console.log("[Player] ✅ Event data refetch complete");

      // Compute EVENT-LEVEL global stats
      console.log("[PLAYER] 📊 Computing event-level global stats...");
      const ticketSerials = loadedTickets.map(t => t.serial_number);
      const eventGlobalStats = await computeEventLevelGlobalStats(event.id, ticketSerials);
      setGlobalStats(eventGlobalStats);
      console.log("[PLAYER] 📊 Event-level global stats set:", eventGlobalStats);
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
      const updatedTickets = [...tickets, ticket];
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

  console.log(`[PLAYER] 📊 Stats computation:`, {
    answersMapSize: globalAnswersMap.size,
    drawnCount: drawnNumbers.length,
    totalAnswers: answers.length,
    mode: eventMode,
    ticketsCount: tickets.length
  });

  // Compute GLOBAL stats (aggregate across ALL tickets)
  const globalStats = computeGlobalStats(tickets, drawnNumbers, globalAnswersMap);

  const focusedTicket = tickets.find(t => t.id === focusedTicketId);
  const canAddTicket = activeEvent && eventMode === "active" && tickets.length < 4;

  if (loading) {
    return (
      <>
        <SEO title="Igrač - Pitalica Skitalica" />
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
          <Loader2 className="h-12 w-12 animate-spin text-white" />
        </div>
      </>
    );
  }

  if (tickets.length === 0) {
    console.log("[PLAYER] ℹ️ No tickets found, showing empty state");
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
                <Ticket className="mr-2 h-5 w-5" />
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
    console.log("[PLAYER] 🏆 Showing winner screen for:", winnerSerial);
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
                    // Stay on page to show results
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
                  Nova igra
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ticket Detail Modal */}
        <Dialog open={ticketDetailOpen} onOpenChange={setTicketDetailOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Pregled tiketa</DialogTitle>
              <DialogDescription>
                {selectedTicketForDetail?.serial_number}
                {selectedTicketForDetail?.serial_number === winnerSerial && " 🏆 DOBITNIK"}
              </DialogDescription>
            </DialogHeader>
            {selectedTicketForDetail && (
              <div className="space-y-4">
                {/* Stats */}
                {(() => {
                  const ticketNumbers = selectedTicketForDetail.ticket_questions.map(tq => Number(tq.question_number));
                  const ticketStats = computeTicketStats(
                    ticketNumbers,
                    drawnNumbers,
                    globalAnswersMap,
                    selectedTicketForDetail.serial_number
                  );

                  return (
                    <div className="p-4 bg-muted rounded-lg">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground">Izvučeno</p>
                          <p className="font-bold">{ticketStats.drawnOnTicketCount}/15</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Točnost</p>
                          <p className="font-bold">{ticketStats.accuracyPct}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Točno</p>
                          <p className="font-bold text-green-600">{ticketStats.correctOnTicket}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Netočno</p>
                          <p className="font-bold text-red-600">{ticketStats.incorrectOnTicket}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Propušteno</p>
                          <p className="font-bold">{ticketStats.missedOnTicket}</p>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Grid */}
                <div className="grid grid-cols-5 gap-2">
                  {selectedTicketForDetail.ticket_questions
                    .sort((a, b) => a.question_number - b.question_number)
                    .map((tq) => {
                      const qNum = Number(tq.question_number);
                      const cellState = getCellState(qNum, drawnNumbers, globalAnswersMap);
                      
                      let bgColor = "bg-gray-200 dark:bg-gray-700";
                      let textColor = "text-gray-900 dark:text-gray-100";
                      
                      switch (cellState) {
                        case "correct":
                          bgColor = "bg-green-500";
                          textColor = "text-white";
                          break;
                        case "wrong":
                          bgColor = "bg-red-500";
                          textColor = "text-white";
                          break;
                        case "missed":
                          bgColor = "bg-gray-400 dark:bg-gray-600";
                          textColor = "text-white";
                          break;
                        case "not-drawn":
                          // Keep default
                          break;
                      }
                      
                      return (
                        <div
                          key={qNum}
                          className={cn(
                            "aspect-square flex items-center justify-center rounded text-xs font-bold",
                            bgColor,
                            textColor
                          )}
                        >
                          {qNum}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  console.log("[PLAYER] 📊 Rendering main player view, mode:", eventMode);

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
            <Card className="bg-white/95 backdrop-blur">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg sm:text-xl">
                      {focusedTicket.serial_number}
                    </CardTitle>
                    <CardDescription className="text-xs sm:text-sm">
                      {activeEvent?.name || "Event"}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline" className="text-xs sm:text-sm">
                      {tickets.length} / 4 tiketa
                    </Badge>
                    {eventMode === "finished" && (
                      <Badge variant="secondary" className="text-xs sm:text-sm">
                        Završeno
                      </Badge>
                    )}
                  </div>
                </div>

                {/* GLOBAL STATS - 6 METRICS (2 rows x 3 cols) */}
                <div className="grid grid-cols-3 gap-2 text-center pt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Izvučeno</p>
                    <p className="text-lg font-bold">{globalStats.totalDrawn}/90</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Odgovoreno</p>
                    <p className="text-lg font-bold">{globalStats.answeredTotal}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Propušteno</p>
                    <p className="text-lg font-bold">{globalStats.skippedTotal}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div>
                    <p className="text-xs text-muted-foreground">Točno</p>
                    <p className="text-lg font-bold text-green-600">{globalStats.correctTotal}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Netočno</p>
                    <p className="text-lg font-bold text-red-600">{globalStats.incorrectTotal}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Točnost</p>
                    <p className="text-lg font-bold">{globalStats.accuracyPct}%</p>
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* MULTI-TICKET GRID - EACH TICKET USES SAME FUNCTION */}
          <div className={`grid gap-2 ${tickets.length === 1 ? "grid-cols-1" : tickets.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>
            {tickets.map((ticket) => {
              const isFocused = ticket.id === focusedTicketId;
              
              // CRITICAL: Normalize ticket numbers to Number[]
              const ticketNumbers = ticket.ticket_questions.map(tq => Number(tq.question_number));
              
              // CRITICAL: Compute stats using SAME function for ALL tickets
              const ticketStats = computeTicketStats(
                ticketNumbers,
                drawnNumbers,
                globalAnswersMap,
                ticket.serial_number
              );
              
              // Current question status for this ticket
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
                    
                    {/* PER-TICKET STATS - SAME FOR ALL TICKETS */}
                    <div className="text-xs text-muted-foreground">
                      <div className="flex flex-col gap-1 mt-1">
                        <span>Izvučeno: {ticketStats.drawnOnTicketCount}/15</span>
                        <span>Točno: {ticketStats.correctOnTicket} • Netočno: {ticketStats.incorrectOnTicket}</span>
                        <span>Propušteno: {ticketStats.missedOnTicket}</span>
                        <span>Točnost: {ticketStats.accuracyPct}%</span>
                      </div>
                    </div>
                    
                    {ticket.is_winner && (
                      <div className="mt-2">
                        <Badge variant="default" className="bg-green-600">
                          🎉 DOBITNIK!
                        </Badge>
                      </div>
                    )}
                    
                    {/* Current question status (only in active mode) */}
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
                    {/* Ticket grid (5x3) - SAME getCellState FOR ALL */}
                    <div className="grid grid-cols-5 gap-2">
                      {ticket.ticket_questions
                        .sort((a, b) => a.question_number - b.question_number)
                        .map((tq) => {
                          const qNum = Number(tq.question_number);
                          const isCurrent = currentDrawnNumber === qNum && eventMode === "active";
                          
                          // CRITICAL: Use SAME function for cell state
                          const cellState = getCellState(qNum, drawnNumbers, globalAnswersMap);
                          
                          let bgColor = "bg-gray-200 dark:bg-gray-700";
                          let textColor = "text-gray-900 dark:text-gray-100";
                          
                          switch (cellState) {
                            case "correct":
                              bgColor = "bg-green-500";
                              textColor = "text-white";
                              break;
                            case "wrong":
                              bgColor = "bg-red-500";
                              textColor = "text-white";
                              break;
                            case "missed":
                              bgColor = "bg-gray-400 dark:bg-gray-600";
                              textColor = "text-white";
                              break;
                            case "not-drawn":
                              // Keep default
                              break;
                          }
                          
                          return (
                            <div
                              key={qNum}
                              className={cn(
                                "aspect-square flex items-center justify-center rounded text-xs font-bold transition-all",
                                bgColor,
                                textColor,
                                isCurrent && "ring-2 ring-yellow-400 scale-110"
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

            {/* Add ticket card (only in active mode) */}
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

          {/* Current question (only in active mode) */}
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
                        <p className="text-xl font-bold">
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

          {/* Waiting message (only in active mode) */}
          {eventMode === "active" && !currentQuestion && (
            <Card className="bg-white/80 backdrop-blur">
              <CardContent className="text-center py-12">
                <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-purple-600" />
                <p className="text-lg text-muted-foreground">Čekamo sljedeće pitanje...</p>
              </CardContent>
            </Card>
          )}

          {/* Results mode - no active question */}
          {eventMode === "finished" && (
            <Card className="bg-white/80 backdrop-blur">
              <CardContent className="text-center py-12">
                <Trophy className="h-16 w-16 mx-auto mb-4 text-yellow-500" />
                <p className="text-xl font-bold mb-2">Rezultati za {activeEvent?.name}</p>
                <p className="text-muted-foreground mb-6">
                  Izvučeno {drawnNumbers.length} od 90 brojeva
                </p>
                
                {/* Show winner if exists */}
                {winnerSerial && (
                  <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 mb-6">
                    <p className="text-lg font-bold text-yellow-800">🏆 Pobjednik: {winnerSerial}</p>
                  </div>
                )}
                
                {/* Action buttons */}
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
                    <Ticket className="mr-2 h-5 w-5" />
                    Novi event
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Detailed Review Section (FINISHED events only) */}
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
                  
                  {/* Filter buttons */}
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
                      // Missed question = incorrect
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
                          isMissed && "border-gray-400 bg-gray-50/50"
                        )}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                          <Badge variant="outline" className="text-base font-bold">
                            #{q.number}
                          </Badge>
                          <Badge
                            variant={isCorrect ? "default" : "destructive"}
                            className={cn(
                              "text-sm",
                              isCorrect && "bg-green-600",
                              isMissed && "bg-gray-500"
                            )}
                          >
                            {isMissed ? "⏭️ Propušteno" : isCorrect ? "✅ Točno" : "❌ Netočno"}
                          </Badge>
                        </div>
                        
                        {/* Question text */}
                        <p className="text-lg font-medium mb-4">{q.text}</p>
                        
                        {/* Answers comparison */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className={cn(
                            "p-3 rounded-md",
                            isMissed ? "bg-gray-100" : isCorrect ? "bg-green-100" : "bg-red-100"
                          )}>
                            <p className="text-xs text-muted-foreground mb-1">Tvoj odgovor:</p>
                            <p className={cn(
                              "text-xl font-bold",
                              isMissed ? "text-gray-600" : isCorrect ? "text-green-700" : "text-red-700"
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
                
                {/* No results message */}
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