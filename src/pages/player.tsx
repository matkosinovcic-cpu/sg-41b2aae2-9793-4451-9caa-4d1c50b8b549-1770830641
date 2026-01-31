import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import { answerService } from "@/services/answerService";
import { ticketService } from "@/services/ticketService";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, Trophy, Ticket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { calculateSingleTicketStats } from "@/lib/statsHelper";

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

  // Game state
  const [currentDrawnNumber, setCurrentDrawnNumber] = useState<number | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<{ id: string; text: string; correct_answer: boolean } | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [winnerSerial, setWinnerSerial] = useState<string | null>(null);

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
          eventId = ticket.event_id;
          
          // Also load other stored tickets for this event
          const storedTickets = getStoredFreeTickets(eventId);
          ticketsToLoad = [...new Set([ticketSerial, ...storedTickets])];
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
        const loadedTickets = await Promise.all(ticketPromises);
        setTickets(loadedTickets);

        // Set focused ticket (newly created or first one)
        if (ticketSerial) {
          const focused = loadedTickets.find(t => t.serial_number === ticketSerial);
          setFocusedTicketId(focused?.id || loadedTickets[0]?.id || null);
        } else {
          setFocusedTicketId(loadedTickets[0]?.id || null);
        }

        // Load event
        if (eventId || loadedTickets[0]?.event_id) {
          const event = await eventService.getEventById(eventId || loadedTickets[0].event_id);
          setActiveEvent(event);
          setCurrentDrawnNumber(event.current_drawn_number);
          setWinnerSerial(event.winner_serial_number || null);

          // Load current question if exists
          if (event.current_drawn_number) {
            const questionData = await eventService.getQuestionForNumber(event.id, event.current_drawn_number);
            if (questionData) {
              setCurrentQuestion(questionData);
              const expiresAt = event.question_open_until ? new Date(event.question_open_until).getTime() : 0;
              const now = Date.now();
              const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
              setTimeLeft(remaining);
            }
          }

          // Load answers for all tickets
          const allAnswers: Answer[] = [];
          for (const ticket of loadedTickets) {
            const ticketAnswers = await answerService.getAnswersForTicket(ticket.id);
            allAnswers.push(...ticketAnswers);
          }
          setAnswers(allAnswers);

          // Subscribe to real-time updates
          subscribeToEvent(event.id);
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

  // Real-time subscription
  const subscribeToEvent = (eventId: string) => {
    const channel = supabase
      .channel(`event_${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `id=eq.${eventId}` }, async (payload) => {
        const updatedEvent = payload.new as Event;
        setActiveEvent(updatedEvent);
        setCurrentDrawnNumber(updatedEvent.current_drawn_number);
        setWinnerSerial(updatedEvent.winner_serial_number || null);

        if (updatedEvent.current_drawn_number && updatedEvent.question_open_until) {
          const questionData = await eventService.getQuestionForNumber(eventId, updatedEvent.current_drawn_number);
          if (questionData) {
            setCurrentQuestion(questionData);
            const expiresAt = new Date(updatedEvent.question_open_until).getTime();
            const now = Date.now();
            const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
            setTimeLeft(remaining);
          }
        } else {
          setCurrentQuestion(null);
          setTimeLeft(0);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

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

    // Check if this question is on the focused ticket
    const hasQuestion = focusedTicket.ticket_questions.some(tq => tq.question_number === currentDrawnNumber);
    if (!hasQuestion) {
      toast({
        title: "Pitanje nije na tvom tiketu",
        description: `Broj ${currentDrawnNumber} nije na tvom tiketu.`,
        variant: "destructive"
      });
      return;
    }

    // Check if already answered
    const existingAnswer = answers.find(a => a.ticket_id === focusedTicketId && a.question_number === currentDrawnNumber);
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
      await answerService.submitAnswer(focusedTicketId, currentDrawnNumber, answer);
      
      const newAnswer: Answer = {
        ticket_id: focusedTicketId,
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
  const focusedStats = focusedTicket && activeEvent
    ? calculateSingleTicketStats(focusedTicket, answers, activeEvent.drawn_numbers || [])
    : { totalQuestions: 15, drawnInGame: 0, drawnOnTicket: 0, answered: 0, correct: 0, accuracy: 0 };

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
                <div className="grid grid-cols-3 gap-2 text-center pt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Izvučeno</p>
                    <p className="text-lg sm:text-xl font-bold">{focusedStats.drawnOnTicket}/{focusedStats.totalQuestions}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Odgovoreno</p>
                    <p className="text-lg sm:text-xl font-bold">{focusedStats.answered}/{focusedStats.drawnOnTicket}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Točnost</p>
                    <p className="text-lg sm:text-xl font-bold">{focusedStats.accuracy}%</p>
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* Multi-ticket grid */}
          <div className={`grid gap-2 ${tickets.length === 1 ? "grid-cols-1" : tickets.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>
            {tickets.map(ticket => {
              const isFocused = ticket.id === focusedTicketId;
              const ticketAnswers = answers.filter(a => a.ticket_id === ticket.id);
              const stats = activeEvent ? calculateSingleTicketStats(ticket, ticketAnswers, activeEvent.drawn_numbers || []) : null;

              return (
                <Card
                  key={ticket.id}
                  className={`cursor-pointer transition-all ${isFocused ? "ring-4 ring-purple-500 bg-white" : "bg-white/80 hover:bg-white/90"}`}
                  onClick={() => setFocusedTicketId(ticket.id)}
                >
                  <CardHeader className="p-3 sm:p-4">
                    <CardTitle className="text-sm sm:text-base truncate">{ticket.serial_number}</CardTitle>
                    {stats && (
                      <div className="text-xs text-muted-foreground">
                        {stats.drawnOnTicket}/{stats.totalQuestions} izvučeno • {stats.accuracy}% točno
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="p-3 sm:p-4 pt-0">
                    <div className="grid grid-cols-5 gap-1">
                      {ticket.ticket_questions
                        .sort((a, b) => a.question_number - b.question_number)
                        .map(tq => {
                          const isDrawn = activeEvent?.drawn_numbers?.includes(tq.question_number);
                          const isCurrent = currentDrawnNumber === tq.question_number;
                          const answer = ticketAnswers.find(a => a.question_number === tq.question_number);
                          const hasAnswer = !!answer;
                          const isCorrect = hasAnswer && currentQuestion && normalizeAnswer(answer.answer) === normalizeAnswer(currentQuestion.correct_answer);

                          return (
                            <div
                              key={tq.question_number}
                              className={`aspect-square flex items-center justify-center text-xs sm:text-sm font-bold rounded ${
                                isCurrent
                                  ? "bg-yellow-400 text-black animate-pulse"
                                  : hasAnswer
                                  ? isCorrect
                                    ? "bg-green-500 text-white"
                                    : "bg-red-500 text-white"
                                  : isDrawn
                                  ? "bg-gray-300 text-gray-700"
                                  : "bg-white border-2 border-gray-200"
                              }`}
                            >
                              {tq.question_number}
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
                  const hasQuestion = focusedTicket.ticket_questions.some(tq => tq.question_number === currentDrawnNumber);
                  const existingAnswer = answers.find(a => a.ticket_id === focusedTicketId && a.question_number === currentDrawnNumber);

                  if (!hasQuestion) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        <XCircle className="h-12 w-12 mx-auto mb-2" />
                        <p>Ovo pitanje nije na tvom tiketu</p>
                      </div>
                    );
                  }

                  if (existingAnswer) {
                    const isCorrect = normalizeAnswer(existingAnswer.answer) === normalizeAnswer(currentQuestion.correct_answer);
                    return (
                      <div className="text-center py-8">
                        {isCorrect ? (
                          <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
                        ) : (
                          <XCircle className="h-16 w-16 mx-auto mb-4 text-red-500" />
                        )}
                        <p className="text-xl font-bold">{isCorrect ? "Točan odgovor!" : "Netočan odgovor"}</p>
                        <p className="text-muted-foreground mt-2">
                          Tvoj odgovor: {normalizeAnswer(existingAnswer.answer) ? "DA" : "NE"}
                        </p>
                      </div>
                    );
                  }

                  if (timeLeft <= 0) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        <Clock className="h-12 w-12 mx-auto mb-2" />
                        <p>Vrijeme je isteklo</p>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-2 gap-4">
                      <Button
                        onClick={() => handleAnswer(true)}
                        disabled={submitting}
                        size="lg"
                        className="h-24 text-2xl font-bold bg-green-600 hover:bg-green-700"
                      >
                        {submitting ? <Loader2 className="animate-spin" /> : "DA"}
                      </Button>
                      <Button
                        onClick={() => handleAnswer(false)}
                        disabled={submitting}
                        size="lg"
                        className="h-24 text-2xl font-bold bg-red-600 hover:bg-red-700"
                      >
                        {submitting ? <Loader2 className="animate-spin" /> : "NE"}
                      </Button>
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