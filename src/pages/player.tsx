import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { eventService, Event } from "@/services/eventService";
import { answerService, PlayerSession, SessionStats, TicketDetailedResults } from "@/services/answerService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, X, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// Helper to normalize answers for local comparison (matches service logic)
function normalizeAnswer(value: any): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toUpperCase();
    if (["DA", "YES", "Y", "TRUE", "1"].includes(v)) return true;
    if (["NE", "NO", "N", "FALSE", "0"].includes(v)) return false;
  }
  return null;
}

interface TicketData {
  id: string;
  serial_number: string;
  event_id: string;
  is_winner: boolean;
  ticket_questions: Array<{ question_number: number }>;
}

// Interface for aggregated stats used in the UI
interface AggregatedStats {
  ticket_stats: Array<SessionStats & { ticket_serial: string }>;
  total_correct: number;
  total_answered: number;    // Sum of answered across all tickets
  drawn_in_game: number;     // Event-level: unique drawn questions (NOT per-ticket sum)
}

export default function PlayerScreen() {
  const [serialInput, setSerialInput] = useState("");
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [stats, setStats] = useState<AggregatedStats | null>(null);
  const [detailedResults, setDetailedResults] = useState<Map<string, TicketDetailedResults>>(new Map());
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [winnerSerial, setWinnerSerial] = useState<string | null>(null);
  const { toast } = useToast();

  // Load tickets from localStorage on mount
  useEffect(() => {
    const storedSerialsJSON = localStorage.getItem("ticket_serials");
    const storedEventId = localStorage.getItem("event_id");
    
    if (storedSerialsJSON && storedEventId) {
      try {
        const serials: string[] = JSON.parse(storedSerialsJSON);
        console.log("[Player] Restoring tickets from localStorage:", serials);
        
        eventService.getEvent(storedEventId).then(eventData => {
          setEvent(eventData);
          setDrawnNumbers(new Set(eventData.drawn_numbers || []));
          
          answerService.getOrCreateSession(storedEventId).then(sessionData => {
            setSession(sessionData);
            console.log("[Player] ✅ Session initialized:", sessionData.id);
          });
          
          Promise.all(
            serials.map(serial => 
              eventService.getTicketBySerial(serial).catch(err => {
                console.error(`Failed to load ticket ${serial}:`, err);
                return null;
              })
            )
          ).then(loadedTickets => {
            const validTickets = loadedTickets.filter(t => t !== null) as TicketData[];
            if (validTickets.length > 0) {
              setTickets(validTickets);
              setTicket(validTickets[0]);
              console.log("[Player] ✅ Restored tickets:", validTickets.map(t => t.serial_number));
            } else {
              localStorage.removeItem("ticket_serials");
              localStorage.removeItem("event_id");
            }
          });
        }).catch(err => {
          console.error("[Player] Failed to restore event:", err);
          localStorage.removeItem("ticket_serials");
          localStorage.removeItem("event_id");
        });
      } catch (err) {
        console.error("[Player] Failed to parse stored tickets:", err);
        localStorage.removeItem("ticket_serials");
      }
    }
  }, []);

  // CRITICAL: Load statistics ONLY when event is finished
  useEffect(() => {
    if (session && tickets.length > 0 && event?.status === "finished") {
      loadStats();
      loadDetailedResults();
    }
  }, [session?.id, tickets.length, event?.status]);

  // Real-time subscriptions
  useEffect(() => {
    if (!event) return;

    console.log("[Player] Setting up subscriptions for event:", event.id);

    const eventSubscription = eventService.subscribeToEvent(event.id, (payload) => {
      console.log("[Player] Event update:", payload);
      const updatedEvent = payload.new;
      setEvent(updatedEvent);
      setDrawnNumbers(new Set(updatedEvent.drawn_numbers || []));
      
      if (updatedEvent.current_question_number) {
        loadCurrentQuestion(updatedEvent.id, updatedEvent.current_question_number);
      }
      
      // CRITICAL: Load stats when event finishes
      if (updatedEvent.status === "finished" && session && tickets.length > 0) {
        loadStats();
        loadDetailedResults();
      }
    });

    const ticketsSubscription = eventService.subscribeToTickets(event.id, (payload) => {
      console.log("[Player] Ticket update:", payload);
      if (payload.new) {
        setTickets(prevTickets => 
          prevTickets.map(t => t.id === payload.new.id ? payload.new : t)
        );
        if (ticket && payload.new.id === ticket.id) {
          setTicket(payload.new);
        }
      }
    });

    // Subscribe to answers for stats updates (only when finished)
    const answersSubscription = session && event.status === "finished"
      ? answerService.subscribeToEventAnswers(event.id, () => {
          loadStats();
          loadDetailedResults();
        })
      : null;

    return () => {
      eventSubscription.unsubscribe();
      ticketsSubscription.unsubscribe();
      if (answersSubscription) answersSubscription.unsubscribe();
    };
  }, [event?.id, ticket?.id, session?.id, event?.status]);

  // Polling fallback
  useEffect(() => {
    if (!event || event.status !== "active") return;

    const pollInterval = setInterval(async () => {
      try {
        const updatedEvent = await eventService.getEvent(event.id);
        
        if (updatedEvent.current_drawn_number !== event.current_drawn_number) {
          console.log("[Player-Poll] Number changed:", updatedEvent.current_drawn_number);
          setEvent(updatedEvent);
          setDrawnNumbers(new Set(updatedEvent.drawn_numbers || []));
          
          if (updatedEvent.current_question_number) {
            await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_question_number);
          }
        }
        
        // Check if event finished
        if (updatedEvent.status === "finished" && event.status === "active") {
          setEvent(updatedEvent);
          if (session && tickets.length > 0) {
            await loadStats();
            await loadDetailedResults();
          }
        }
      } catch (error) {
        console.error("[Player-Poll] Error:", error);
      }
    }, 1500);

    return () => clearInterval(pollInterval);
  }, [event?.id, event?.status, event?.current_drawn_number, session?.id, tickets.length]);

  // Timer countdown with timeout handling
  useEffect(() => {
    if (!event?.question_open_until || !session || !currentQuestion) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const deadline = new Date(event.question_open_until).getTime();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
      setTimeRemaining(remaining);
      
      // TIMEOUT HANDLING: Mark as wrong if time expires and not answered
      if (remaining === 0 && !hasAnswered) {
        handleTimeout();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [event?.question_open_until, hasAnswered, session?.id, currentQuestion?.question_number]);

  const handleTimeout = async () => {
    if (!session || !currentQuestion || !event) return;
    
    console.log("[Player] ⏱️ TIMEOUT - marking question as missed:", {
      sessionId: session.id,
      eventId: event.id,
      questionNumber: currentQuestion.question_number,
      trackedTickets: tickets.map(t => t.serial_number)
    });
    
    try {
      // CRITICAL: Mark as missed for ALL tracked tickets
      for (const ticket of tickets) {
        await answerService.markUnansweredAsWrong(
          session.id,
          event.id,
          currentQuestion.question_number,
          ticket.serial_number // NEW: Pass exact ticket identifier
        );
      }
      setHasAnswered(true);
      console.log("[Player] ✅ Timeout recorded as MISSED for all tickets");
    } catch (error) {
      console.error("[Player] ❌ Failed to mark timeout:", error);
    }
  };

  const loadStats = async () => {
    if (!session || tickets.length === 0 || !event) return;
    
    try {
      // Fetch stats for each ticket individually
      const promises = tickets.map(async (t) => {
        const singleStats = await answerService.getSessionStats(
          session.id, 
          event.id,
          t.serial_number
        );
        return { ...singleStats, ticket_serial: t.serial_number };
      });

      const results = await Promise.all(promises);

      // Aggregate results
      const totalCorrect = results.reduce((sum, r) => sum + r.correct, 0);
      const totalAnswered = results.reduce((sum, r) => sum + r.answered, 0);
      
      // ✅ FIX: Use event-level drawn count, NOT per-ticket sum
      const drawnInGame = event.drawn_numbers?.length || 0;

      // 🔍 DEBUG LOGGING: Verify stats calculation
      console.log("═══════════════════════════════════════════");
      console.log("📊 [Player Stats Debug]");
      console.log("═══════════════════════════════════════════");
      console.log("Event ID:", event.id);
      console.log("Event Status:", event.status);
      console.log("Event drawn_numbers:", event.drawn_numbers);
      console.log("───────────────────────────────────────────");
      console.log("🎯 AGGREGATED STATS:");
      console.log("  • Total Correct:", totalCorrect);
      console.log("  • Total Answered:", totalAnswered);
      console.log("  • Drawn In Game:", drawnInGame, "← SOURCE OF TRUTH (event-level)");
      console.log("───────────────────────────────────────────");
      console.log("🎫 PER-TICKET BREAKDOWN:");
      results.forEach((r, idx) => {
        console.log(`  Ticket ${idx + 1} (${r.ticket_serial}):`);
        console.log(`    ✓ Correct: ${r.correct}`);
        console.log(`    📝 Answered: ${r.answered}`);
        console.log(`    🎲 Drawn on ticket: ${r.drawnOnTicket}`);
        console.log(`    📊 Accuracy: ${r.accuracy}%`);
      });
      console.log("═══════════════════════════════════════════");
      console.log("🎨 UI WILL DISPLAY:");
      console.log(`  Header: "Ukupno točno: ${totalCorrect} / ${drawnInGame}"`);
      console.log(`  Accuracy: "${Math.round((totalCorrect / drawnInGame) * 100)}%"`);
      console.log("═══════════════════════════════════════════");

      setStats({
        ticket_stats: results,
        total_correct: totalCorrect,
        total_answered: totalAnswered,
        drawn_in_game: drawnInGame,
      });
    } catch (error) {
      console.error("[Player] Failed to load stats:", error);
    }
  };

  const loadDetailedResults = async () => {
    if (!session || !event || tickets.length === 0) return;
    
    try {
      const resultsMap = new Map<string, TicketDetailedResults>();
      
      for (const ticket of tickets) {
        const details = await answerService.getTicketDetailedResults(
          session.id,
          ticket,
          event.id,
          event.drawn_numbers || []
        );
        resultsMap.set(ticket.serial_number, details);
      }
      
      setDetailedResults(resultsMap);
    } catch (error) {
      console.error("[Player] Failed to load detailed results:", error);
    }
  };

  const fetchWinnerSerial = async (ticketId: string) => {
    try {
      console.log("[Player] 🔍 Fetching winner serial for ticket:", ticketId);
      const { data, error } = await supabase
        .from('tickets')
        .select('serial_number')
        .eq('id', ticketId)
        .single();
      
      if (error) throw error;
      
      const serial = data?.serial_number;
      setWinnerSerial(serial || null);
      console.log("[Player] ✅ Winner serial loaded:", serial);
    } catch (error) {
      console.error("[Player] ❌ Failed to load winner serial:", error);
      setWinnerSerial(null);
    }
  };

  useEffect(() => {
    if (event?.winner_ticket_id) {
      console.log("[Player] 🏆 Winner detected, fetching serial...");
      fetchWinnerSerial(event.winner_ticket_id);
    } else {
      setWinnerSerial(null);
    }
  }, [event?.winner_ticket_id]);

  const toggleTicketDetails = (serial: string) => {
    setExpandedTickets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serial)) {
        newSet.delete(serial);
      } else {
        newSet.add(serial);
      }
      return newSet;
    });
  };

  const handleAddTicket = async () => {
    if (!serialInput.trim()) {
      toast({
        title: "Error",
        description: "Please enter a ticket serial number",
        variant: "destructive"
      });
      return;
    }

    if (tickets.some(t => t.serial_number === serialInput)) {
      toast({
        title: "Duplicate",
        description: "This ticket is already added.",
        variant: "destructive"
      });
      return;
    }

    if (tickets.length >= 4) {
      toast({
        title: "Limit Reached",
        description: "Maximum 4 tickets per player.",
        variant: "destructive"
      });
      return;
    }

    try {
      const ticketData = await eventService.getTicketBySerial(serialInput);
      
      if (event && ticketData.event_id !== event.id) {
        toast({
          title: "Error",
          description: "This ticket belongs to a different event.",
          variant: "destructive"
        });
        return;
      }

      if (!event) {
        const eventData = await eventService.getEvent(ticketData.event_id);
        setEvent(eventData);
        setDrawnNumbers(new Set(eventData.drawn_numbers || []));
        
        const sessionData = await answerService.getOrCreateSession(eventData.id);
        setSession(sessionData);
        
        if (eventData.current_question_number) {
          await loadCurrentQuestion(eventData.id, eventData.current_question_number);
        }
        
        localStorage.setItem("event_id", eventData.id);
      }

      const newTickets = [...tickets, ticketData];
      setTickets(newTickets);
      
      if (!ticket) {
        setTicket(ticketData);
      }

      const serials = newTickets.map(t => t.serial_number);
      localStorage.setItem("ticket_serials", JSON.stringify(serials));

      setSerialInput("");
      
      toast({
        title: "Success",
        description: "Ticket added successfully!",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Ticket not found or invalid",
        variant: "destructive"
      });
    }
  };

  const handleClearTickets = () => {
    setTickets([]);
    setTicket(null);
    setEvent(null);
    setSession(null);
    setStats(null);
    setDetailedResults(new Map());
    localStorage.removeItem("ticket_serials");
    localStorage.removeItem("ticket_serial");
    localStorage.removeItem("event_id");
    window.location.reload();
  };

  const handleRemoveTicket = (ticketId: string) => {
    const newTickets = tickets.filter(t => t.id !== ticketId);
    setTickets(newTickets);
    
    if (newTickets.length === 0) {
      handleClearTickets();
      return;
    }

    if (ticket?.id === ticketId) {
      setTicket(newTickets[0]);
    }

    const serials = newTickets.map(t => t.serial_number);
    localStorage.setItem("ticket_serials", JSON.stringify(serials));

    toast({
      title: "Ticket Removed",
      description: "Ticket removed from your list",
    });
  };

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      setCurrentQuestion(data);
      
      if (session) {
        const answers = await answerService.getSessionAnswers(session.id);
        const alreadyAnswered = answers.some(a => a.question_number === questionNumber);
        setHasAnswered(alreadyAnswered);
        
        if (alreadyAnswered) {
          const existingAnswer = answers.find(a => a.question_number === questionNumber);
          setAnswer(existingAnswer?.answer_yesno === "YES");
        } else {
          setAnswer(null);
        }
      } else {
        setHasAnswered(false);
        setAnswer(null);
      }
    } catch (error) {
      console.error("[Player] Failed to load question:", error);
      setCurrentQuestion(null);
    }
  };

  const handleSubmitAnswer = async (answerValue: boolean) => {
    if (!session || !currentQuestion || hasAnswered || !event) return;

    console.log("[Player] Submitting answer:", {
      sessionId: session.id,
      eventId: event.id,
      questionNumber: currentQuestion.question_number,
      answer: answerValue ? "DA" : "NE",
      trackedTickets: tickets.map(t => ({ id: t.id, serial: t.serial_number }))
    });

    setAnswer(answerValue);

    try {
      // Calculate correctness locally using normalization
      // NOTE: Service now recalculates this securely, but we keep local for UI feedback if needed
      // Actually, we should just let service do it.
      
      // CRITICAL: Submit answer for ALL tracked tickets
      for (const ticket of tickets) {
        await answerService.submitAnswer(
          session.id,
          event.id,
          currentQuestion.question_number,
          answerValue, // Pass boolean directly
          ticket.serial_number // Pass exact ticket identifier
        );
      }
      
      setHasAnswered(true);
      
      console.log("[Player] ✅ Answer submitted successfully for all tickets");
      
      toast({
        title: "Odgovor poslan",
        description: `Odgovorili ste: ${answerValue ? "DA" : "NE"}`,
      });
    } catch (error: any) {
      setAnswer(null);
      console.error("[Player] ❌ Answer submission failed:", error);
      toast({
        title: "Greška",
        description: error.message || "Vec si odgovorio na ovo pitanje",
        variant: "destructive"
      });
    }
  };

  const renderTicketGrid = (ticketData: TicketData) => {
    const numbers = ticketData.ticket_questions
      .map(tq => tq.question_number)
      .sort((a, b) => a - b);

    const drawnCount = numbers.filter(num => drawnNumbers.has(num)).length;
    
    // CRITICAL: Only show stats if event is finished
    const ticketStats = event?.status === "finished" 
      ? stats?.ticket_stats.find(ts => ts.ticket_serial === ticketData.serial_number)
      : null;

    const details = detailedResults.get(ticketData.serial_number);
    const isExpanded = expandedTickets.has(ticketData.serial_number);

    return (
      <Card key={ticketData.id} className="relative bg-white/95 backdrop-blur-sm">
        <button
          onClick={() => handleRemoveTicket(ticketData.id)}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 z-10"
        >
          <X className="w-4 h-4" />
        </button>

        <CardContent className="p-4">
          <div className="text-center mb-3">
            <Badge className="bg-purple-600 text-white mb-1">
              {ticketData.serial_number}
            </Badge>
            {ticketData.is_winner && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <Trophy className="w-6 h-6 text-yellow-500" />
                <span className="text-xl font-black text-yellow-600">WINNER!</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {numbers.map((num) => {
              const isDrawn = drawnNumbers.has(num);
              return (
                <div
                  key={num}
                  className={`aspect-square flex items-center justify-center rounded-lg font-bold text-lg transition-all ${
                    isDrawn
                      ? "bg-green-500 text-white scale-105 shadow-lg"
                      : "bg-purple-100 text-purple-900"
                  }`}
                >
                  {num}
                </div>
              );
            })}
          </div>

          <div className="text-center mt-3 space-y-1">
            <div className="text-sm font-semibold text-gray-600">
              {drawnCount} / 15 izvučeno
            </div>
            {/* CRITICAL: Only show stats when game is finished */}
            {event?.status === "finished" && ticketStats && (
              <>
                <div className="text-center mb-2 space-y-1">
                  <div className="text-lg font-bold text-blue-600">
                    ✓ {ticketStats.correct} / {ticketStats.drawnOnTicket} točno ({ticketStats.accuracy}%)
                  </div>
                  <div className="text-sm text-gray-600">
                    Izvučeno na ovoj ulaznici: {ticketStats.drawnOnTicket}
                  </div>
                  <div className="text-xs text-gray-500">
                    Odgovoreno: {ticketStats.answered} / {ticketStats.drawnOnTicket}
                  </div>
                  {ticketStats.missed > 0 && (
                    <div className="text-xs text-red-600">
                      Propušteno: {ticketStats.missed}
                    </div>
                  )}
                </div>
                {details && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleTicketDetails(ticketData.serial_number)}
                    className="w-full mt-2"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-4 h-4 mr-2" />
                        Sakrij detalje
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 mr-2" />
                        Prikaži detalje
                      </>
                    )}
                  </Button>
                )}
              </>
            )}
          </div>

          {/* CRITICAL: Detailed Results - Only when finished and expanded */}
          {isExpanded && details && event?.status === "finished" && (
            <div className="mt-4 space-y-2 border-t pt-4">
              <h4 className="font-bold text-sm text-gray-700 mb-3">Detalji po pitanjima:</h4>
              {details.questions.map((q) => (
                <div
                  key={q.question_number}
                  className={`p-3 rounded-lg border-2 ${
                    q.result === "Točno"
                      ? "bg-green-50 border-green-300"
                      : "bg-red-50 border-red-300"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {q.result === "Točno" ? (
                      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs text-gray-600 mb-1">
                        Pitanje #{q.question_number}
                      </div>
                      <div className="text-sm text-gray-800 mb-2 line-clamp-2">
                        {q.question_text}
                      </div>
                      <div className="flex gap-3 text-xs">
                        <span className="font-semibold">
                          Točan odgovor: <span className="text-blue-600">{q.correct_answer}</span>
                        </span>
                        <span className="font-semibold">
                          Vaš odgovor: <span className={q.player_answer === "Nije odgovoreno" ? "text-gray-500" : "text-purple-600"}>
                            {q.player_answer}
                          </span>
                        </span>
                      </div>
                      <div className={`text-xs font-bold mt-1 ${
                        q.result === "Točno" ? "text-green-600" : 
                        q.result === "Propušteno" ? "text-orange-600" : "text-red-600"
                      }`}>
                        {q.result}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const getFinalMessage = () => {
    if (!stats || stats.ticket_stats.length === 0) return "";
    
    const bestScore = Math.max(...stats.ticket_stats.map(ts => ts.correct));
    
    if (bestScore === 15) return "🎉 Čestitamo! Sve točno!";
    if (bestScore >= 13) return "🌟 Odličan rezultat!";
    return "👍 Hvala na sudjelovanju!";
  };

  // Join screen
  if (tickets.length === 0) {
    return (
      <>
        <SEO title="Join Game - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-500 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 space-y-4">
              <div className="text-center mb-6">
                <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600 mb-2">
                  PRIDRUŽI SE IGRI
                </h1>
                <p className="text-gray-600">Unesi serijski broj ulaznice</p>
              </div>

              <Input
                placeholder="Unesi serijski broj"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTicket()}
                className="text-lg"
              />

              <Button onClick={handleAddTicket} className="w-full" size="lg">
                Pridruži se igri
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // Multi-ticket display
  return (
    <>
      <SEO title="Player - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-4">
        <div className="container mx-auto max-w-4xl">
          <div className="mb-6">
            <h1 className="text-4xl font-black text-white mb-2">PITALICA SKITALICA</h1>
            <p className="text-white/80">Odgovori na pitanja i osvoji nagradu!</p>
          </div>

          {/* WINNER BANNER */}
          {event?.winner_ticket_id && (
            <Card className="mb-4 border-4 border-yellow-500 bg-yellow-50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-center gap-3">
                  <Trophy className="w-8 h-8 text-yellow-600" />
                  <div className="text-center">
                    <p className="text-2xl font-black text-yellow-600">IMAMO POBJEDNIKA!</p>
                    <p className="text-sm text-yellow-700 mt-1">Serijski broj ulaznice:</p>
                    <p className="text-lg font-bold text-yellow-800">
                      {winnerSerial || "..."}
                    </p>
                  </div>
                  <Trophy className="w-8 h-8 text-yellow-600" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Header */}
          <div className="mb-4 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="Dodaj još jednu ulaznicu"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTicket()}
                disabled={tickets.length >= 4 || event?.status === "finished"}
                className="flex-1"
              />
              <Button
                onClick={handleAddTicket}
                disabled={tickets.length >= 4 || event?.status === "finished"}
                className="whitespace-nowrap"
              >
                Dodaj ({tickets.length}/4)
              </Button>
            </div>
            <Button
              onClick={handleClearTickets}
              variant="destructive"
              className="w-full"
              size="sm"
            >
              Obriši sve
            </Button>
          </div>

          {/* CRITICAL: Final Statistics - ONLY when event is finished */}
          {event?.status === "finished" && stats && (
            <Card className="bg-white/95 backdrop-blur-sm mb-4">
              <CardContent className="p-6 text-center space-y-3">
                <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">
                  Hvala na sudjelovanju!
                </h2>
                
                {/* ✅ FIX: Use drawn_in_game as denominator (SOURCE OF TRUTH) */}
                <div className="text-2xl font-bold text-gray-700">
                  Ukupno točno: {stats.total_correct} / {stats.drawn_in_game}
                </div>
                
                {/* ✅ FIX: Accuracy based on drawnInGame, not answered */}
                {stats.drawn_in_game > 0 && (
                  <div className="text-lg text-gray-600">
                    Točnost: {Math.round((stats.total_correct / stats.drawn_in_game) * 100)}%
                  </div>
                )}
                
                <div className="text-sm text-gray-500 mt-2">
                  Izvučeno u igri: {stats.drawn_in_game} / 90 pitanja
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tickets Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {tickets.map(ticketData => renderTicketGrid(ticketData))}
          </div>

          {/* Current Question - ONLY during active game */}
          {event?.status === "active" && currentQuestion && (
            <Card className="bg-white/95 backdrop-blur-sm">
              <CardContent className="p-6 space-y-4">
                <div className="text-center">
                  <Badge className="bg-blue-600 text-white text-lg px-4 py-1 mb-3">
                    Pitanje #{currentQuestion.question_number}
                  </Badge>
                  <h2 className="text-2xl font-bold mb-4">
                    {currentQuestion.questions?.text}
                  </h2>
                </div>

                {timeRemaining > 0 ? (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="h-4 flex-1 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-green-500 to-green-300 transition-all duration-100"
                          style={{ width: `${(timeRemaining / 10) * 100}%` }}
                        />
                      </div>
                      <span className="text-2xl font-black font-mono text-green-600 min-w-[2ch]">
                        {timeRemaining}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Button
                        onClick={() => handleSubmitAnswer(true)}
                        disabled={hasAnswered}
                        className="h-20 text-2xl font-black bg-green-600 hover:bg-green-700"
                      >
                        DA
                      </Button>
                      <Button
                        onClick={() => handleSubmitAnswer(false)}
                        disabled={hasAnswered}
                        className="h-20 text-2xl font-black bg-red-600 hover:bg-red-700"
                      >
                        NE
                      </Button>
                    </div>

                    {hasAnswered && (
                      <div className="text-center text-lg font-semibold text-green-600">
                        Odgovoreno: {answer ? "DA" : "NE"}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-gray-100 rounded-lg p-4 text-center">
                    <p className="text-lg font-semibold text-gray-600">Vrijeme je isteklo!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Waiting state */}
          {event?.status === "active" && !currentQuestion && (
            <Card className="bg-white/95 backdrop-blur-sm">
              <CardContent className="p-6 text-center">
                <p className="text-xl font-semibold text-gray-600">
                  Čekamo sljedeće pitanje...
                </p>
              </CardContent>
            </Card>
          )}

          {/* Event not active */}
          {event?.status !== "active" && event?.status !== "finished" && (
            <Card className="bg-white/95 backdrop-blur-sm">
              <CardContent className="p-6 text-center">
                <p className="text-xl font-semibold text-gray-600">
                  Igra još nije počela
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}