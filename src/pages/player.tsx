import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import { answerService, PlayerSession, SessionStats, TicketDetailedResults } from "@/services/answerService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, X, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";

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
  const urlEventId = router.query.eventId as string | undefined;
  
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
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [noActiveEvent, setNoActiveEvent] = useState(false);
  
  const { toast } = useToast();
  
  // Refs for tracking sync
  const eventChannelRef = useRef<RealtimeChannel | null>(null);
  const activeEventTrackerRef = useRef<RealtimeChannel | null>(null);
  const lastUpdatedAtRef = useRef<string | null>(null);

  // 🚀 RESOLVE ACTIVE EVENT
  const resolveActiveEvent = async (): Promise<Event | null> => {
    try {
      console.log("[Player] 🔍 Resolving active event...");
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error("[Player] ❌ Error fetching active event:", error);
        return null;
      }
      
      return data as unknown as Event;
    } catch (error) {
      console.error("[Player] ❌ Exception in resolveActiveEvent:", error);
      return null;
    }
  };

  // 🎯 LOAD EVENT DATA
  const loadEventData = async (eventId: string) => {
    try {
      console.log("[Player] 📥 Loading event data:", eventId.slice(0, 8));
      const eventData = await eventService.getEvent(eventId);
      
      setEvent(eventData);
      setDrawnNumbers(new Set(eventData.drawn_numbers || []));
      lastUpdatedAtRef.current = eventData.updated_at || null;
      
      // Create/get session
      const sessionData = await answerService.getOrCreateSession(eventData.id);
      setSession(sessionData);
      
      if (eventData.current_question_number) {
        await loadCurrentQuestion(eventData.id, eventData.current_question_number);
      }
      
      console.log("[Player] ✅ Event data loaded");
    } catch (error) {
      console.error("[Player] ❌ Failed to load event data:", error);
    }
  };

  // 🔄 SUBSCRIBE TO EVENT UPDATES (REALTIME PRIMARY)
  const subscribeToEventUpdates = (eventId: string) => {
    // Unsubscribe from old channel if exists
    if (eventChannelRef.current) {
      console.log("[Player] 🧹 Unsubscribing from old event channel");
      eventChannelRef.current.unsubscribe();
      eventChannelRef.current = null;
    }
    
    console.log("[Player] 📡 Subscribing to event updates:", eventId.slice(0, 8));
    
    const channel = supabase
      .channel(`player-event-${eventId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'events',
        filter: `id=eq.${eventId}`
      }, async (payload) => {
        console.log("[Player] ⚡ Realtime UPDATE received");
        
        const newEvent = payload.new as Event;
        
        // 🎯 COMPARE GUARD - Prevent unnecessary updates
        if (newEvent.updated_at === lastUpdatedAtRef.current) {
          return;
        }
        
        lastUpdatedAtRef.current = newEvent.updated_at || null;
        
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
      })
      .subscribe((status) => {
        console.log("[Player] 📡 Event subscription status:", status);
      });
    
    eventChannelRef.current = channel;
  };

  // 🔄 SUBSCRIBE TO ACTIVE EVENT TRACKER
  const subscribeToActiveEventTracker = () => {
    const channel = supabase
      .channel('player-active-event-tracker')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'events',
        filter: 'status=eq.active'
      }, async (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const newActiveEvent = payload.new as Event;
          
          // Check if it's a different event
          if (event && newActiveEvent.id === event.id) {
            return;
          }
          
          console.log("[Player] 🆕 NEW ACTIVE EVENT detected:", newActiveEvent.id.slice(0, 8));
          
          // Delay to avoid switching during transient states
          setTimeout(async () => {
            await handleNewActiveEvent(newActiveEvent);
          }, 1000);
        }
      })
      .subscribe();
    
    activeEventTrackerRef.current = channel;
  };

  // 🔥 HANDLE NEW ACTIVE EVENT
  const handleNewActiveEvent = async (newEvent: Event) => {
    console.log("[Player] 🔥 Switching to new active event");
    
    // 1. Clear old state
    setDrawnNumbers(new Set());
    setCurrentQuestion(null);
    setTimeRemaining(0);
    
    // 2. Clear cache
    localStorage.removeItem('eventId');
    sessionStorage.clear();
    
    // 3. Load new event
    await loadEventData(newEvent.id);
    
    // 4. Subscribe to new event
    subscribeToEventUpdates(newEvent.id);
  };

  // 🚀 INITIAL LOAD
  useEffect(() => {
    const initializePlayer = async () => {
      console.log("[Player] 🚀 Initializing Player screen...");
      
      let targetEventId = urlEventId;
      
      if (!targetEventId) {
        const activeEvent = await resolveActiveEvent();
        
        if (activeEvent) {
          targetEventId = activeEvent.id;
          console.log("[Player] ✅ Using active event:", targetEventId.slice(0, 8));
        } else {
          console.log("[Player] ⚠️ No active event found");
          setNoActiveEvent(true);
          setIsLoadingEvent(false);
          return;
        }
      }
      
      await loadEventData(targetEventId);
      subscribeToEventUpdates(targetEventId);
      subscribeToActiveEventTracker();
      
      setIsLoadingEvent(false);
      setNoActiveEvent(false);
    };
    
    initializePlayer();
    
    return () => {
      if (eventChannelRef.current) eventChannelRef.current.unsubscribe();
      if (activeEventTrackerRef.current) activeEventTrackerRef.current.unsubscribe();
    };
  }, [urlEventId]);

  // Timer countdown
  useEffect(() => {
    if (!event?.question_open_until || !session || !currentQuestion) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const deadline = new Date(event.question_open_until!).getTime();
      
      // Validate deadline
      if (isNaN(deadline)) {
        console.log("[Player-Timer] ⚠️ Invalid deadline, skipping timeout");
        setTimeRemaining(0);
        return;
      }
      
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
      
      // Debug logging (only when value changes)
      if (remaining !== timeRemaining && remaining > 0) {
        console.log(`[Player-Timer] ⏱️ Countdown: ${remaining}s`);
      }
      
      setTimeRemaining(remaining);
      
      // Only call timeout if we actually had time (prevent premature calls)
      if (remaining === 0 && !hasAnswered && timeRemaining > 0) {
        console.log("[Player-Timer] ⏱️ Time expired, calling handleTimeout");
        handleTimeout();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [event?.question_open_until, hasAnswered, session?.id, currentQuestion?.question_number]);

  const handleTimeout = async () => {
    if (!session || !currentQuestion || !event) return;
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
    } catch (error) {
      console.error("[Player] ❌ Failed to mark timeout:", error);
    }
  };

  const loadStats = async () => {
    if (!session || tickets.length === 0 || !event) return;
    try {
      const promises = tickets.map(async (t) => {
        const singleStats = await answerService.getSessionStats(session.id, event.id, t.serial_number);
        return { ...singleStats, ticket_serial: t.serial_number };
      });
      const results = await Promise.all(promises);
      setStats({
        ticket_stats: results,
        total_correct: results.reduce((sum, r) => sum + r.correct, 0),
        total_answered: results.reduce((sum, r) => sum + r.answered, 0),
        drawn_in_game: event.drawn_numbers?.length || 0,
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
        const details = await answerService.getTicketDetailedResults(session.id, ticket, event.id, event.drawn_numbers || []);
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
      if (newSet.has(serial)) newSet.delete(serial);
      else newSet.add(serial);
      return newSet;
    });
  };

  const handleAddTicket = async () => {
    if (!serialInput.trim()) return;
    if (tickets.some(t => t.serial_number === serialInput)) {
      toast({ title: "Duplicate", description: "Already added.", variant: "destructive" });
      return;
    }
    if (tickets.length >= 4) {
      toast({ title: "Limit Reached", description: "Max 4 tickets.", variant: "destructive" });
      return;
    }

    try {
      const ticketData = await eventService.getTicketBySerial(serialInput);
      if (event && ticketData.event_id !== event.id) {
        toast({ title: "Error", description: "Wrong event ticket.", variant: "destructive" });
        return;
      }
      setTickets([...tickets, ticketData]);
      if (!ticket) setTicket(ticketData);
      setSerialInput("");
      toast({ title: "Success", description: "Ticket added!" });
    } catch (error) {
      toast({ title: "Error", description: "Ticket invalid", variant: "destructive" });
    }
  };

  const handleClearTickets = () => {
    setTickets([]);
    setTicket(null);
  };

  const handleRemoveTicket = (ticketId: string) => {
    const newTickets = tickets.filter(t => t.id !== ticketId);
    setTickets(newTickets);
    if (newTickets.length === 0) handleClearTickets();
    else if (ticket?.id === ticketId) setTicket(newTickets[0]);
  };

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      setCurrentQuestion(data);
      if (session) {
        const answers = await answerService.getSessionAnswers(session.id);
        const existingAnswer = answers.find(a => a.question_number === questionNumber);
        setHasAnswered(!!existingAnswer);
        setAnswer(existingAnswer ? existingAnswer.answer_yesno === "YES" : null);
      } else {
        setHasAnswered(false);
        setAnswer(null);
      }
    } catch (error) {
      setCurrentQuestion(null);
    }
  };

  const handleSubmitAnswer = async (answerValue: boolean) => {
    if (!session || !currentQuestion || hasAnswered || !event) return;
    setAnswer(answerValue);
    try {
      for (const ticket of tickets) {
        await answerService.submitAnswer(session.id, event.id, currentQuestion.question_number, answerValue, ticket.serial_number);
      }
      setHasAnswered(true);
      toast({ title: "Odgovor poslan", description: `Odgovorili ste: ${answerValue ? "DA" : "NE"}` });
    } catch (error: any) {
      setAnswer(null);
      toast({ title: "Greška", description: error.message, variant: "destructive" });
    }
  };

  const renderTicketGrid = (ticketData: TicketData) => {
    const numbers = ticketData.ticket_questions.map(tq => tq.question_number).sort((a, b) => a - b);
    const drawnCount = numbers.filter(num => drawnNumbers.has(num)).length;
    const ticketStats = event?.status === "finished" ? stats?.ticket_stats.find(ts => ts.ticket_serial === ticketData.serial_number) : null;
    const details = detailedResults.get(ticketData.serial_number);
    const isExpanded = expandedTickets.has(ticketData.serial_number);

    return (
      <Card key={ticketData.id} className="relative bg-white/95 backdrop-blur-sm">
        <button onClick={() => handleRemoveTicket(ticketData.id)} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 z-10">
          <X className="w-4 h-4" />
        </button>
        <CardContent className="p-4">
          <div className="text-center mb-3">
            <Badge className="bg-purple-600 text-white mb-1">{ticketData.serial_number}</Badge>
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
                <div key={num} className={`aspect-square flex items-center justify-center rounded-lg font-bold text-lg transition-all ${isDrawn ? "bg-green-500 text-white scale-105 shadow-lg" : "bg-purple-100 text-purple-900"}`}>
                  {num}
                </div>
              );
            })}
          </div>
          <div className="text-center mt-3 space-y-1">
            <div className="text-sm font-semibold text-gray-600">{drawnCount} / 15 izvučeno</div>
            {event?.status === "finished" && ticketStats && (
              <>
                <div className="text-center mb-2 space-y-1">
                  <div className="text-lg font-bold text-blue-600">✓ {ticketStats.correct} / {ticketStats.drawnOnTicket} ({ticketStats.accuracy}%)</div>
                </div>
                {details && (
                  <Button variant="outline" size="sm" onClick={() => toggleTicketDetails(ticketData.serial_number)} className="w-full mt-2">
                    {isExpanded ? <><ChevronUp className="w-4 h-4 mr-2" />Sakrij</> : <><ChevronDown className="w-4 h-4 mr-2" />Detalji</>}
                  </Button>
                )}
              </>
            )}
          </div>
          {isExpanded && details && event?.status === "finished" && (
            <div className="mt-4 space-y-2 border-t pt-4 max-h-60 overflow-y-auto">
              {details.questions.map((q) => (
                <div key={q.question_number} className={`p-2 rounded border text-xs ${q.result === "Točno" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                  <div className="font-bold">#{q.question_number}: {q.question_text.substring(0, 30)}...</div>
                  <div className="flex justify-between mt-1">
                    <span>Vaš: {q.player_answer}</span>
                    <span className={q.result === "Točno" ? "text-green-600" : "text-red-600"}>{q.result}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoadingEvent) {
    return (
      <>
        <SEO title="Player - Pitalica Skitalica" />
        <div className="min-h-screen bg-black flex items-center justify-center text-white">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-spin">⏳</div>
            <p>Tražim aktivni event...</p>
          </div>
        </div>
      </>
    );
  }

  if (noActiveEvent) {
    return (
      <>
        <SEO title="Player - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-purple-900 to-indigo-900 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-white/10 backdrop-blur border-white/20 text-white">
            <CardContent className="pt-6 text-center">
              <div className="text-6xl mb-4 animate-pulse">📡</div>
              <h1 className="text-2xl font-bold mb-2">Čekam aktivni event</h1>
              <p className="text-gray-300">
                Igra još nije počela. Pričekajte da admin pokrene event.
              </p>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  if (tickets.length === 0) {
    return (
      <>
        <SEO title="Player - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-500 flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl">
            <CardContent className="pt-8 pb-8 space-y-6">
              <div className="text-center">
                <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600 mb-2">
                  {event?.name || "PITALICA SKITALICA"}
                </h1>
                <p className="text-gray-600 font-medium">Unesi broj ulaznice za igru</p>
              </div>
              <div className="space-y-4">
                <Input
                  placeholder="npr. T1234-5678"
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTicket()}
                  className="text-lg h-12 text-center font-mono uppercase tracking-wider"
                />
                <Button onClick={handleAddTicket} className="w-full h-12 text-lg font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-lg transition-all hover:scale-[1.02]">
                  PRIDRUŽI SE IGRI 🚀
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <SEO title="Player - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-4 pb-20">
        <div className="container mx-auto max-w-4xl space-y-4">
          <div className="flex justify-between items-center text-white">
            <h1 className="text-xl font-bold truncate">{event?.name}</h1>
            <Badge variant="outline" className="text-white border-white/30 bg-white/10">
              {tickets.length} ulaznica
            </Badge>
          </div>

          {event?.winner_ticket_id && (
            <Card className="border-4 border-yellow-500 bg-yellow-50 animate-pulse">
              <CardContent className="pt-6 flex items-center justify-center gap-3">
                <Trophy className="w-8 h-8 text-yellow-600" />
                <div className="text-center">
                  <p className="text-xl font-black text-yellow-600">IMAMO POBJEDNIKA!</p>
                  <p className="font-mono text-yellow-800 font-bold">{winnerSerial || "..."}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {event?.status !== "finished" && (
            <div className="flex gap-2 bg-white/10 p-2 rounded-lg backdrop-blur-sm">
              <Input
                placeholder="Dodaj još ulaznica..."
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                disabled={tickets.length >= 4}
                className="bg-white/90 border-0 focus-visible:ring-2 ring-white/50"
              />
              <Button onClick={handleAddTicket} disabled={tickets.length >= 4} variant="secondary">
                Dodaj
              </Button>
              <Button onClick={handleClearTickets} variant="destructive" size="icon">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {event?.status === "active" && currentQuestion ? (
            <Card className="bg-white shadow-2xl border-0 overflow-hidden">
              <div className="h-2 bg-gray-100 w-full">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-100 ease-linear"
                  style={{ width: `${(timeRemaining / 9) * 100}%` }}
                />
              </div>
              <CardContent className="p-6 space-y-6 text-center">
                <div>
                  <Badge className="bg-blue-100 text-blue-800 mb-2 hover:bg-blue-100 px-3 py-1 text-sm">
                    Pitanje #{currentQuestion.question_number}
                  </Badge>
                  <h2 className="text-2xl md:text-3xl font-black text-gray-800 leading-tight">
                    {currentQuestion.questions?.text}
                  </h2>
                </div>
                
                {/* Countdown Timer Display */}
                {timeRemaining > 0 && (
                  <div className="text-5xl font-black text-orange-600 animate-pulse">
                    ⏱️ {timeRemaining}s
                  </div>
                )}

                {(currentQuestion?.questions?.question_type === 'yes_no' || 
                  !currentQuestion?.questions?.question_type) && (
                  timeRemaining > 0 ? (
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <Button
                        onClick={() => handleSubmitAnswer(true)}
                        disabled={hasAnswered}
                        className={`h-24 text-3xl font-black rounded-xl transition-all active:scale-95 ${
                          hasAnswered && answer === true 
                            ? "bg-green-600 ring-4 ring-green-200" 
                            : "bg-green-500 hover:bg-green-600 shadow-[0_4px_0_rgb(21,128,61)]"
                        }`}
                      >
                        DA
                      </Button>
                      <Button
                        onClick={() => handleSubmitAnswer(false)}
                        disabled={hasAnswered}
                        className={`h-24 text-3xl font-black rounded-xl transition-all active:scale-95 ${
                          hasAnswered && answer === false
                            ? "bg-red-600 ring-4 ring-red-200"
                            : "bg-red-500 hover:bg-red-600 shadow-[0_4px_0_rgb(185,28,28)]"
                        }`}
                      >
                        NE
                      </Button>
                    </div>
                  ) : (
                    <div className="bg-gray-100 rounded-xl p-4 font-bold text-gray-500">
                      Vrijeme je isteklo! ⏱️
                    </div>
                  )
                )}
                
                {hasAnswered && (
                  <div className="text-sm font-medium text-gray-500 animate-in fade-in slide-in-from-bottom-2">
                    Vaš odgovor: <span className="text-black font-bold">{answer ? "DA" : "NE"}</span>
                    {timeRemaining > 0 && " • Čekamo kraj vremena..."}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : event?.status === "active" ? (
            <Card className="bg-white/90 backdrop-blur text-center py-8 animate-pulse">
              <CardContent>
                <div className="text-4xl mb-2">🎲</div>
                <h3 className="text-xl font-bold text-gray-700">Čekamo sljedeće pitanje...</h3>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tickets.map(ticketData => renderTicketGrid(ticketData))}
          </div>
        </div>
      </div>
    </>
  );
}