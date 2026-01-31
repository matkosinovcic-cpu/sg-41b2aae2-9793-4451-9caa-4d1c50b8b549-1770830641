import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event, EventQuestion, Ticket } from "@/services/eventService";
import { answerService, PlayerSession as Session, TicketStats } from "@/services/answerService";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, CheckCircle, XCircle } from "lucide-react";

export default function PlayerScreen() {
  const router = useRouter();
  const { eventId: urlEventId } = router.query;

  const [event, setEvent] = useState<Event | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionText, setQuestionText] = useState<string>("");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [noActiveEvent, setNoActiveEvent] = useState(false);
  const [stats, setStats] = useState<TicketStats[]>([]);

  const eventChannelRef = useRef<any>(null);

  // Load current question
  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log("[Player] 📥 Loading question #", questionNumber);
      const questionData = await eventService.getEventQuestion(eventId, questionNumber);
      setCurrentQuestion(questionData);
      setHasAnswered(false);
      
      if (questionData.questions) {
        setQuestionText(questionData.questions.text);
        console.log("[Player] ✅ Question loaded:", questionData.questions.text);
      }
    } catch (error) {
      console.error("[Player] Failed to load question:", error);
    }
  };

  // Load stats
  const loadStats = async () => {
    if (!event || !session || tickets.length === 0) return;
    
    try {
      const ticketIds = tickets.map(t => t.id);
      const statsData = await answerService.getTicketStats(event.id, ticketIds);
      setStats(statsData);
    } catch (error) {
      console.error("[Player] Failed to load stats:", error);
    }
  };

  // 📡 SUBSCRIBE TO REALTIME EVENT UPDATES
  const subscribeToEventUpdates = (eventId: string) => {
    console.log("═══════════════════════════════════════════════");
    console.log("[PLAYER] 📡 SETTING UP REALTIME SUBSCRIPTION");
    console.log("[PLAYER] 🔑 Event ID:", eventId);
    console.log("[PLAYER] 📋 Full ID:", eventId);
    console.log("[PLAYER] 🎯 Channel:", `player-event-${eventId}`);
    console.log("[PLAYER] 🔍 Filter:", `id=eq.${eventId}`);
    console.log("═══════════════════════════════════════════════");

    const channel = supabase
      .channel(`player-event-${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
          filter: `id=eq.${eventId}`,
        },
        async (payload) => {
          console.log("═══════════════════════════════════════════════");
          console.log("[PLAYER] ⚡ REALTIME UPDATE RECEIVED!");
          console.log("[PLAYER] 📦 Payload:", payload);
          console.log("[PLAYER] 🆔 Event ID from payload:", payload.new?.id?.slice(0, 8));
          console.log("[PLAYER] 🔢 Current question:", payload.new?.current_question_number);
          console.log("[PLAYER] 🎯 Drawn number:", payload.new?.current_drawn_number);
          console.log("[PLAYER] ⏰ Deadline:", payload.new?.question_open_until);
          console.log("[PLAYER] 🕒 Updated at:", payload.new?.updated_at);
          console.log("═══════════════════════════════════════════════");

          const newEvent = payload.new as Event;

          // ✅ DIRECT STATE UPDATE
          console.log("[PLAYER] 🔄 Updating state...");
          setEvent(newEvent);
          setDrawnNumbers(new Set(newEvent.drawn_numbers || []));
          console.log("[PLAYER] ✅ State updated");

          // ✅ LOAD QUESTION IF CHANGED
          if (
            newEvent.current_question_number &&
            newEvent.current_question_number !== currentQuestion?.question_number
          ) {
            console.log("[PLAYER] 🔔 NEW QUESTION DETECTED!");
            console.log("[PLAYER] 📥 Loading question:", newEvent.current_question_number);
            setHasAnswered(false); // Reset answer state
            await loadCurrentQuestion(newEvent.id, newEvent.current_question_number);
            console.log("[PLAYER] ✅ Question loaded and displayed");
          }

          // Load stats when finished
          if (newEvent.status === "finished" && session && tickets.length > 0) {
            console.log("[PLAYER] 🏁 Event finished, loading stats...");
            loadStats();
            loadDetailedResults();
          }
        }
      )
      .subscribe((status) => {
        console.log("[PLAYER] 📊 Subscription status:", status);
        
        if (status === "SUBSCRIBED") {
          console.log("[PLAYER] ✅ REALTIME SUBSCRIPTION ACTIVE");
          console.log("[PLAYER] 🎧 Listening for UPDATE events on events table");
          console.log("[PLAYER] 🔍 Filtering by: id =", eventId.slice(0, 8));
        } else if (status === "CHANNEL_ERROR") {
          console.error("[PLAYER] ❌ SUBSCRIPTION ERROR!");
          console.error("[PLAYER] ⚠️ Realtime connection failed");
        } else if (status === "TIMED_OUT") {
          console.error("[PLAYER] ⏰ SUBSCRIPTION TIMEOUT!");
        } else if (status === "CLOSED") {
          console.log("[PLAYER] 🔌 Subscription closed");
        }
      });

    eventChannelRef.current = channel;
    console.log("[PLAYER] 💾 Channel reference stored");
  };

  // ✅ SIMPLE REALTIME INITIALIZATION
  useEffect(() => {
    console.log("[Player] 🚀 Player Screen mounting");

    const initPlayer = async () => {
      try {
        let targetEventId = urlEventId as string;

        // If no URL eventId, find active event
        if (!targetEventId) {
          console.log("[Player] 🔍 No eventId in URL, looking for active event");
          const { data: activeEvent } = await supabase
            .from('events')
            .select('*')
            .eq('status', 'active')
            .maybeSingle();

          if (!activeEvent) {
            console.log("[Player] ⚠️ No active event found");
            setNoActiveEvent(true);
            setIsLoadingEvent(false);
            return;
          }

          targetEventId = activeEvent.id;
          console.log("[Player] ✅ Found active event:", targetEventId.slice(0, 8));
        }

        // Load event data
        console.log("[Player] 📥 Loading event data:", targetEventId.slice(0, 8));
        const eventData = await eventService.getEvent(targetEventId);
        setEvent(eventData);
        setDrawnNumbers(new Set(eventData.drawn_numbers || []));

        // Get or create session
        const sessionData = await answerService.getOrCreateSession(eventData.id);
        setSession(sessionData);

        // Load tickets
        const ticketsData = await answerService.getSessionTickets(sessionData.id);
        setTickets(ticketsData);

        // Load current question if exists
        if (eventData.current_question_number) {
          await loadCurrentQuestion(eventData.id, eventData.current_question_number);
        }

        // ✅ SUBSCRIBE TO REALTIME UPDATES
        console.log("[Player] 📡 Setting up realtime subscription for:", targetEventId.slice(0, 8));
        
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
              console.log("[Player] ⚡ Realtime UPDATE received");
              const newEvent = payload.new as Event;
              
              // ✅ DIRECT STATE UPDATE
              setEvent(newEvent);
              setDrawnNumbers(new Set(newEvent.drawn_numbers || []));
              
              // ✅ LOAD NEW QUESTION IF CHANGED
              if (newEvent.current_question_number && 
                  newEvent.current_question_number !== currentQuestion?.question_number) {
                console.log("[Player] 🔔 New question:", newEvent.current_question_number);
                await loadCurrentQuestion(newEvent.id, newEvent.current_question_number);
              }

              // Load stats when finished
              if (newEvent.status === "finished") {
                await loadStats();
              }
            }
          )
          .subscribe((status) => {
            console.log("[Player] 📡 Subscription status:", status);
          });

        eventChannelRef.current = channel;
        setIsLoadingEvent(false);
        setNoActiveEvent(false);

        console.log("[Player] ✅ Player initialization complete");
      } catch (error) {
        console.error("[Player] ❌ Failed to initialize Player:", error);
        setIsLoadingEvent(false);
      }
    };

    initPlayer();

    // Cleanup
    return () => {
      console.log("[Player] 🧹 Cleaning up subscription");
      if (eventChannelRef.current) {
        eventChannelRef.current.unsubscribe();
      }
    };
  }, [urlEventId]);

  // ⏱️ COUNTDOWN TIMER (LOCAL CALCULATION)
  useEffect(() => {
    if (!event?.question_open_until) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const deadline = new Date(event.question_open_until!).getTime();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
      setTimeRemaining(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [event?.question_open_until]);

  // Handle answer submission
  const handleAnswer = async (answer: boolean) => {
    if (!session || !currentQuestion || hasAnswered || timeRemaining <= 0) return;

    try {
      console.log("[Player] 📝 Submitting answer:", answer);
      await answerService.submitAnswer(
        session.id,
        currentQuestion.question_number,
        answer
      );
      setHasAnswered(true);
      console.log("[Player] ✅ Answer submitted successfully");
    } catch (error) {
      console.error("[Player] ❌ Failed to submit answer:", error);
    }
  };

  // Render ticket grid
  const renderTicketGrid = (ticket: Ticket) => {
    const ticketNumbers = ticket.ticket_questions?.map((tq: any) => tq.question_number) || [];
    
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

  // Winner screen
  if (event?.status === "finished" && event.winner_ticket_id) {
    const isWinner = tickets.some(t => t.id === event.winner_ticket_id);
    
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

            {/* Tickets with stats */}
            <div className="space-y-4">
              {tickets.map((ticket) => {
                const ticketStat = stats.find(s => s.ticket_id === ticket.id);
                
                return (
                  <Card key={ticket.id} className={ticket.is_winner ? "border-4 border-yellow-400" : ""}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <Badge className="bg-purple-600 text-white">
                          {ticket.serial_number}
                        </Badge>
                        {ticket.is_winner && (
                          <Badge className="bg-yellow-400 text-gray-900">
                            POBJEDNIK!
                          </Badge>
                        )}
                      </div>
                      
                      {renderTicketGrid(ticket)}
                      
                      {ticketStat && (
                        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                          <div className="text-center">
                            <div className="font-bold text-green-600">{ticketStat.correct}</div>
                            <div className="text-gray-600">Točno</div>
                          </div>
                          <div className="text-center">
                            <div className="font-bold text-red-600">{ticketStat.incorrect}</div>
                            <div className="text-gray-600">Netočno</div>
                          </div>
                          <div className="text-center">
                            <div className="font-bold text-blue-600">{ticketStat.percentage}%</div>
                            <div className="text-gray-600">Točnost</div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
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

                {/* Timer */}
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

          {/* Tickets */}
          <div className="space-y-4">
            {tickets.map((ticket) => (
              <Card key={ticket.id}>
                <CardContent className="pt-6">
                  <div className="mb-3">
                    <Badge className="bg-purple-600 text-white">
                      {ticket.serial_number}
                    </Badge>
                  </div>
                  {renderTicketGrid(ticket)}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}