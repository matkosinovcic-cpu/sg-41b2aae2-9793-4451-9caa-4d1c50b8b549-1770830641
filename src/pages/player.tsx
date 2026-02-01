import { SEO } from "@/components/SEO";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { eventService, Event, Question, TicketQuestion } from "@/services/eventService";
import { answerService } from "@/services/answerService";
import { ticketService } from "@/services/ticketService";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, Trophy, Ticket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { calculateSingleTicketStats } from "@/lib/statsHelper";
import { cn } from "@/lib/utils";

const ANSWER_TIMEOUT = 10;

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

// Local comparison (matches service logic)
function normalizeAnswer(value: any): boolean | null {
  if (value === true || value === "true" || value === 1) return true;
  if (value === false || value === "false" || value === 0) return false;
  return null;
}

export default function PlayerPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Multi-ticket state
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [sessionId, setSessionId] = useState<string>("");

  // Game state
  const [currentDrawnNumber, setCurrentDrawnNumber] = useState<number | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [winnerSerial, setWinnerSerial] = useState<string | null>(null);
  
  // Stores correct answer for ALL drawn questions (for stats calculation)
  const [correctAnswersMap, setCorrectAnswersMap] = useState<Record<number, boolean>>({});

  // Load tickets from URL or localStorage
  useEffect(() => {
    const loadTickets = async () => {
      setLoading(true);
      try {
        const ticketSerial = router.query.ticket as string;
        const eventIdParam = router.query.event as string;

        let ticketsToLoad: string[] = [];
        let eventId: string | null = null;

        // Priority 1: URL has ticket serial (newly created)
        if (ticketSerial) {
          ticketsToLoad = [ticketSerial];
          const ticket = await ticketService.getTicketBySerial(ticketSerial);
          if (ticket) {
             eventId = ticket.event_id;
             const storedTickets = getStoredFreeTickets(eventId);
             ticketsToLoad = [...new Set([ticketSerial, ...storedTickets])];
          }
        }
        // Priority 2: URL has eventId (open my tickets)
        else if (eventIdParam) {
          eventId = eventIdParam;
          ticketsToLoad = getStoredFreeTickets(eventId);
        }

        if (ticketsToLoad.length === 0) {
          setLoading(false);
          return;
        }

        // Fetch all tickets
        const ticketPromises = ticketsToLoad.map(serial => ticketService.getTicketBySerial(serial));
        const loadedTickets = (await Promise.all(ticketPromises)).filter(t => t !== null) as TicketData[];
        setTickets(loadedTickets);

        // Set focused ticket
        if (ticketSerial) {
          const focused = loadedTickets.find(t => t.serial_number === ticketSerial);
          setFocusedTicketId(focused?.id || loadedTickets[0]?.id || null);
        } else {
          setFocusedTicketId(loadedTickets[0]?.id || null);
        }

        // Load event
        if (eventId || loadedTickets[0]?.event_id) {
          const currentEventId = eventId || loadedTickets[0].event_id;
          await refetchEventData(currentEventId, loadedTickets);
          
          // Subscribe to real-time updates with reconnection
          setupRealtimeSubscription(currentEventId);
        }
      } catch (error) {
        console.error("[Player] Failed to load tickets:", error);
        toast({
          title: "Greška",
          description: "Greška pri učitavanju tiketa.",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    if (router.isReady) {
      loadTickets();
    }
  }, [router.isReady, router.query.ticket, router.query.event]);

  // Refetch event data (used for initial load + resync)
  const refetchEventData = async (eventId: string, loadedTickets: TicketData[]) => {
    try {
      const event = await eventService.getEventById(eventId);
      // CRITICAL: Create NEW object to force React re-render
      setActiveEvent({ ...event });
      setCurrentDrawnNumber(event.current_drawn_number);
      
      // Handle winner serial
      if (event.winner_ticket_id) {
        const winnerTicket = await ticketService.getTicket(event.winner_ticket_id);
        setWinnerSerial(winnerTicket?.serial_number || null);
      } else {
        setWinnerSerial(null);
      }

      // Create/Get session
      const session = await answerService.getOrCreateSession(eventId);
      setSessionId(session.id);

      // Load current question if exists
      if (event.current_drawn_number) {
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
        }
      }

      // Load ALL drawn questions correct answers for complete stats
      try {
        const answersMap = await eventService.getDrawnQuestions(event.id);
        setCorrectAnswersMap(answersMap);
      } catch (err) {
        console.error("Failed to load drawn questions map:", err);
      }

      // Load answers for all tickets
      const allAnswers: Answer[] = [];
      for (const ticket of loadedTickets) {
        const ticketAnswers = await answerService.getAnswersForTicket(ticket.serial_number);
        allAnswers.push(...ticketAnswers);
      }
      setAnswers([...allAnswers]); // Force new array
      
      console.log("[Player] ✅ Event data refetched:", event.current_drawn_number, "drawn:", event.drawn_numbers?.length);
    } catch (error) {
      console.error("[Player] Failed to refetch event data:", error);
    }
  };

  // Setup realtime subscription with reconnection logic
  const setupRealtimeSubscription = (eventId: string) => {
    let reconnectAttempts = 0;
    const maxReconnects = 10;
    let channel: any = null;

    const subscribe = () => {
      console.log("[Player] 🔌 Subscribing to event:", eventId);
      
      channel = supabase
        .channel(`player_event_${eventId}_${Date.now()}`) // Unique channel per mount
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
            
            // CRITICAL: Force React re-render with new objects
            setActiveEvent({ ...updatedEvent });
            setCurrentDrawnNumber(updatedEvent.current_drawn_number);
            
            // Update winner
            if (updatedEvent.winner_ticket_id) {
              ticketService.getTicket(updatedEvent.winner_ticket_id).then(t => {
                setWinnerSerial(t?.serial_number || null);
              });
            } else {
              setWinnerSerial(null);
            }

            // Load new question
            if (updatedEvent.current_drawn_number && updatedEvent.question_open_until) {
              const questionData = await eventService.getQuestionForNumber(eventId, updatedEvent.current_drawn_number);
              if (questionData && questionData.questions) {
                setCurrentQuestion({
                  id: questionData.question_id,
                  text: questionData.questions.text,
                  correct_answer: questionData.questions.correct_answer
                });
                
                // Update map with new question answer
                setCorrectAnswersMap(prev => ({
                  ...prev,
                  [updatedEvent.current_drawn_number!]: questionData.questions!.correct_answer
                }));

                const expiresAt = new Date(updatedEvent.question_open_until).getTime();
                const now = Date.now();
                const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
                setTimeLeft(remaining);
                console.log("[Player] ✅ Question updated:", updatedEvent.current_drawn_number, "time:", remaining);
              }
            } else {
              setCurrentQuestion(null);
              setTimeLeft(0);
            }
          }
        )
        .subscribe((status) => {
          console.log("[Player] Subscription status:", status);
          
          if (status === "CHANNEL_ERROR" && reconnectAttempts < maxReconnects) {
            reconnectAttempts++;
            console.log(`[Player] ⚠️ Channel error, reconnecting... (attempt ${reconnectAttempts}/${maxReconnects})`);
            setTimeout(() => {
              supabase.removeChannel(channel);
              subscribe();
            }, 1500);
          }
        });
    };

    subscribe();

    // Cleanup function
    return () => {
      console.log("[Player] 🔌 Unsubscribing from event:", eventId);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  };

  // Fallback polling for active events (1s interval)
  useEffect(() => {
    if (!activeEvent || activeEvent.status !== "active" || !tickets.length) return;

    console.log("[Player] 🔄 Starting fallback polling...");
    const pollInterval = setInterval(async () => {
      try {
        const event = await eventService.getEventById(activeEvent.id);
        
        // Only update if something actually changed
        if (
          event.current_drawn_number !== currentDrawnNumber ||
          event.drawn_numbers?.length !== activeEvent.drawn_numbers?.length
        ) {
          console.log("[Player] 🔄 Fallback polling detected change, updating...");
          await refetchEventData(activeEvent.id, tickets);
        }
      } catch (error) {
        console.error("[Player] Polling error:", error);
      }
    }, 1000);

    return () => {
      console.log("[Player] 🔄 Stopping fallback polling");
      clearInterval(pollInterval);
    };
  }, [activeEvent?.id, activeEvent?.status, currentDrawnNumber, tickets.length]);

  // Resync on window focus (handles tab switching)
  useEffect(() => {
    if (!activeEvent || !tickets.length) return;

    const handleFocus = () => {
      console.log("[Player] 🔍 Window focused, resyncing...");
      refetchEventData(activeEvent.id, tickets);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[Player] 👁️ Tab visible, resyncing...");
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

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // Handle answer submission (for focused ticket only)
  const handleAnswer = async (answer: boolean) => {
    if (!focusedTicketId || !currentDrawnNumber || !currentQuestion || timeLeft <= 0 || submitting) return;

    const focusedTicket = tickets.find(t => t.id === focusedTicketId);
    if (!focusedTicket) return;

    // Check if already answered
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
      toast({
        title: isCorrect ? "✅ Točno!" : "❌ Netočno",
        description: isCorrect ? "Odgovor je točan!" : "Odgovor nije točan.",
        variant: isCorrect ? "default" : "destructive"
      });
    } catch (error) {
      console.error("[Player] Failed to submit answer:", error);
      toast({
        title: "Greška",
        description: "Greška pri slanju odgovora.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate stats for focused ticket
  const focusedTicket = tickets.find(t => t.id === focusedTicketId);
  
  // GLOBAL STATISTICS (for header scoreboard - all player answers across all tickets)
  const globalStats = useMemo(() => {
    const drawnNumbers = activeEvent?.drawn_numbers || [];
    const drawnCount = drawnNumbers.length; // X = globalDrawn
    
    if (drawnCount === 0) {
      return { 
        drawnCount: 0, 
        answeredCount: 0, 
        correctCount: 0,
        wrongCount: 0,
        missedCount: 0,
        accuracy: 0 
      };
    }
    
    // Svi player odgovori (preko svih tiketa)
    const playerAnswers = answers.filter(a => 
      tickets.some(t => t.serial_number === a.ticket_id)
    );
    
    // A = broj unikatnih izvučenih pitanja na koja je player odgovorio
    const answeredQuestionNumbers = new Set(
      playerAnswers
        .map(a => Number(a.question_number))
        .filter(qNum => drawnNumbers.includes(qNum))
    );
    const answeredCount = answeredQuestionNumbers.size; // globalAnswered
    
    // C = broj točnih odgovora (POTPUNA STATISTIKA)
    let correctCount = 0;
    answeredQuestionNumbers.forEach(qNum => {
      const answer = playerAnswers.find(a => Number(a.question_number) === qNum);
      
      if (answer && correctAnswersMap[qNum] !== undefined) {
        const playerAns = normalizeAnswer(answer.answer);
        const correctAns = normalizeAnswer(correctAnswersMap[qNum]);
        
        if (playerAns === correctAns) {
          correctCount++;
        }
      }
    });
    
    // W = netočni odgovori
    const wrongCount = answeredCount - correctCount; // globalIncorrect
    
    // M = propušteni odgovori
    const missedCount = Math.max(0, drawnCount - answeredCount); // globalMissed
    
    // ✅ ISPRAVLJENA FORMULA: globalAccuracy = (globalCorrect / globalDrawn) * 100
    // Propušteno automatski smanjuje točnost jer je u nazivniku
    const accuracy = drawnCount > 0 
      ? Math.round((correctCount / drawnCount) * 100)
      : 0;
    
    return { 
      drawnCount,           // globalDrawn (X)
      answeredCount,        // globalAnswered (A)
      correctCount,         // globalCorrect (Cg)
      wrongCount,           // globalIncorrect (Wg)
      missedCount,          // globalMissed (M)
      accuracy              // ✅ (Cg / X) * 100
    };
  }, [activeEvent, answers, tickets, correctAnswersMap]);
  
  // PER-TICKET STATISTICS
  // Removed global ticketStats useMemo as we calculate per-ticket inside map

  const canAddTicket = activeEvent && tickets.length < 4;

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

  // Winner screen
  if (winnerSerial) {
    const isWinner = tickets.some(t => t.serial_number === winnerSerial);
    return (
      <>
        <SEO title={isWinner ? "POBJEDNIK! 🎉" : "Event završen"} />
        <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
          <Card className="w-full max-w-2xl">
            <CardHeader className="text-center space-y-4">
              <Trophy className="h-24 w-24 mx-auto text-yellow-500" />
              <CardTitle className="text-4xl font-bold">
                {isWinner ? "🎉 ČESTITAMO! 🎉" : "Event završen"}
              </CardTitle>
              <CardDescription className="text-xl">
                {isWinner ? "TI SI POBJEDNIK!" : `Pobjednik: ${winnerSerial}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              {isWinner && (
                <p className="text-2xl font-bold">Tvoj tiket: {winnerSerial}</p>
              )}
              <Button onClick={() => router.push("/play")} variant="outline" size="lg">
                Nova igra
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <SEO title="Igrač - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 p-2 sm:p-4">
        <div className="max-w-6xl mx-auto space-y-3">
          
          {/* Header with stats */}
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
                  <Badge variant="outline" className="text-xs sm:text-sm">
                    {tickets.length} / 4 tiketa
                  </Badge>
                </div>

                {/* Global player stats grid - 4 COLUMNS */}
                <div className="grid grid-cols-4 gap-2 text-center pt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Izvučeno</p>
                    <p className="text-lg font-bold">{globalStats.drawnCount}/90</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Odgovoreno</p>
                    <p className="text-lg font-bold">{globalStats.answeredCount}/{globalStats.drawnCount}</p>
                  </div>
                  
                  {/* ✅ NEW - Propušteno */}
                  <div>
                    <p className="text-xs text-muted-foreground">Propušteno</p>
                    <p className="text-lg font-bold">{globalStats.missedCount}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Točnost</p>
                    <p className="text-lg font-bold">{globalStats.accuracy}%</p>
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* Multi-ticket grid */}
          <div className={`grid gap-2 ${tickets.length === 1 ? "grid-cols-1" : tickets.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>
            {tickets.map((ticket, ticketIndex) => {
              const isFocused = ticket.id === focusedTicketId;
              
              // ✅ CALCULATE STATS FOR THIS TICKET (not focused ticket)
              const ticketNumbers = ticket.ticket_questions.map(tq => Number(tq.question_number));
              const drawnNumbers = activeEvent?.drawn_numbers || [];
              const isFinished = activeEvent?.status === "finished";
              
              // Td = broj izvučenih pitanja koja se nalaze na tom tiketu
              const drawnOnTicket = ticketNumbers.filter(n => drawnNumbers.includes(n));
              const drawnCountOnTicket = drawnOnTicket.length; // Td
              
              // Odgovori NA OVOM tiketu (samo za pitanja koja su NA tom tiketu)
              const thisTicketAnswers = answers.filter(a => 
                a.ticket_id === ticket.serial_number && 
                ticketNumbers.includes(Number(a.question_number))
              );
              const answeredOnTicket = thisTicketAnswers.length;
              
              // Ct = broj točnih odgovora na tom tiketu (using correctAnswersMap)
              let correctOnTicket = 0;
              thisTicketAnswers.forEach(a => {
                const qNum = Number(a.question_number);
                if (correctAnswersMap[qNum] !== undefined) {
                  const playerAns = normalizeAnswer(a.answer);
                  const correctAns = normalizeAnswer(correctAnswersMap[qNum]);
                  if (playerAns === correctAns) {
                    correctOnTicket++;
                  }
                }
              });
              
              // Wt = broj netočnih odgovora na tom tiketu
              const wrongOnTicket = answeredOnTicket - correctOnTicket;
              
              // Mt = propušteni odgovori na tom tiketu (LIVE vs RESULTS)
              const missedOnTicket = isFinished 
                ? Math.max(0, 15 - correctOnTicket - wrongOnTicket)  // RESULTS: 15 - (Ct + Wt)
                : Math.max(0, drawnCountOnTicket - answeredOnTicket); // LIVE: Td - answered
              
              // Pt = točnost na tom tiketu (LIVE vs RESULTS)
              const thisTicketAccuracy = isFinished
                ? Math.round((correctOnTicket / 15) * 100)  // RESULTS: (Ct / 15) * 100
                : (drawnCountOnTicket > 0 
                    ? Math.round((correctOnTicket / drawnCountOnTicket) * 100)  // LIVE: (Ct / Td) * 100
                    : 0);
              
              // Debug log (development only, no UI)
              if (process.env.NODE_ENV === 'development') {
                console.log(`[Ticket ${ticketIndex + 1} Stats]`, {
                  serial: ticket.serial_number,
                  mode: isFinished ? 'RESULTS' : 'LIVE',
                  drawnOnTicket: drawnCountOnTicket,
                  correct: correctOnTicket,
                  wrong: wrongOnTicket,
                  missed: missedOnTicket,
                  accuracy: thisTicketAccuracy
                });
              }
              
              // Get current question status for this ticket
              const isOnAnyTicket = currentDrawnNumber !== null && ticketNumbers.includes(currentDrawnNumber);
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
                    
                    {/* ✅ PER-TICKET STATS - SHOWN FOR ALL TICKETS */}
                    <div className="text-xs text-muted-foreground">
                      <div className="flex flex-col gap-1 mt-1">
                        <span>Izvučeno: {drawnCountOnTicket}/15</span>
                        <span>Točno: {correctOnTicket} • Netočno: {wrongOnTicket}</span>
                        <span>Propušteno: {missedOnTicket}</span>
                        <span>Točnost: {thisTicketAccuracy}%</span>
                      </div>
                    </div>
                    
                    {ticket.is_winner && (
                      <div className="mt-2">
                        <Badge variant="default" className="bg-green-600">
                          🎉 DOBITNIK!
                        </Badge>
                      </div>
                    )}
                    
                    {/* Current question status for this ticket */}
                    {isOnAnyTicket && currentDrawnNumber !== null && (
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
                    {/* Ticket grid (5x3) */}
                    <div className="grid grid-cols-5 gap-2">
                      {ticket.ticket_questions
                        .sort((a, b) => a.question_number - b.question_number)
                        .map((tq) => {
                          const qNum = tq.question_number;
                          const isDrawn = drawnNumbers.includes(qNum);
                          const isCurrent = currentDrawnNumber === qNum;
                          const answer = answers.find(
                            a => a.ticket_id === ticket.serial_number && Number(a.question_number) === qNum
                          );
                          
                          let bgColor = "bg-gray-200 dark:bg-gray-700";
                          let textColor = "text-gray-900 dark:text-gray-100";
                          
                          if (isDrawn && answer && correctAnswersMap[qNum] !== undefined) {
                            const playerAns = normalizeAnswer(answer.answer);
                            const correctAns = normalizeAnswer(correctAnswersMap[qNum]);
                            const isCorrect = playerAns === correctAns;
                            
                            if (isCorrect) {
                              bgColor = "bg-green-500";
                              textColor = "text-white";
                            } else {
                              bgColor = "bg-red-500";
                              textColor = "text-white";
                            }
                          } else if (isDrawn && !answer) {
                            bgColor = "bg-gray-400 dark:bg-gray-600";
                            textColor = "text-white";
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

            {/* Add ticket card (if < 4) */}
            {canAddTicket && (
              <Card className="cursor-pointer bg-white/60 hover:bg-white/80 transition-all border-2 border-dashed" onClick={() => router.push("/play")}>
                <CardContent className="flex flex-col items-center justify-center h-full py-8">
                  <Ticket className="h-8 w-8 sm:h-12 sm:w-12 text-purple-600 mb-2" />
                  <p className="text-xs sm:text-sm font-semibold text-center">Dodaj tiket</p>
                  <p className="text-xs text-muted-foreground text-center mt-1">({tickets.length}/4)</p>
                </CardContent>
              </Card>
            )}
          </div>

          {tickets.length >= 4 && (
            <p className="text-center text-xs text-white/80">Limit 4 tiketa (promo faza)</p>
          )}

          {/* Current question */}
          {focusedTicket && currentQuestion && currentDrawnNumber && (
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
                  // Check if already answered for focused ticket
                  const existingAnswer = answers.find(
                    (a) => a.ticket_id === focusedTicket?.serial_number && a.question_number === currentDrawnNumber
                  );

                  // Check if question is on ANY of player's tickets (for info display only)
                  const isOnAnyTicket = tickets.some(ticket =>
                    ticket.ticket_questions.some(tq => Number(tq.question_number) === Number(currentDrawnNumber))
                  );

                  // Debug log in development
                  if (process.env.NODE_ENV === 'development' && tickets.length > 0) {
                    console.log('[Player Ticket Debug]', {
                      currentDrawnNumber,
                      questionNumberType: typeof currentDrawnNumber,
                      sampleTicket: {
                        serial: tickets[0].serial_number,
                        questionNumbers: tickets[0].ticket_questions.map(tq => ({
                          value: tq.question_number,
                          type: typeof tq.question_number
                        }))
                      },
                      isOnAnyTicket
                    });
                  }

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
                        <p className="text-xl font-semibold text-muted-foreground">
                          Vrijeme za odgovor je isteklo
                        </p>
                      </div>
                    );
                  }

                  // Render ticket question buttons
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

          {!currentQuestion && (
            <Card className="bg-white/80 backdrop-blur">
              <CardContent className="text-center py-12">
                <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-purple-600" />
                <p className="text-lg text-muted-foreground">Čekamo sljedeće pitanje...</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}