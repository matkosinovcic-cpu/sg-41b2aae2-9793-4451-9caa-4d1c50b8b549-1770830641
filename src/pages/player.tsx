import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { eventService, Event } from "@/services/eventService";
import { answerService, PlayerSession, SessionStats } from "@/services/answerService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, X, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TicketData {
  id: string;
  serial_number: string;
  event_id: string;
  is_winner: boolean;
  ticket_questions: Array<{ question_number: number }>;
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
  const [stats, setStats] = useState<SessionStats | null>(null);
  const { toast } = useToast();

  // Load tickets from localStorage on mount
  useEffect(() => {
    const storedSerialsJSON = localStorage.getItem("ticket_serials");
    const storedEventId = localStorage.getItem("event_id");
    
    if (storedSerialsJSON && storedEventId) {
      try {
        const serials: string[] = JSON.parse(storedSerialsJSON);
        console.log("[Player] Restoring tickets from localStorage:", serials);
        
        // Load event first
        eventService.getEvent(storedEventId).then(eventData => {
          setEvent(eventData);
          setDrawnNumbers(new Set(eventData.drawn_numbers || []));
          
          // Initialize session
          answerService.getOrCreateSession(storedEventId).then(sessionData => {
            setSession(sessionData);
          });
          
          // Load all tickets
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
              console.log("[Player] Restored tickets:", validTickets.length);
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

  // Load statistics when session and tickets are ready
  useEffect(() => {
    if (session && tickets.length > 0) {
      loadStats();
    }
  }, [session?.id, tickets.length]);

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

    // Subscribe to answers for real-time stats updates
    const answersSubscription = session 
      ? answerService.subscribeToEventAnswers(event.id, () => {
          loadStats();
        })
      : null;

    return () => {
      eventSubscription.unsubscribe();
      ticketsSubscription.unsubscribe();
      if (answersSubscription) answersSubscription.unsubscribe();
    };
  }, [event?.id, ticket?.id, session?.id]);

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
      } catch (error) {
        console.error("[Player-Poll] Error:", error);
      }
    }, 1500);

    return () => clearInterval(pollInterval);
  }, [event?.id, event?.status, event?.current_drawn_number]);

  // Timer countdown
  useEffect(() => {
    if (!event?.question_open_until) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const deadline = new Date(event.question_open_until).getTime();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
      setTimeRemaining(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [event?.question_open_until]);

  const loadStats = async () => {
    if (!session || tickets.length === 0) return;
    
    try {
      const statsData = await answerService.getSessionStats(session.id, tickets);
      setStats(statsData);
    } catch (error) {
      console.error("[Player] Failed to load stats:", error);
    }
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
        
        // Initialize session
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
      
      // Reload stats with new ticket
      if (session) {
        await loadStats();
      }
      
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

    // Reload stats
    if (session) {
      loadStats();
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
      
      // Check if already answered
      if (session) {
        const answers = await answerService.getSessionAnswers(session.id);
        const alreadyAnswered = answers.some(a => a.question_number === questionNumber);
        setHasAnswered(alreadyAnswered);
        
        if (alreadyAnswered) {
          const existingAnswer = answers.find(a => a.question_number === questionNumber);
          setAnswer(existingAnswer?.answer === "YES");
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

    setAnswer(answerValue);

    try {
      const correctAnswer = currentQuestion.questions?.correct_answer;
      const answerYesNo = answerValue ? "YES" : "NO";
      
      await answerService.submitAnswer(
        session.id,
        event.id,
        currentQuestion.question_number,
        answerYesNo,
        correctAnswer
      );
      
      setHasAnswered(true);
      
      // Reload stats immediately
      await loadStats();
      
      toast({
        title: "Odgovor poslan",
        description: `Odgovorili ste: ${answerValue ? "DA" : "NE"}`,
      });
    } catch (error: any) {
      setAnswer(null);
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
    
    // Find stats for this ticket
    const ticketStats = stats?.ticket_stats.find(ts => ts.ticket_serial === ticketData.serial_number);

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
            {ticketStats && (
              <div className="text-xs font-semibold text-blue-600">
                ✓ {ticketStats.correct} / {ticketStats.answered} točno
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
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
      <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-500 p-4">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <div className="mb-4 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="Dodaj još jednu ulaznicu"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTicket()}
                disabled={tickets.length >= 4}
                className="flex-1"
              />
              <Button
                onClick={handleAddTicket}
                disabled={tickets.length >= 4}
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

          {/* Overall Statistics */}
          {stats && (
            <Card className="bg-white/95 backdrop-blur-sm mb-4">
              <CardContent className="p-4">
                <h3 className="text-lg font-bold text-center mb-2">Moja statistika</h3>
                <div className="flex items-center justify-center gap-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <span className="text-2xl font-black text-green-600">
                      {stats.total_correct}
                    </span>
                  </div>
                  <span className="text-2xl font-bold text-gray-400">/</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-gray-600">
                      {stats.total_answered}
                    </span>
                    <span className="text-sm text-gray-500">ukupno</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tickets Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {tickets.map(ticketData => renderTicketGrid(ticketData))}
          </div>

          {/* Current Question */}
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
          {event?.status !== "active" && (
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