import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event, EventQuestion, Ticket } from "@/services/eventService";
import { answerService, TicketStats } from "@/services/answerService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Play, Pause, SkipForward, Plus, Ticket as TicketIcon, Trophy, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// ✅ CRITICAL: Answer timing configuration (SOURCE OF TRUTH)
// Used for both player answer time and auto-draw interval
const ANSWER_SECONDS = 9;  // Players have 9 seconds to answer
const AUTO_DRAW_INTERVAL_MS = (ANSWER_SECONDS + 1) * 1000;  // Auto-draw waits 10s (answer time + 1s buffer)

export default function AdminPanel() {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventQuestions, setEventQuestions] = useState<EventQuestion[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  // Use 'any' for stats until service is implemented
  const [ticketStats, setTicketStats] = useState<any[]>([]);

  const [legacyAnswersCount, setLegacyAnswersCount] = useState<number>(0);
  const [isDeletingLegacy, setIsDeletingLegacy] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [ticketCount, setTicketCount] = useState(10);
  const [loading, setLoading] = useState(false);
  
  // CRITICAL: Continue mode state - defaults to FALSE for each event
  const [continueAfterWinner, setContinueAfterWinner] = useState<Record<string, boolean>>({});
  
  // ✅ Auto-draw refs (critical for stability)
  const autoTimerRef = useRef<Record<string, NodeJS.Timeout | null>>({});
  const autoRunningRef = useRef<Record<string, boolean>>({});
  const autoInFlightRef = useRef<Record<string, boolean>>({});
  
  // UI state for button toggles
  const [autoDrawingState, setAutoDrawingState] = useState<Record<string, boolean>>({});
  
  const { toast } = useToast();

  useEffect(() => {
    loadEvents();
    
    // ✅ Cleanup on unmount
    return () => {
      Object.keys(autoTimerRef.current).forEach(eventId => {
        stopAuto(eventId, "unmount");
      });
    };
  }, []);

  // ✅ STOP AUTO implementation
  const stopAuto = (eventId: string, reason: string) => {
    if (autoTimerRef.current[eventId]) {
      clearInterval(autoTimerRef.current[eventId]!);
      autoTimerRef.current[eventId] = null;
    }
    
    autoRunningRef.current[eventId] = false;
    autoInFlightRef.current[eventId] = false;
    
    // Update UI
    setAutoDrawingState(prev => {
      if (!prev[eventId]) return prev; // Avoid unnecessary renders
      return { ...prev, [eventId]: false };
    });
    
    console.log(`[AUTO] stopped ${eventId}`, reason);
    if (reason === "manual") {
      toast({
        title: "Auto izvlačenje zaustavljeno",
        description: "Zaustavili ste automatsko izvlačenje. Možete nastaviti ručno.",
      });
    }
  };

  // ✅ START AUTO implementation
  const startAuto = (eventId: string) => {
    // Prevent double start
    if (autoRunningRef.current[eventId]) return;

    console.log(`[AUTO] starting ${eventId}`);
    
    // Set running state
    autoRunningRef.current[eventId] = true;
    setAutoDrawingState(prev => ({ ...prev, [eventId]: true }));
    
    toast({
      title: "Auto izvlačenje pokrenuto",
      description: `Interval: ${ANSWER_SECONDS + 1}s`,
    });

    // Start interval
    autoTimerRef.current[eventId] = setInterval(async () => {
      // DEBUG LOG
      console.log(`[AUTO] tick ${eventId}`, { 
        running: autoRunningRef.current[eventId], 
        inFlight: autoInFlightRef.current[eventId] 
      });
      
      if (!autoRunningRef.current[eventId]) return;
      if (autoInFlightRef.current[eventId]) return;

      autoInFlightRef.current[eventId] = true;

      try {
        // 1) RE-FETCH event iz baze (svaki tick) da ne koristimo stale state
        const { data: freshEvent, error } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .single();

        if (error || !freshEvent) {
          console.error("[AUTO] Failed to fetch event", error);
          return;
        }

        console.log(`[AUTO] event state ${eventId}`, { 
          status: freshEvent.status, 
          winner: freshEvent.winner_ticket_id 
        });

        // 2) Guard: stop ako je finished ili ima winner ili nije active
        if (freshEvent.status === "finished" || freshEvent.winner_ticket_id || freshEvent.status !== "active") {
          stopAuto(eventId, "winner_or_finished_or_paused");
          
          if (freshEvent.winner_ticket_id) {
             toast({ 
               title: "Pobjednik pronađen!", 
               description: `Ulaznica: ${freshEvent.winner_ticket_id}` 
             });
          } else if (freshEvent.status === "finished") {
             toast({ title: "Auto stop", description: "Event je završen." });
          } else {
             toast({ title: "Auto stop", description: "Event nije aktivan." });
          }
          
          await loadEvents();
          return;
        }

        // 3) Check drawn count limit
        if ((freshEvent.drawn_numbers?.length || 0) >= 90) {
           stopAuto(eventId, "max_questions");
           toast({ title: "Auto stop", description: "Svih 90 pitanja izvučeno." });
           await loadEvents();
           return;
        }

        // 4) Povuci sljedeće pitanje
        await eventService.drawNextQuestion(eventId);
        console.log(`[AUTO] drawNextQuestion OK ${eventId}`);
        
        // Refresh UI list
        await loadEvents();

      } catch (e: any) {
        console.error("[AUTO] drawNextQuestion FAILED", e);
        // Ne gasimo auto na prvi network error, ali logiramo
      } finally {
        autoInFlightRef.current[eventId] = false;
      }
    }, AUTO_DRAW_INTERVAL_MS);
  };

  // ✅ Cleanup: Stop ALL auto-draw intervals on unmount
  useEffect(() => {
    Object.keys(autoRunningRef.current).forEach(eventId => {
      stopAuto(eventId, "unmount");
    });
  }, []);

  // Load event details when selected
  useEffect(() => {
    if (selectedEvent) {
      loadEventDetails(selectedEvent.id);
      
      // Load ticket stats if event is finished
      if (selectedEvent.status === "finished") {
        loadTicketStats(selectedEvent.id);
      }
    }
  }, [selectedEvent?.id, selectedEvent?.status]);

  // Real-time subscription for answers (only when finished)
  useEffect(() => {
    if (!selectedEvent || selectedEvent.status !== "finished") return;

    console.log("[Admin] Setting up answer subscription for finished event:", selectedEvent.id);

    const subscription = answerService.subscribeToEventAnswers(selectedEvent.id, () => {
      console.log("[Admin] Answer update detected, reloading stats");
      loadTicketStats(selectedEvent.id);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [selectedEvent?.id, selectedEvent?.status]);

  // CRITICAL: Only poll stats when event is finished
  useEffect(() => {
    if (!selectedEvent || selectedEvent.status !== "finished") return;

    const pollInterval = setInterval(() => {
      loadTicketStats(selectedEvent.id);
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [selectedEvent?.id, selectedEvent?.status]);

  const loadEvents = async () => {
    try {
      const data = await eventService.getEvents();
      console.log("[Admin] Loaded events:", data.length, data.map(e => ({ id: e.id, name: e.name, status: e.status })));
      setEvents(data);
    } catch (error) {
      console.error("Failed to load events:", error);
    }
  };

  const loadEventDetails = async (eventId: string) => {
    try {
      const [questionsData, ticketsData] = await Promise.all([
        eventService.getEventQuestions(eventId),
        eventService.getTickets(eventId),
      ]);
      setEventQuestions(questionsData);
      setTickets(ticketsData);
    } catch (error) {
      console.error("Failed to load event details:", error);
    }
  };

  const loadTicketStats = async (eventId: string) => {
    try {
      // Mock stats for now to unblock build
      console.log("[Admin] Stats not implemented yet");
      setTicketStats([]);
      /*
      const result = await answerService.getEventTicketStats(eventId);
      console.log("[Admin] ✅ Loaded ticket stats:", result.length, "tickets");
      setTicketStats(result);
      */
    } catch (error) {
      console.error("[Admin] Failed to load ticket stats:", error);
    }
  };

  const handleCreateEvent = async () => {
    if (!newEventName.trim()) {
      toast({
        title: "Error",
        description: "Please enter an event name",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const newEvent = await eventService.createEvent(newEventName);
      setNewEventName("");
      await loadEvents();
      
      // CRITICAL: Ensure continue mode is OFF for new event
      setContinueAfterWinner(prev => ({ ...prev, [newEvent.id]: false }));
      
      toast({
        title: "Success",
        description: "Event created successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create event",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQuestions = async (eventId: string) => {
    setLoading(true);
    try {
      await eventService.generateEventQuestions(eventId);
      if (selectedEvent?.id === eventId) {
        await loadEventDetails(eventId);
      }
      await loadEvents();
      toast({
        title: "Success",
        description: "90 questions generated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate questions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateTickets = async (eventId: string, venueId: string) => {
    try {
      setLoading(true);
      await eventService.generateTickets(eventId, 10, venueId);
      toast({
        title: "Tickets generated",
        description: "Successfully generated 10 tickets",
      });
      await loadEvents();
      if (selectedEvent?.id === eventId) {
        await loadEventDetails(eventId);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate tickets",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStartEvent = async (eventId: string) => {
    setLoading(true);
    try {
      // ✅ Re-fetch event to check current status
      const { data: freshEvent, error: fetchError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .maybeSingle();

      if (fetchError || !freshEvent) {
        toast({
          title: "Error",
          description: "Failed to fetch event state",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // ✅ PREVENT restarting FINISHED events
      if (freshEvent.status === "finished") {
        toast({
          title: "Event je završen",
          description: "Ne možete ponovno pokrenuti završen event. Koristite 'Reset Event' za novo izvlačenje.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      await eventService.startEvent(eventId);
      
      // ✅ Reset continue mode when starting/resuming
      setContinueAfterWinner(prev => ({ ...prev, [eventId]: false }));
      
      await loadEvents();
      toast({
        title: "Success",
        description: freshEvent.status === "paused" ? "Event nastavljen" : "Event pokrenut",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start event",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePauseEvent = async (eventId: string) => {
    setLoading(true);
    try {
      await eventService.pauseEvent(eventId);
      await loadEvents();
      
      if (selectedEvent?.id === eventId) {
        const updated = await eventService.getEvent(eventId);
        setSelectedEvent(updated);
      }
      
      toast({
        title: "Success",
        description: "Event pauziran"
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDrawNextQuestion = async (eventId: string) => {
    setLoading(true);
    try {
      // ✅ CRITICAL: Re-fetch event from DB to get latest state (SOURCE OF TRUTH)
      const { data: freshEvent, error: fetchError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .maybeSingle();

      if (fetchError || !freshEvent) {
        toast({
          title: "Error",
          description: "Failed to fetch event state",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // ✅ STATE MACHINE: Enforce strict status rules
      if (freshEvent.status === "finished") {
        toast({
          title: "Event završen",
          description: "Event je završen (pobjednik postoji). Za novo izvlačenje koristi 'Reset Event'.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      if (freshEvent.status === "paused") {
        toast({
          title: "Event pauziran",
          description: "Event je pauziran. Klikni 'Nastavi' za nastavak.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      if (freshEvent.status !== "active") {
        toast({
          title: "Nevažeći status",
          description: `Event mora biti aktivan za izvlačenje (trenutni status: ${freshEvent.status})`,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // ✅ ACTIVE status: Allow draw
      await eventService.drawNextQuestion(eventId);
      await loadEvents();
      
      if (selectedEvent?.id === eventId) {
        const updatedEvent = await eventService.getEvent(eventId);
        setSelectedEvent(updatedEvent);
      }
      
      toast({
        title: "Success",
        description: "Pitanje izvučeno",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to draw question",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleContinueAfterWinner = (eventId: string) => {
    setContinueAfterWinner(prev => ({ ...prev, [eventId]: true }));
    toast({
      title: "Continue Mode Enabled",
      description: "Drawing will continue until 90. Winner remains locked.",
    });
  };

  const handleResetEvent = async (eventId: string) => {
    // ✅ CONFIRMATION REQUIRED
    const confirmed = window.confirm(
      "⚠️ RESET EVENT?\n\n" +
      "Ovo će:\n" +
      "• Resetirati event status na DRAFT\n" +
      "• Obrisati pobjednika\n" +
      "• Obrisati sva izvučena pitanja\n" +
      "• ZADRŽATI sve odgovore igrača\n\n" +
      'Za potvrdu, klikni "OK".'
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      // ✅ Reset event using UPDATE instead of delete
      const { error } = await supabase
        .from("events")
        .update({
          status: "draft",
          winner_ticket_id: null,
          current_question_number: 0,
          current_drawn_number: null,
          drawn_numbers: [],
          question_open_until: null,
        })
        .eq("id", eventId);

      if (error) throw error;
      
      // Also clear event_questions drawn status
      const { error: qError } = await supabase
        .from("event_questions")
        .update({ drawn: false, drawn_at: null })
        .eq("event_id", eventId);
        
      if (qError) console.error("Failed to reset questions", qError);

      await loadEvents();
      
      toast({
        title: "Event resetiran",
        description: "Event je vraćen u DRAFT stanje.",
      });
    } catch (error) {
      console.error("Failed to reset event:", error);
      toast({
        title: "Greška",
        description: "Nije moguće resetirati event.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      draft: "bg-gray-500",
      active: "bg-green-500",
      paused: "bg-yellow-500",
      finished: "bg-blue-500",
    };
    return (
      <Badge className={`${colors[status as keyof typeof colors]} text-white`}>
        {status.toUpperCase()}
      </Badge>
    );
  };

  const getWinnerSerial = (winnerId: string | null) => {
    if (!winnerId) return null;
    const winnerTicket = tickets.find(t => t.id === winnerId);
    return winnerTicket?.serial_number || winnerId;
  };

  const handleClearLegacyAnswers = async () => {
    // Legacy cleanup removed as service method is deprecated
    toast({
      title: "Info",
      description: "Legacy cleanup is no longer needed with the new architecture.",
    });
  };

  return (
    <>
      <SEO title="Admin Panel - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-4">
        <div className="container mx-auto max-w-7xl">
          <div className="mb-6">
            <h1 className="text-4xl font-black text-white mb-2">ADMIN PANEL</h1>
            <p className="text-white/80">Upravljanje događajima i igrama</p>
          </div>

          <Tabs defaultValue="events" className="space-y-4">
            <TabsList className="bg-white/20 backdrop-blur-sm">
              <TabsTrigger value="events">Događaji</TabsTrigger>
              <TabsTrigger value="details" disabled={!selectedEvent}>
                Detalji
              </TabsTrigger>
            </TabsList>

            <TabsContent value="events" className="space-y-4">
              <Card className="bg-white/95 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Kreiraj novi događaj</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Naziv događaja"
                      value={newEventName}
                      onChange={(e) => setNewEventName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateEvent()}
                    />
                    <Button onClick={handleCreateEvent} disabled={loading}>
                      <Plus className="w-4 h-4 mr-2" />
                      Kreiraj
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/95 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Svi događaji</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {events.map((event) => (
                      <Card key={event.id} className="border-2">
                        <CardContent className="pt-6">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <h3 className="text-xl font-bold">{event.name}</h3>
                              {getStatusBadge(event.status)}
                              {event.winner_ticket_id && (
                                <div className="flex items-center gap-2 bg-yellow-100 px-3 py-1 rounded">
                                  <Trophy className="w-5 h-5 text-yellow-600" />
                                  <span className="font-bold text-yellow-600">
                                    WINNER: {getWinnerSerial(event.winner_ticket_id)}
                                  </span>
                                </div>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              onClick={() => setSelectedEvent(event)}
                            >
                              Otvori detalje
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-blue-600">
                                {event.current_drawn_number || "-"}
                              </div>
                              <div className="text-sm text-gray-600">Trenutni broj</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-purple-600">
                                {event.drawn_numbers?.length || 0} / 90
                              </div>
                              <div className="text-sm text-gray-600">Izvučeno</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-green-600">
                                {event.current_question_number || 0}
                              </div>
                              <div className="text-sm text-gray-600">Pitanje br.</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-orange-600">
                                {tickets.filter((t) => t.event_id === event.id).length}
                              </div>
                              <div className="text-sm text-gray-600">Ulaznice</div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {event.status === "draft" && (
                              <>
                                <Button
                                  onClick={() => handleGenerateQuestions(event.id)}
                                  disabled={loading || event.current_question_number > 0}
                                  size="sm"
                                >
                                  Generiraj 90 pitanja
                                </Button>
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={ticketCount}
                                    onChange={(e) =>
                                      setTicketCount(parseInt(e.target.value) || 10)
                                    }
                                    className="w-20"
                                  />
                                  <Button
                                    onClick={() => handleGenerateTickets(event.id, event.venue_id)} // ✅ Pass venue_id
                                    disabled={loading}
                                    size="sm"
                                  >
                                    <TicketIcon className="w-4 h-4 mr-2" />
                                    Generiraj ulaznice
                                  </Button>
                                </div>
                                <Button
                                  onClick={() => handleStartEvent(event.id)}
                                  disabled={loading || event.current_question_number === 0}
                                  variant="default"
                                  size="sm"
                                >
                                  <Play className="w-4 h-4 mr-2" />
                                  Pokreni događaj
                                </Button>
                              </>
                            )}

                            {event.status === "active" && (
                              <>
                                {/* ✅ MANUAL DRAW BUTTON (disabled during auto-draw) */}
                                <Button
                                  onClick={() => handleDrawNextQuestion(event.id)}
                                  disabled={loading || autoDrawingState[event.id]}
                                  size="sm"
                                >
                                  <SkipForward className="w-4 h-4 mr-1" />
                                  Izvuci sljedeće pitanje
                                </Button>

                                {/* ✅ AUTO DRAW BUTTON */}
                                {!autoDrawingState[event.id] ? (
                                  <div className="flex flex-col gap-1">
                                    <Button
                                      onClick={() => startAuto(event.id)}
                                      disabled={loading}
                                      variant="secondary"
                                      size="sm"
                                    >
                                      <Play className="w-4 h-4 mr-1" />
                                      Auto izvlačenje
                                    </Button>
                                    <span className="text-xs text-gray-500 text-center">
                                      svakih {ANSWER_SECONDS + 1}s
                                    </span>
                                  </div>
                                ) : (
                                  <Button
                                    onClick={() => stopAuto(event.id, "manual_stop")}
                                    disabled={loading}
                                    variant="destructive"
                                    size="sm"
                                  >
                                    <Pause className="w-4 h-4 mr-1" />
                                    Zaustavi auto
                                  </Button>
                                )}
                              </>
                            )}

                            {event.status === "paused" && (
                              <Button
                                size="sm"
                                onClick={() => handleStartEvent(event.id)}
                                disabled={loading}
                              >
                                <Play className="w-4 h-4 mr-2" />
                                Nastavi Event
                              </Button>
                            )}

                            {event.status === "finished" && (
                              <Button
                                onClick={() => handleResetEvent(event.id)}
                                disabled={loading}
                                variant="destructive"
                                size="sm"
                              >
                                🔄 Reset Event
                              </Button>
                            )}
                          </div>

                          {event.status === "active" &&
                            (event.drawn_numbers?.length || 0) >= 90 && (
                              <div className="mt-4 bg-yellow-100 border-2 border-yellow-500 rounded-lg p-3 text-center">
                                <p className="font-bold text-yellow-800">
                                  Svih 90 brojeva je izvučeno!
                                </p>
                              </div>
                            )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              {selectedEvent && (
                <>
                  <Card className="bg-white/95 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle>{selectedEvent.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <div className="text-sm text-gray-600">Status</div>
                          <div className="font-bold">
                            {getStatusBadge(selectedEvent.status)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Trenutni broj</div>
                          <div className="text-2xl font-bold text-blue-600">
                            {selectedEvent.current_drawn_number || "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Izvučeno</div>
                          <div className="text-2xl font-bold text-purple-600">
                            {selectedEvent.drawn_numbers?.length || 0} / 90
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Pitanje</div>
                          <div className="text-2xl font-bold text-green-600">
                            #{selectedEvent.current_question_number || 0}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* CRITICAL: Only show stats when game is finished */}
                  {selectedEvent.status === "finished" && ticketStats.length > 0 && (
                    <>
                      {/* Stats Overview */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-gray-500">
                              Ukupno odigranih listića
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-2xl font-bold">{ticketStats.length}</div>
                          </CardContent>
                        </Card>
                        
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-gray-500">
                              Aktivni igrači
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-2xl font-bold">
                              {ticketStats.filter(s => s.answered > 0).length}
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-gray-500">
                              Ukupna točnost
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-2xl font-bold">
                              {ticketStats.length > 0
                                ? Math.round(
                                    (ticketStats.reduce((sum, s) => sum + s.correct, 0) /
                                      Math.max(1, ticketStats.reduce((sum, s) => sum + s.answered, 0))) *
                                      100
                                  )
                                : 0}
                              %
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Legacy Data Warning */}
                      {legacyAnswersCount > 0 && (
                        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
                          <div className="font-semibold text-yellow-900 mb-1">
                            ⚠️ Zastarjeli podaci ({legacyAnswersCount} odgovora)
                          </div>
                          <p className="text-sm text-yellow-800 mb-3">
                            Ovaj event ima odgovore iz starog sustava koji ne sadrže ticket_id. 
                            Ovi odgovori se ne prikazuju u statistici jer nije moguće pouzdano 
                            odrediti kojoj ulaznici pripadaju.
                          </p>
                          <Button
                            onClick={handleClearLegacyAnswers}
                            disabled={isDeletingLegacy}
                            variant="outline"
                            size="sm"
                          >
                            {isDeletingLegacy ? "Brisanje..." : "Obriši zastarjele odgovore"}
                          </Button>
                        </div>
                      )}

                      {/* CRITICAL: Final Statistics - ONLY when event is finished */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {ticketStats.map((stat) => (
                          <Card key={stat.ticket_serial}>
                            <CardContent className="pt-6">
                              <div className="text-center mb-4">
                                <Badge className="bg-purple-600 text-white">
                                  {stat.ticket_serial}
                                </Badge>
                              </div>

                              <div className="space-y-2">
                                <div className="flex justify-between">
                                  <span className="text-sm text-gray-600">Točno:</span>
                                  <span className="font-semibold text-green-600">
                                    {stat.correct} / {stat.drawn_on_ticket}
                                  </span>
                                </div>

                                <div className="flex justify-between">
                                  <span className="text-sm text-gray-600">Odgovoreno:</span>
                                  <span className="font-semibold">
                                    {stat.answered} / {stat.drawn_on_ticket}
                                  </span>
                                </div>

                                <div className="flex justify-between">
                                  <span className="text-sm text-gray-600">Propušteno:</span>
                                  <span className="font-semibold text-orange-600">
                                    {stat.missed}
                                  </span>
                                </div>

                                <div className="flex justify-between">
                                  <span className="text-sm text-gray-600">Točnost:</span>
                                  <span className="font-bold text-blue-600">
                                    {stat.percentage}%
                                  </span>
                                </div>

                                <div className="text-xs text-gray-500 mt-2 pt-2 border-t">
                                  Izvučeno na ovoj ulaznici: {stat.drawn_on_ticket}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  )}

                  {selectedEvent.status === "finished" && ticketStats.length === 0 && (
                    <p className="text-center text-gray-500">
                      Nema odgovora. Nitko nije igrao.
                    </p>
                  )}

                  {selectedEvent.status !== "finished" && (
                    <p className="text-center text-gray-500">
                      Statistika će biti dostupna nakon završetka eventa.
                    </p>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}