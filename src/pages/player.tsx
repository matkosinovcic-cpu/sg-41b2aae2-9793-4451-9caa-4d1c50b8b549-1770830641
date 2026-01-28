import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { eventService } from "@/services/eventService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Clock, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function PlayerScreen() {
  const [serialNumber, setSerialNumber] = useState("");
  const [ticket, setTicket] = useState<any>(null); // Keep for backward compat/single ref
  const [tickets, setTickets] = useState<any[]>([]); // New multi-ticket state
  const [event, setEvent] = useState<any>(null);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [currentQuestionNumber, setCurrentQuestionNumber] = useState<number>(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<"disconnected" | "connected">("disconnected");
  const [pollingActive, setPollingActive] = useState(false);
  const [lastReceivedQuestionNumber, setLastReceivedQuestionNumber] = useState<number | null>(null);
  const lastQuestionNumberRef = useRef<number | null>(null);
  const { toast } = useToast();

  // Load from localStorage on mount
  useEffect(() => {
    const loadStoredTickets = async () => {
      const storedEventId = localStorage.getItem("event_id");
      const storedSerialsJSON = localStorage.getItem("ticket_serials");
      const storedSingleSerial = localStorage.getItem("ticket_serial");

      if (!storedEventId) return;

      let serialsToLoad: string[] = [];

      if (storedSerialsJSON) {
        try {
          serialsToLoad = JSON.parse(storedSerialsJSON);
        } catch (e) {
          console.error("Failed to parse ticket_serials", e);
        }
      } else if (storedSingleSerial) {
        serialsToLoad = [storedSingleSerial];
      }

      if (serialsToLoad.length > 0) {
        console.log("[PLAYER] Auto-rejoining with tickets:", serialsToLoad);
        
        try {
          // Load event first
          const eventData = await eventService.getEvent(storedEventId);
          setEvent(eventData);
          setCurrentQuestionNumber(eventData.current_question_number || 0);
          lastQuestionNumberRef.current = eventData.current_question_number;

          // Load all tickets
          const loadedTickets = [];
          for (const serial of serialsToLoad) {
            try {
              const ticketData = await eventService.getTicketBySerial(serial);
              if (ticketData.event_id === storedEventId) {
                loadedTickets.push(ticketData);
              }
            } catch (err) {
              console.error(`Failed to load ticket ${serial}`, err);
            }
          }

          if (loadedTickets.length > 0) {
            setTickets(loadedTickets);
            setTicket(loadedTickets[0]); // Set primary ticket
            
            // Load current question if one exists
            if (eventData.current_question_number) {
              await loadCurrentQuestion(storedEventId, eventData.current_question_number);
            }
          } else {
            // No valid tickets found
            localStorage.removeItem("ticket_serials");
            localStorage.removeItem("ticket_serial");
            localStorage.removeItem("event_id");
          }
        } catch (error) {
          console.error("[PLAYER] Auto-rejoin failed:", error);
        }
      }
    };

    loadStoredTickets();
  }, []);

  // Update subscriptions to handle multiple tickets
  useEffect(() => {
    if (!event?.id) {
      setSubscriptionStatus("disconnected");
      return;
    }

    // Subscribe to event changes
    const eventSubscription = eventService.subscribeToEvent(event.id, async (payload) => {
      console.log("═══════════════════════════════════════════");
      console.log("[PLAYER] Real-time UPDATE received!");
      console.log("[PLAYER] Payload type:", payload.eventType);
      console.log("[PLAYER] Full payload:", JSON.stringify(payload, null, 2));
      
      if (!payload.new) {
        console.log("[PLAYER] ⚠️ WARNING: payload.new is missing!");
        return;
      }

      const updatedEvent = payload.new;
      console.log("[PLAYER] Updated event data:", updatedEvent);
      console.log("[PLAYER] New current_question_number:", updatedEvent.current_question_number);
      console.log("[PLAYER] Previous question number (ref):", lastQuestionNumberRef.current);
      
      // Update last received value for debug display
      setLastReceivedQuestionNumber(updatedEvent.current_question_number);
      
      // Check if question number changed
      const questionChanged = updatedEvent.current_question_number !== lastQuestionNumberRef.current;
      console.log("[PLAYER] Question changed?", questionChanged);
      
      if (questionChanged && updatedEvent.current_question_number) {
        lastQuestionNumberRef.current = updatedEvent.current_question_number;
        setCurrentQuestionNumber(updatedEvent.current_question_number);
        setAnswered(false);
        await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_question_number);
      }
      
      setEvent(updatedEvent);
      console.log("═══════════════════════════════════════════");
    });

    // Subscribe to ticket changes (for winner status)
    const ticketsSubscription = eventService.subscribeToTickets(event.id, (payload) => {
      if (payload.new) {
        setTickets(prevTickets => 
          prevTickets.map(t => t.id === payload.new.id ? payload.new : t)
        );
        // Also update primary ticket if it matches
        if (ticket?.id === payload.new.id) {
          setTicket(payload.new);
        }
      }
    });

    setSubscriptionStatus("connected");
    console.log("[PLAYER] ✅ Subscriptions active and ready");
    console.log("[PLAYER] Waiting for events.current_question_number changes...");

    // Load current question on mount if one exists
    if (event.current_question_number) {
      loadCurrentQuestion(event.id, event.current_question_number);
    }

    return () => {
      eventSubscription.unsubscribe();
      ticketsSubscription.unsubscribe();
      setSubscriptionStatus("disconnected");
    };
  }, [event?.id, ticket?.id]); // Note: dependency on ticket.id might trigger re-subs, consider removing if stable

  // Handlers for multi-ticket management
  const handleAddTicket = async () => {
    if (!serialNumber.trim()) return;
    if (tickets.length >= 4) {
      toast({ title: "Limit Reached", description: "You can only track up to 4 tickets.", variant: "destructive" });
      return;
    }

    // Check if already added
    if (tickets.some(t => t.serial_number === serialNumber.trim())) {
      toast({ title: "Duplicate", description: "This ticket is already added.", variant: "destructive" });
      return;
    }

    try {
      const ticketData = await eventService.getTicketBySerial(serialNumber);
      
      // Verify event match
      if (event && ticketData.event_id !== event.id) {
        toast({ title: "Error", description: "This ticket belongs to a different event.", variant: "destructive" });
        return;
      }

      // If this is the first ticket (joining)
      if (!event) {
        const eventData = await eventService.getEvent(ticketData.event_id);
        setEvent(eventData);
        setCurrentQuestionNumber(eventData.current_question_number || 0);
        lastQuestionNumberRef.current = eventData.current_question_number;
        localStorage.setItem("event_id", ticketData.event_id);
        
        if (eventData.current_question_number) {
          await loadCurrentQuestion(eventData.id, eventData.current_question_number);
        }
      }

      const newTickets = [...tickets, ticketData];
      setTickets(newTickets);
      setTicket(newTickets[0]); // Ensure primary ticket is set
      setSerialNumber(""); // Clear input
      
      // Update persistence
      localStorage.setItem("ticket_serials", JSON.stringify(newTickets.map(t => t.serial_number)));
      localStorage.setItem("ticket_serial", newTickets[0].serial_number); // Backward compat

      toast({ title: "Success", description: "Ticket added successfully!" });
    } catch (error) {
      toast({ title: "Error", description: "Invalid ticket serial number", variant: "destructive" });
    }
  };

  const handleRemoveTicket = (ticketId: string) => {
    const newTickets = tickets.filter(t => t.id !== ticketId);
    setTickets(newTickets);
    
    if (newTickets.length === 0) {
      handleClearTickets();
    } else {
      setTicket(newTickets[0]);
      localStorage.setItem("ticket_serials", JSON.stringify(newTickets.map(t => t.serial_number)));
      localStorage.setItem("ticket_serial", newTickets[0].serial_number);
    }
  };

  const handleClearTickets = () => {
    setTickets([]);
    setTicket(null);
    setEvent(null);
    localStorage.removeItem("ticket_serials");
    localStorage.removeItem("ticket_serial");
    localStorage.removeItem("event_id");
    window.location.reload(); // Clean state reset
  };

  // Update original handleJoin to use handleAddTicket logic logic or redirect
  const handleJoin = async () => {
    await handleAddTicket();
  };

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

      if (remaining === 0 && timeRemaining > 0) {
        setAnswered(true);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [event?.question_open_until, timeRemaining]);

  // Safari-safe fallback polling (1.5s interval)
  useEffect(() => {
    if (!event?.id) {
      console.log("[PLAYER-POLL] No event, skipping polling");
      setPollingActive(false);
      return;
    }

    // Only poll for active events
    if (event.status !== "active") {
      console.log("[PLAYER-POLL] Event not active, stopping polling");
      setPollingActive(false);
      return;
    }

    console.log("[PLAYER-POLL] Starting polling for event:", event.id);
    setPollingActive(true);

    const pollInterval = setInterval(async () => {
      try {
        console.log("[PLAYER-POLL] Fetching event state...");
        const updatedEvent = await eventService.getEvent(event.id);
        
        // Check if question number changed
        if (updatedEvent.current_question_number !== currentQuestionNumber) {
          console.log(`[PLAYER-POLL] ✅ Question changed: ${currentQuestionNumber} → ${updatedEvent.current_question_number}`);
          
          // Update state (triggers UI re-render)
          setCurrentQuestionNumber(updatedEvent.current_question_number || 0);
          lastQuestionNumberRef.current = updatedEvent.current_question_number;
          setEvent(updatedEvent);
          setAnswered(false);
          
          // Load new question
          if (updatedEvent.current_question_number) {
            await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_question_number);
          }
        } else {
          console.log("[PLAYER-POLL] No change detected");
        }

        // Stop polling if event ended
        if (updatedEvent.status !== "active") {
          console.log("[PLAYER-POLL] Event ended, stopping polling");
          setPollingActive(false);
        }
      } catch (error) {
        console.error("[PLAYER-POLL] Polling error:", error);
      }
    }, 1500); // Poll every 1.5 seconds

    return () => {
      console.log("[PLAYER-POLL] Cleaning up polling");
      clearInterval(pollInterval);
      setPollingActive(false);
    };
  }, [event?.id, event?.status, currentQuestionNumber]);

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log(`[PLAYER] Loading question #${questionNumber} for event ${eventId}`);
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      console.log("[PLAYER] Question loaded:", data);
      setCurrentQuestion(data);
    } catch (error) {
      console.error("[PLAYER] Failed to load question:", error);
      setCurrentQuestion(null);
    }
  };

  const handleAnswer = async (answer: boolean) => {
    if (!ticket || !event?.current_question_number || answered) return;

    try {
      await eventService.submitAnswer(ticket.id, event.current_question_number, answer);
      setAnswered(true);
      toast({
        title: "Answer Submitted",
        description: `You answered: ${answer ? "YES" : "NO"}`
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to submit answer",
        variant: "destructive"
      });
    }
  };

  if (!ticket) {
    return (
      <>
        <SEO title="Player - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-600 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-center text-3xl font-black">JOIN GAME</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Enter ticket serial number"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="text-center text-lg"
              />
              <Button onClick={handleJoin} className="w-full" size="lg">
                Join Game
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <SEO title="Player - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-600 p-4">
        {/* Enhanced Debug Info */}
        <div className="fixed top-2 right-2 text-xs text-white bg-black/70 px-3 py-2 rounded font-mono z-50 space-y-1 max-w-xs">
          <div className="font-bold text-yellow-300">🔍 REALTIME DEBUG</div>
          <div>event: {event?.id?.slice(0, 8) || "none"}</div>
          <div>q: {currentQuestionNumber || 0}</div>
          <div>status: {event?.status || "unknown"}</div>
          <div className={`font-bold ${subscriptionStatus === "connected" ? "text-green-400" : "text-red-400"}`}>
            sub: {subscriptionStatus}
          </div>
          <div className={`font-bold ${pollingActive ? "text-green-400" : "text-gray-400"}`}>
            poll: {pollingActive ? "active" : "inactive"}
          </div>
          <div className="border-t border-white/30 pt-1 mt-1">
            <div className="text-cyan-300">listening_to:</div>
            <div className="text-xs">events.current_question_number</div>
          </div>
          <div className="border-t border-white/30 pt-1 mt-1">
            <div className="text-cyan-300">last_received:</div>
            <div className="text-lg font-bold text-yellow-300">
              {lastReceivedQuestionNumber ?? "none"}
            </div>
          </div>
          <div className="border-t border-white/30 pt-1 mt-1 text-xs text-gray-300">
            Open browser console (F12) for detailed logs
          </div>
        </div>

        <div className="container mx-auto max-w-6xl space-y-4">
          {/* Ticket Controls */}
          <Card className="bg-white/95 backdrop-blur-sm">
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 flex items-center gap-2">
                  <Input
                    placeholder="Enter another ticket serial"
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleAddTicket()}
                    className="text-sm"
                    disabled={tickets.length >= 4}
                  />
                  <Button 
                    onClick={handleAddTicket} 
                    disabled={tickets.length >= 4 || !serialNumber.trim()}
                    size="sm"
                  >
                    Add Ticket ({tickets.length}/4)
                  </Button>
                </div>
                <Button 
                  onClick={handleClearTickets} 
                  variant="destructive" 
                  size="sm"
                >
                  Clear All
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Multi-Ticket Grid (2x2 layout for up to 4 tickets) */}
          <div className={`grid gap-4 ${tickets.length === 1 ? 'grid-cols-1 max-w-2xl mx-auto' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {tickets.map((ticket) => (
              <Card key={ticket.id} className="bg-white/95 backdrop-blur-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-center">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-600">Ticket</div>
                      <Button
                        onClick={() => handleRemoveTicket(ticket.id)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-red-600"
                      >
                        ×
                      </Button>
                    </div>
                    <div className={`font-black ${tickets.length === 1 ? 'text-2xl' : 'text-lg'}`}>
                      {ticket.serial_number}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Ticket 3x5 grid */}
                  <div className={`grid grid-cols-5 ${tickets.length === 1 ? 'gap-3' : 'gap-2'}`}>
                    {ticket.ticket_questions
                      ?.map((tq: any) => tq.question_number)
                      .sort((a: number, b: number) => a - b)
                      .map((num: number) => {
                        const isDrawn = currentQuestionNumber && num <= currentQuestionNumber;
                        return (
                          <div
                            key={num}
                            className={`aspect-square flex items-center justify-center rounded-lg font-black transition-all shadow-md ${
                              tickets.length === 1 ? 'text-3xl' : 'text-xl'
                            } ${
                              isDrawn
                                ? "bg-gradient-to-br from-green-500 to-green-600 text-white scale-105 shadow-lg"
                                : "bg-gradient-to-br from-purple-500 to-purple-600 text-white hover:scale-105"
                            }`}
                          >
                            {num}
                          </div>
                        );
                      })}
                  </div>
                  <div className={`mt-3 text-center ${tickets.length === 1 ? 'text-sm' : 'text-xs'} text-gray-600`}>
                    {ticket.ticket_questions?.filter((tq: any) => currentQuestionNumber && tq.question_number <= currentQuestionNumber).length || 0} / 15 drawn
                  </div>
                  
                  {/* Winner indicator for this ticket */}
                  {ticket.is_winner && (
                    <div className="mt-3 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-lg p-3 text-center">
                      <Trophy className={`${tickets.length === 1 ? 'w-12 h-12' : 'w-8 h-8'} text-white mx-auto mb-1`} />
                      <p className={`${tickets.length === 1 ? 'text-xl' : 'text-sm'} font-black text-white`}>WINNER!</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Current Question (shown once for all tickets) */}
          {currentQuestion && event?.status === "active" && (
            <Card className="bg-white/95 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-center">
                  <div className="text-sm text-gray-600">Question {currentQuestion.question_number}</div>
                  <div className="text-4xl font-black text-purple-600 my-4">
                    <Clock className="inline mr-2" />
                    {timeRemaining}s
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-6 bg-gray-50 rounded-lg text-center">
                  <p className="text-2xl font-bold">{currentQuestion.questions?.text}</p>
                </div>

                {!answered && timeRemaining > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      onClick={() => handleAnswer(true)}
                      size="lg"
                      className="h-24 text-2xl font-black bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle2 className="mr-2 w-8 h-8" />
                      YES
                    </Button>
                    <Button
                      onClick={() => handleAnswer(false)}
                      size="lg"
                      className="h-24 text-2xl font-black bg-red-600 hover:bg-red-700"
                    >
                      <XCircle className="mr-2 w-8 h-8" />
                      NO
                    </Button>
                  </div>
                ) : (
                  <div className="p-6 bg-gray-200 rounded-lg text-center">
                    <p className="text-xl font-bold text-gray-600">
                      {answered ? "Answer Submitted!" : "Time Expired"}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {event?.status !== "active" && (
            <Card className="bg-white/95 backdrop-blur-sm">
              <CardContent className="py-12 text-center">
                <p className="text-2xl font-bold text-gray-600">
                  {event?.status === "draft" ? "Event hasn't started yet" : "Event ended"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}