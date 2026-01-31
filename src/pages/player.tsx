import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event, EventQuestion, Ticket } from "@/services/eventService";
import { answerService, TicketStats } from "@/services/answerService";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Trophy, CheckCircle, XCircle } from "lucide-react";

export default function PlayerScreen() {
  const router = useRouter();
  const { eventId: urlEventId, ticketId: urlTicketId } = router.query;

  const [event, setEvent] = useState<Event | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");
  const [ticketInputValue, setTicketInputValue] = useState<string>("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionText, setQuestionText] = useState<string>("");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [noActiveEvent, setNoActiveEvent] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [lastRealtimeAt, setLastRealtimeAt] = useState<string | null>(null);
  const [stats, setStats] = useState<TicketStats[]>([]);

  const eventChannelRef = useRef<any>(null);

  // ✅ HANDLE TICKET SELECTION (query param or localStorage)
  useEffect(() => {
    // Priority 1: URL query param
    if (urlTicketId && typeof urlTicketId === 'string') {
      setSelectedTicketId(urlTicketId);
      localStorage.setItem('selectedTicketId', urlTicketId);
      return;
    }

    // Priority 2: localStorage
    const stored = localStorage.getItem('selectedTicketId');
    if (stored) {
      setSelectedTicketId(stored);
    }
  }, [urlTicketId]);

  // Load ticket when selectedTicketId changes
  useEffect(() => {
    if (!selectedTicketId) return;

    const loadTicket = async () => {
      try {
        console.log("[PLAYER SYNC] loading_ticket", selectedTicketId.slice(0, 8));
        const ticketData = await eventService.getTicket(selectedTicketId);
        setTicket(ticketData);
        console.log("[PLAYER SYNC] ticket_loaded", ticketData.serial_number);
      } catch (error) {
        console.error("[PLAYER SYNC] ticket_load_failed", error);
        setTicket(null);
      }
    };

    loadTicket();
  }, [selectedTicketId]);

  // Handle ticket selection from input
  const handleSelectTicket = () => {
    if (!ticketInputValue.trim()) return;
    
    const ticketId = ticketInputValue.trim();
    setSelectedTicketId(ticketId);
    localStorage.setItem('selectedTicketId', ticketId);
    console.log("[PLAYER SYNC] ticket_selected", ticketId.slice(0, 8));
  };

  // Load current question
  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log("[PLAYER SYNC] loading_question", questionNumber);
      const questionData = await eventService.getEventQuestion(eventId, questionNumber);
      setCurrentQuestion(questionData);
      setHasAnswered(false);
      
      if (questionData.questions) {
        setQuestionText(questionData.questions.text);
        console.log("[PLAYER SYNC] question_loaded", questionData.questions.text);
      }
    } catch (error) {
      console.error("[PLAYER SYNC] question_load_failed", error);
    }
  };

  // Load stats
  const loadStats = async () => {
    if (!event || !ticket) return;
    
    try {
      const ticketIds = [ticket.id];
      const statsData = await answerService.getTicketStats(event.id, ticketIds);
      setStats(statsData);
    } catch (error) {
      console.error("[PLAYER SYNC] stats_load_failed", error);
    }
  };

  // ✅ ZERO POLLING - PURE REALTIME SUBSCRIPTION
  useEffect(() => {
    console.log("[PLAYER SYNC] mounting");

    const initPlayer = async () => {
      try {
        let targetEventId = urlEventId as string;

        // If no URL eventId, find active event
        if (!targetEventId) {
          console.log("[PLAYER SYNC] finding_active_event");
          const { data: activeEvent } = await supabase
            .from('events')
            .select('*')
            .eq('status', 'active')
            .maybeSingle();

          if (!activeEvent) {
            console.log("[PLAYER SYNC] no_active_event");
            setNoActiveEvent(true);
            setIsLoadingEvent(false);
            return;
          }

          targetEventId = activeEvent.id;
          console.log("[PLAYER SYNC] active_event_found", targetEventId.slice(0, 8));
        }

        // ✅ STEP 1: ONE INITIAL FETCH
        console.log("[PLAYER SYNC] initial_fetch", targetEventId.slice(0, 8));
        const eventData = await eventService.getEvent(targetEventId);
        setEvent(eventData);
        setDrawnNumbers(new Set(eventData.drawn_numbers || []));

        // Load current question if exists
        if (eventData.current_question_number) {
          await loadCurrentQuestion(eventData.id, eventData.current_question_number);
        }

        // ✅ STEP 2: REALTIME SUBSCRIPTION (NO POLLING!)
        console.log("[PLAYER SYNC] subscribing_realtime", targetEventId.slice(0, 8));
        
        const channel = supabase
          .channel(`player-event-${targetEventId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'events',
              filter: `id=eq.${targetEventId}`
            },
            async (payload) => {
              console.log("[PLAYER SYNC] realtime_event", {
                questionNumber: payload.new?.current_question_number,
                drawnNumber: payload.new?.current_drawn_number,
                deadline: payload.new?.question_open_until
              });
              
              setLastRealtimeAt(new Date().toISOString());
              
              const newEvent = payload.new as Event;
              
              // ✅ INSTANT STATE UPDATE
              console.log("[PLAYER SYNC] apply_state");
              setEvent(newEvent);
              setDrawnNumbers(new Set(newEvent.drawn_numbers || []));
              
              // ✅ LOAD NEW QUESTION IF CHANGED
              if (newEvent.current_question_number && 
                  newEvent.current_question_number !== currentQuestion?.question_number) {
                console.log("[PLAYER SYNC] new_question_detected", newEvent.current_question_number);
                await loadCurrentQuestion(newEvent.id, newEvent.current_question_number);
              }

              // Load stats when finished
              if (newEvent.status === "finished") {
                await loadStats();
              }
            }
          )
          .subscribe((status) => {
            console.log("[PLAYER SYNC] subscription_status", status);
            
            if (status === 'SUBSCRIBED') {
              console.log("[PLAYER SYNC] subscribed_ok");
              setRealtimeConnected(true);
            } else if (status === 'CHANNEL_ERROR') {
              console.error("[PLAYER SYNC] subscription_error");
              setRealtimeConnected(false);
            } else if (status === 'CLOSED') {
              console.log("[PLAYER SYNC] subscription_closed, reconnecting...");
              setRealtimeConnected(false);
              // ✅ RECONNECT STRATEGY (NO POLLING!)
              setTimeout(() => {
                console.log("[PLAYER SYNC] reconnecting");
                initPlayer();
              }, 2000);
            }
          });

        eventChannelRef.current = channel;
        setIsLoadingEvent(false);
        setNoActiveEvent(false);

        console.log("[PLAYER SYNC] initialization_complete");
      } catch (error) {
        console.error("[PLAYER SYNC] init_failed", error);
        setIsLoadingEvent(false);
      }
    };

    initPlayer();

    // Cleanup
    return () => {
      console.log("[PLAYER SYNC] cleanup");
      if (eventChannelRef.current) {
        eventChannelRef.current.unsubscribe();
      }
    };
  }, [urlEventId]);

  // ⏱️ LOCAL COUNTDOWN TICK (NO POLLING!)
  useEffect(() => {
    if (!event?.question_open_until) {
      setTimeRemaining(0);
      return;
    }

    // ✅ LOCAL TICK ONLY FOR DISPLAY (500ms)
    const interval = setInterval(() => {
      const now = new Date().getTime();
      const deadline = new Date(event.question_open_until!).getTime();
      const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
      setTimeRemaining(remaining);
    }, 500); // 500ms tick for display only

    return () => clearInterval(interval);
  }, [event?.question_open_until]);

  // ✅ DEBUG HELPER
  useEffect(() => {
    (window as any).__PLAYER_SYNC_STATUS__ = () => ({
      activeEventId: event?.id,
      realtimeConnected,
      lastRealtimeAt,
      currentQuestionNumber: event?.current_question_number,
      currentDrawnNumber: event?.current_drawn_number,
      questionOpenUntil: event?.question_open_until,
      selectedTicketId,
      ticketSerial: ticket?.serial_number
    });
  }, [event, realtimeConnected, lastRealtimeAt, selectedTicketId, ticket]);

  // Handle answer submission
  const handleAnswer = async (answer: boolean) => {
    if (!ticket || !currentQuestion || hasAnswered || timeRemaining <= 0) return;

    try {
      console.log("[PLAYER SYNC] submitting_answer", answer);
      await eventService.submitAnswer(ticket.id, currentQuestion.question_number, answer);
      setHasAnswered(true);
      console.log("[PLAYER SYNC] answer_submitted");
    } catch (error) {
      console.error("[PLAYER SYNC] answer_submit_failed", error);
    }
  };

  // Render ticket grid
  const renderTicketGrid = (ticketData: Ticket) => {
    const ticketNumbers = ticketData.ticket_questions?.map((tq: any) => tq.question_number) || [];
    
    return (
      <div className="grid grid-cols-5 gap-1">
        {ticketNumbers.map((num: number) => {
          const isDrawn = drawnNumbers.has(num);
          const isCurrent = event?.current_drawn_number === num;
          
          return (
            <div
              key={num}
              className={`
                aspect-square rounded flex items-center justify-center text-sm font-bold
                ${isDrawn ? 'bg-yellow-400 text-gray-900' : 'bg-gray-200 text-gray-600'}
                ${isCurrent ? 'ring-2 ring-blue-500' : ''}
              `}
            >
              {num}
            </div>
          );
        })}
      </div>
    );
  };

  // Loading state
  if (isLoadingEvent) {
    return (
      <>
        <SEO title="Player - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 flex items-center justify-center">
          <div className="text-white text-2xl font-bold">Učitavam...</div>
        </div>
      </>
    );
  }

  // No active event
  if (noActiveEvent) {
    return (
      <>
        <SEO title="Player - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 flex items-center justify-center p-4">
          <div className="text-center">
            <div className="text-white text-4xl mb-4">⏳</div>
            <div className="text-white text-2xl font-bold mb-2">Čekam aktivni event</div>
            <div className="text-white/80">
              Još nema aktivnog eventa. Automatski će se prikazati kad admin pokrene event.
            </div>
          </div>
        </div>
      </>
    );
  }

  // ✅ TICKET SELECTION SCREEN
  if (!selectedTicketId || !ticket) {
    return (
      <>
        <SEO title="Odaberi Tiket - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-4">
          <div className="container mx-auto max-w-md">
            <Card className="mt-20">
              <CardContent className="pt-6">
                <h2 className="text-2xl font-bold text-center mb-6">Odaberi Svoj Tiket</h2>
                
                <div className="space-y-4">
                  <Input
                    placeholder="Unesi ID tiketa"
                    value={ticketInputValue}
                    onChange={(e) => setTicketInputValue(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') handleSelectTicket();
                    }}
                  />
                  
                  <Button
                    onClick={handleSelectTicket}
                    className="w-full"
                    disabled={!ticketInputValue.trim()}
                  >
                    Odaberi Tiket
                  </Button>
                </div>

                <div className="mt-6 text-sm text-gray-600 text-center">
                  Unesi ID tiketa koji si dobio od organizatora
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  // Winner screen
  if (event?.status === "finished" && event.winner_ticket_id) {
    const isWinner = ticket.id === event.winner_ticket_id;
    
    return (
      <>
        <SEO title={isWinner ? "Pobjeda!" : "Kraj igre"} />
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-4">
          <div className="container mx-auto max-w-4xl">
            <div className="text-center mb-8">
              <Trophy className={`w-32 h-32 mx-auto mb-4 ${isWinner ? 'text-yellow-400' : 'text-white'}`} />
              <h1 className="text-4xl font-black text-white mb-4">
                {isWinner ? "🎉 POBJEDNIK! 🎉" : "KRAJ IGRE"}
              </h1>
              {isWinner && (
                <p className="text-white text-xl">Čestitamo! Osvojili ste nagradu!</p>
              )}
            </div>

            {/* Ticket with stats */}
            <Card className={isWinner ? "border-4 border-yellow-400" : ""}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <Badge className="bg-purple-600 text-white">
                    {ticket.serial_number}
                  </Badge>
                  {isWinner && (
                    <Badge className="bg-yellow-400 text-gray-900">
                      POBJEDNIK!
                    </Badge>
                  )}
                </div>
                
                {renderTicketGrid(ticket)}
                
                {stats.length > 0 && stats[0] && (
                  <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    <div className="text-center">
                      <div className="font-bold text-green-600">{stats[0].correct}</div>
                      <div className="text-gray-600">Točno</div>
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-red-600">{stats[0].incorrect}</div>
                      <div className="text-gray-600">Netočno</div>
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-blue-600">{stats[0].percentage}%</div>
                      <div className="text-gray-600">Točnost</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SEO title="Player - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-4">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <div className="text-center mb-6">
            <h1 className="text-3xl font-black text-white mb-2">
              {event?.name || "PITALICA SKITALICA"}
            </h1>
            <div className="text-white/80">
              Pitanje {event?.current_question_number || 0} / 90
            </div>
          </div>

          {/* Question Card */}
          {currentQuestion && questionText ? (
            <Card className="mb-6">
              <CardContent className="pt-6">
                <div className="text-center mb-4">
                  <Badge className="bg-gradient-to-r from-blue-600 to-purple-600 text-white text-lg px-4 py-2">
                    #{event?.current_drawn_number}
                  </Badge>
                </div>

                <h2 className="text-2xl font-bold text-center mb-6">
                  {questionText}
                </h2>

                {/* Timer - 9s countdown */}
                <div className={`text-center text-4xl font-black mb-6 ${
                  timeRemaining <= 3 ? 'text-red-600' : 'text-blue-600'
                }`}>
                  ⏱️ {timeRemaining}s
                </div>

                {/* Answer buttons */}
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    onClick={() => handleAnswer(true)}
                    disabled={hasAnswered || timeRemaining <= 0}
                    className="h-20 text-2xl font-bold bg-green-500 hover:bg-green-600"
                  >
                    {hasAnswered ? <CheckCircle className="w-8 h-8" /> : "DA"}
                  </Button>
                  <Button
                    onClick={() => handleAnswer(false)}
                    disabled={hasAnswered || timeRemaining <= 0}
                    className="h-20 text-2xl font-bold bg-red-500 hover:bg-red-600"
                  >
                    {hasAnswered ? <XCircle className="w-8 h-8" /> : "NE"}
                  </Button>
                </div>

                {hasAnswered && (
                  <div className="text-center mt-4 text-green-600 font-bold">
                    ✓ Odgovor poslan
                  </div>
                )}

                {timeRemaining <= 0 && !hasAnswered && (
                  <div className="text-center mt-4 text-red-600 font-bold">
                    ⏰ Vrijeme isteklo
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="mb-6">
              <CardContent className="pt-6 text-center text-gray-600">
                Čekam prvo pitanje...
              </CardContent>
            </Card>
          )}

          {/* Ticket */}
          <Card>
            <CardContent className="pt-6">
              <div className="mb-3">
                <Badge className="bg-purple-600 text-white">
                  {ticket.serial_number}
                </Badge>
              </div>
              {renderTicketGrid(ticket)}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}