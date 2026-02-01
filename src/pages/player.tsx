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
import { Loader2, Clock, Trophy, Ticket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

// Normalize answer values
function normalizeAnswer(value: any): boolean | null {
  if (value === true || value === "true" || value === 1) return true;
  if (value === false || value === "false" || value === 0) return false;
  return null;
}

// Compute per-ticket stats (INDEPENDENT for each ticket)
function computeTicketStats(
  ticketNumbers: number[],
  drawnNumbers: number[],
  answersForThisTicket: Answer[],
  correctAnswersMap: Record<number, boolean>
): {
  drawnOnTicketCount: number;
  answeredOnTicket: number;
  correctOnTicket: number;
  incorrectOnTicket: number;
  missedOnTicket: number;
  accuracyPct: number;
} {
  // 1. Intersection: drawn numbers that are on this ticket
  const ticketNumbersSet = new Set(ticketNumbers.map(Number));
  const drawnOnTicket = drawnNumbers.filter(n => ticketNumbersSet.has(Number(n)));
  const drawnOnTicketCount = drawnOnTicket.length;

  if (drawnOnTicketCount === 0) {
    return {
      drawnOnTicketCount: 0,
      answeredOnTicket: 0,
      correctOnTicket: 0,
      incorrectOnTicket: 0,
      missedOnTicket: 0,
      accuracyPct: 0
    };
  }

  // 2. Build answers map for this ticket (KEY = question_number as Number)
  const answersMap = new Map<number, { answer: boolean | null; isCorrect: boolean }>();
  
  for (const ans of answersForThisTicket) {
    const qNum = Number(ans.question_number);
    if (!ticketNumbersSet.has(qNum)) continue; // Only questions on this ticket
    if (!drawnNumbers.includes(qNum)) continue; // Only drawn questions
    
    const correctAns = correctAnswersMap[qNum];
    const isCorrect = correctAns !== undefined && 
                      normalizeAnswer(ans.answer) === normalizeAnswer(correctAns);
    
    answersMap.set(qNum, { answer: ans.answer, isCorrect });
  }

  // 3. Count stats
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
  const accuracyPct = drawnOnTicketCount > 0 
    ? Math.round((correctOnTicket / drawnOnTicketCount) * 100)
    : 0;

  return {
    drawnOnTicketCount,
    answeredOnTicket,
    correctOnTicket,
    incorrectOnTicket,
    missedOnTicket,
    accuracyPct
  };
}

// Compute GLOBAL stats (across ALL tickets)
function computeGlobalStats(
  drawnNumbers: number[],
  allAnswers: Answer[],
  correctAnswersMap: Record<number, boolean>
): {
  totalDrawn: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  missedCount: number;
  accuracyPct: number;
} {
  const totalDrawn = drawnNumbers.length;

  if (totalDrawn === 0) {
    return {
      totalDrawn: 0,
      answeredCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      missedCount: 0,
      accuracyPct: 0
    };
  }

  // Build global answers map (KEY = question_number, deduplicated by latest answer)
  const answersMap = new Map<number, { answer: boolean | null; isCorrect: boolean }>();
  
  // Sort by created_at DESC to keep latest answer per question
  const sortedAnswers = [...allAnswers].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  for (const ans of sortedAnswers) {
    const qNum = Number(ans.question_number);
    if (!drawnNumbers.includes(qNum)) continue; // Only drawn questions
    if (answersMap.has(qNum)) continue; // Already have latest answer
    
    const correctAns = correctAnswersMap[qNum];
    const isCorrect = correctAns !== undefined && 
                      normalizeAnswer(ans.answer) === normalizeAnswer(correctAns);
    
    answersMap.set(qNum, { answer: ans.answer, isCorrect });
  }

  // Count stats
  let answeredCount = 0;
  let correctCount = 0;
  let incorrectCount = 0;

  for (const qNum of drawnNumbers) {
    const ans = answersMap.get(qNum);
    if (ans) {
      answeredCount++;
      if (ans.isCorrect) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    }
  }

  const missedCount = totalDrawn - answeredCount;
  const accuracyPct = totalDrawn > 0 
    ? Math.round((correctCount / totalDrawn) * 100)
    : 0;

  return {
    totalDrawn,
    answeredCount,
    correctCount,
    incorrectCount,
    missedCount,
    accuracyPct
  };
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
  
  // Stores correct answer for ALL drawn questions
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
          
          // Subscribe to real-time updates
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

  // Refetch event data
  const refetchEventData = async (eventId: string, loadedTickets: TicketData[]) => {
    try {
      const event = await eventService.getEventById(eventId);
      setActiveEvent({ ...event });
      setCurrentDrawnNumber(event.current_drawn_number);
      
      // Handle winner
      if (event.winner_ticket_id) {
        const winnerTicket = await ticketService.getTicket(event.winner_ticket_id);
        setWinnerSerial(winnerTicket?.serial_number || null);
      } else {
        setWinnerSerial(null);
      }

      // Create/Get session
      const session = await answerService.getOrCreateSession(eventId);
      setSessionId(session.id);

      // Load current question
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

      // Load ALL drawn questions correct answers
      try {
        const answersMap = await eventService.getDrawnQuestions(event.id);
        setCorrectAnswersMap(answersMap);
      } catch (err) {
        console.error("Failed to load drawn questions map:", err);
      }

      // Load answers for ALL tickets
      const allAnswers: Answer[] = [];
      for (const ticket of loadedTickets) {
        const ticketAnswers = await answerService.getAnswersForTicket(ticket.serial_number);
        allAnswers.push(...ticketAnswers);
      }
      setAnswers([...allAnswers]);
      
      console.log("[Player] ✅ Event data refetched");
    } catch (error) {
      console.error("[Player] Failed to refetch event data:", error);
    }
  };

  // Setup realtime subscription
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
            console.log("[Player] 🔔 Realtime update received");
            const updatedEvent = payload.new as Event;
            
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
                
                setCorrectAnswersMap(prev => ({
                  ...prev,
                  [updatedEvent.current_drawn_number!]: questionData.questions!.correct_answer
                }));

                const expiresAt = new Date(updatedEvent.question_open_until).getTime();
                const now = Date.now();
                const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
                setTimeLeft(remaining);
              }
            } else {
              setCurrentQuestion(null);
              setTimeLeft(0);
            }
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" && reconnectAttempts < maxReconnects) {
            reconnectAttempts++;
            setTimeout(() => {
              supabase.removeChannel(channel);
              subscribe();
            }, 1500);
          }
        });
    };

    subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  };

  // Fallback polling
  useEffect(() => {
    if (!activeEvent || activeEvent.status !== "active" || !tickets.length) return;

    const pollInterval = setInterval(async () => {
      try {
        const event = await eventService.getEventById(activeEvent.id);
        
        if (
          event.current_drawn_number !== currentDrawnNumber ||
          event.drawn_numbers?.length !== activeEvent.drawn_numbers?.length
        ) {
          await refetchEventData(activeEvent.id, tickets);
        }
      } catch (error) {
        console.error("[Player] Polling error:", error);
      }
    }, 1000);

    return () => clearInterval(pollInterval);
  }, [activeEvent?.id, activeEvent?.status, currentDrawnNumber, tickets.length]);

  // Resync on window focus
  useEffect(() => {
    if (!activeEvent || !tickets.length) return;

    const handleFocus = () => {
      refetchEventData(activeEvent.id, tickets);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
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

  // Handle answer submission
  const handleAnswer = async (answer: boolean) => {
    if (!focusedTicketId || !currentDrawnNumber || !currentQuestion || timeLeft <= 0 || submitting) return;

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

  // Compute GLOBAL stats
  const drawnNumbers = activeEvent?.drawn_numbers || [];
  const globalStats = computeGlobalStats(drawnNumbers, answers, correctAnswersMap);

  const focusedTicket = tickets.find(t => t.id === focusedTicketId);
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
                  <Badge variant="outline" className="text-xs sm:text-sm">
                    {tickets.length} / 4 tiketa
                  </Badge>
                </div>

                {/* GLOBAL STATS - 6 METRICS (2 rows x 3 cols) */}
                <div className="grid grid-cols-3 gap-2 text-center pt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Izvučeno</p>
                    <p className="text-lg font-bold">{globalStats.totalDrawn}/90</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Odgovoreno</p>
                    <p className="text-lg font-bold">{globalStats.answeredCount}/{globalStats.totalDrawn}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Propušteno</p>
                    <p className="text-lg font-bold">{globalStats.missedCount}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div>
                    <p className="text-xs text-muted-foreground">Točno</p>
                    <p className="text-lg font-bold text-green-600">{globalStats.correctCount}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Netočno</p>
                    <p className="text-lg font-bold text-red-600">{globalStats.incorrectCount}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs text-muted-foreground">Točnost</p>
                    <p className="text-lg font-bold">{globalStats.accuracyPct}%</p>
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* MULTI-TICKET GRID */}
          <div className={`grid gap-2 ${tickets.length === 1 ? "grid-cols-1" : tickets.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>
            {tickets.map((ticket) => {
              const isFocused = ticket.id === focusedTicketId;
              
              // COMPUTE STATS FOR THIS TICKET (INDEPENDENT)
              const ticketNumbers = ticket.ticket_questions.map(tq => Number(tq.question_number));
              const answersForThisTicket = answers.filter(a => a.ticket_id === ticket.serial_number);
              
              const ticketStats = computeTicketStats(
                ticketNumbers,
                drawnNumbers,
                answersForThisTicket,
                correctAnswersMap
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
                    
                    {/* PER-TICKET STATS */}
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
                    
                    {/* Current question status */}
                    {isOnThisTicket && currentDrawnNumber !== null && (
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
                          const qNum = Number(tq.question_number);
                          const isDrawn = drawnNumbers.includes(qNum);
                          const isCurrent = currentDrawnNumber === qNum;
                          
                          // Find answer for THIS ticket and THIS question
                          const answer = answersForThisTicket.find(a => Number(a.question_number) === qNum);
                          
                          let bgColor = "bg-gray-200 dark:bg-gray-700";
                          let textColor = "text-gray-900 dark:text-gray-100";
                          
                          if (isDrawn) {
                            if (answer) {
                              // Has answer - check if correct
                              const correctAns = correctAnswersMap[qNum];
                              const isCorrect = correctAns !== undefined && 
                                                normalizeAnswer(answer.answer) === normalizeAnswer(correctAns);
                              
                              if (isCorrect) {
                                bgColor = "bg-green-500";
                                textColor = "text-white";
                              } else {
                                bgColor = "bg-red-500";
                                textColor = "text-white";
                              }
                            } else {
                              // Missed (drawn but no answer)
                              bgColor = "bg-gray-400 dark:bg-gray-600";
                              textColor = "text-white";
                            }
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

            {/* Add ticket card */}
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
                        <p className="text-xl font-semibold text-muted-foreground">
                          Vrijeme za odgovor je isteklo
                        </p>
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