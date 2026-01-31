import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import { answerService, PlayerSession, SessionStats, TicketDetailedResults } from "@/services/answerService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, X, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// Helper to normalize answers
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

interface AggregatedStats {
  ticket_stats: Array<SessionStats & { ticket_serial: string }>;
  total_correct: number;
  total_answered: number;
  drawn_in_game: number;
}

export default function PlayerScreen() {
  const router = useRouter();
  const eventId = router.query.eventId as string;
  
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

  // Fetch initial event state
  useEffect(() => {
    if (!eventId) return;
    
    const fetchEvent = async () => {
      try {
        console.log("[Player] 📥 Fetching initial event state for:", eventId.slice(0, 8));
        const eventData = await eventService.getEvent(eventId);
        
        setEvent(eventData);
        setDrawnNumbers(new Set(eventData.drawn_numbers || []));
        
        // Create session
        const sessionData = await answerService.getOrCreateSession(eventData.id);
        setSession(sessionData);
        
        if (eventData.current_question_number) {
          await loadCurrentQuestion(eventData.id, eventData.current_question_number);
        }
        
        console.log("[Player] ✅ Initial state loaded:", {
          currentNumber: eventData.current_question_number,
          status: eventData.status
        });
      } catch (error) {
        console.error("[Player] ❌ Failed to fetch initial event:", error);
      }
    };
    
    fetchEvent();
  }, [eventId]);

  // Realtime subscription
  useEffect(() => {
    if (!eventId) return;
    
    console.log("[Player] 📡 Setting up realtime subscription for event:", eventId.slice(0, 8));
    
    const channel = supabase
      .channel(`player-event-${eventId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'events',
        filter: `id=eq.${eventId}`
      }, async (payload) => {
        console.log("[Player] ⚡ Realtime UPDATE received:", payload);
        
        const newEvent = payload.new as Event;
        
        // Update drawn numbers
        setDrawnNumbers(new Set(newEvent.drawn_numbers || []));
        
        // Load current question if changed
        if (newEvent.current_question_number && 
            newEvent.current_question_number !== currentQuestion?.question_number) {
          await loadCurrentQuestion(newEvent.id, newEvent.current_question_number);
        }
        
        // Update event state
        setEvent(newEvent);
        
        // Load stats when finished
        if (newEvent.status === "finished" && session && tickets.length > 0) {
          loadStats();
          loadDetailedResults();
        }
        
        console.log("[Player] ✅ State updated:", {
          currentNumber: newEvent.current_question_number,
          status: newEvent.status
        });
      })
      .subscribe((status) => {
        console.log("[Player] 📡 Subscription status:", status);
      });
    
    return () => {
      console.log("[Player] 🧹 Cleaning up realtime subscription");
      channel.unsubscribe();
    };
  }, [eventId, currentQuestion, session, tickets]);

  // Load stats when event finishes
  useEffect(() => {
    if (session && tickets.length > 0 && event?.status === "finished") {
      loadStats();
      loadDetailedResults();
    }
  }, [session?.id, tickets.length, event?.status]);

  // Timer countdown
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
      
      if (remaining === 0 && !hasAnswered) {
        handleTimeout();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [event?.question_open_until, hasAnswered, session?.id, currentQuestion?.question_number]);

  const handleTimeout = async () => {
    if (!session || !currentQuestion || !event) return;
    
    console.log("[Player] ⏱️ TIMEOUT - marking question as missed");
    
    try {
      for (const ticket of tickets) {
        await answerService.markUnansweredAsWrong(
          session.id,
          event.id,
          currentQuestion.question_number,
          ticket.serial_number
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
      const promises = tickets.map(async (t) => {
        const singleStats = await answerService.getSessionStats(
          session.id, 
          event.id,
          t.serial_number
        );
        return { ...singleStats, ticket_serial: t.serial_number };
      });

      const results = await Promise.all(promises);
      const totalCorrect = results.reduce((sum, r) => sum + r.correct, 0);
      const totalAnswered = results.reduce((sum, r) => sum + r.answered, 0);
      const drawnInGame = event.drawn_numbers?.length || 0;

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
      const { data, error } = await supabase
        .from('tickets')
        .select('serial_number')
        .eq('id', ticketId)
        .single();
      
      if (error) throw error;
      setWinnerSerial(data?.serial_number || null);
    } catch (error) {
      console.error("[Player] Failed to load winner serial:", error);
      setWinnerSerial(null);
    }
  };

  useEffect(() => {
    if (event?.winner_ticket_id) {
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

      if (!event && eventId && ticketData.event_id !== eventId) {
        toast({
          title: "Error",
          description: "This ticket does not belong to this event.",
          variant: "destructive"
        });
        return;
      }

      const newTickets = [...tickets, ticketData];
      setTickets(newTickets);
      
      if (!ticket) {
        setTicket(ticketData);
      }

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

    console.log("[Player] Submitting answer:", answerValue ? "DA" : "NE");

    setAnswer(answerValue);

    try {
      for (const ticket of tickets) {
        await answerService.submitAnswer(
          session.id,
          event.id,
          currentQuestion.question_number,
          answerValue,
          ticket.serial_number
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

  // No eventId
  if (!eventId) {
    return (
      <>
        <SEO title="Player - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-500 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center">
              <div className="text-6xl mb-4">⚠️</div>
              <h1 className="text-2xl font-bold mb-2">Missing Event ID</h1>
              <p className="text-gray-600 mb-4">
                Please provide an event ID in the URL:
              </p>
              <code className="bg-gray-100 px-3 py-2 rounded text-sm">
                /player?eventId=YOUR_EVENT_ID
              </code>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

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

          {event?.status === "finished" && stats && (
            <Card className="bg-white/95 backdrop-blur-sm mb-4">
              <CardContent className="p-6 text-center space-y-3">
                <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">
                  Hvala na sudjelovanju!
                </h2>
                
                <div className="text-2xl font-bold text-gray-700">
                  Ukupno točno: {stats.total_correct} / {stats.drawn_in_game}
                </div>
                
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {tickets.map(ticketData => renderTicketGrid(ticketData))}
          </div>

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

          {event?.status === "active" && !currentQuestion && (
            <Card className="bg-white/95 backdrop-blur-sm">
              <CardContent className="p-6 text-center">
                <p className="text-xl font-semibold text-gray-600">
                  Čekamo sljedeće pitanje...
                </p>
              </CardContent>
            </Card>
          )}

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