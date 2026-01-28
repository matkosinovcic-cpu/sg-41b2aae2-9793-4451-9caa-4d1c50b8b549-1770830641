import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
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

export default function AdminPanel() {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventQuestions, setEventQuestions] = useState<EventQuestion[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketStats, setTicketStats] = useState<TicketStats[]>([]);

  const [legacyAnswersCount, setLegacyAnswersCount] = useState<number>(0);
  const [isDeletingLegacy, setIsDeletingLegacy] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [ticketCount, setTicketCount] = useState(10);
  const [loading, setLoading] = useState(false);
  
  // CRITICAL: Continue mode state - defaults to FALSE for each event
  const [continueAfterWinner, setContinueAfterWinner] = useState<Record<string, boolean>>({});
  
  const { toast } = useToast();

  useEffect(() => {
    loadEvents();
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
      const result = await answerService.getEventTicketStats(eventId);
      console.log("[Admin] ✅ Loaded ticket stats:", result.length, "tickets");
      setTicketStats(result);
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

  const handleGenerateTickets = async (eventId: string) => {
    setLoading(true);
    try {
      await eventService.generateTickets(eventId, ticketCount);
      if (selectedEvent?.id === eventId) {
        await loadEventDetails(eventId);
      }
      toast({
        title: "Success",
        description: `${ticketCount} tickets generated successfully`,
      });
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
      await eventService.startEvent(eventId);
      
      // CRITICAL: Reset continue mode to OFF when starting event
      setContinueAfterWinner(prev => ({ ...prev, [eventId]: false }));
      
      await loadEvents();
      toast({
        title: "Success",
        description: "Event started",
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

  const handleDrawNextQuestion = async (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    
    // CRITICAL: Block draw if winner exists and continue mode is OFF
    if (event?.winner_ticket_id && !continueAfterWinner[eventId]) {
      toast({
        title: "Winner Found",
        description: "Winner exists. Click 'Continue After Winner' to keep drawing.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      await eventService.drawNextQuestion(eventId);
      await loadEvents();
      if (selectedEvent?.id === eventId) {
        const updatedEvent = await eventService.getEvent(eventId);
        setSelectedEvent(updatedEvent);
      }
      toast({
        title: "Success",
        description: "Question drawn",
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

  const handlePauseEvent = async (eventId: string) => {
    setLoading(true);
    try {
      await eventService.pauseEvent(eventId);
      await loadEvents();
      toast({
        title: "Success",
        description: "Event paused",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to pause event",
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
                                    onClick={() => handleGenerateTickets(event.id)}
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
                                <Button
                                  onClick={() => handleDrawNextQuestion(event.id)}
                                  disabled={
                                    loading ||
                                    (event.drawn_numbers?.length || 0) >= 90
                                  }
                                  variant="default"
                                  size="sm"
                                >
                                  <SkipForward className="w-4 h-4 mr-2" />
                                  Izvuci sljedeće pitanje
                                </Button>
                                
                                {event.winner_ticket_id && !continueAfterWinner[event.id] && (
                                  <Button
                                    onClick={() => handleContinueAfterWinner(event.id)}
                                    disabled={loading}
                                    variant="secondary"
                                    size="sm"
                                    className="bg-yellow-500 hover:bg-yellow-600 text-white"
                                  >
                                    <Trophy className="w-4 h-4 mr-2" />
                                    Continue After Winner
                                  </Button>
                                )}
                                
                                <Button
                                  onClick={() => handlePauseEvent(event.id)}
                                  disabled={loading}
                                  variant="secondary"
                                  size="sm"
                                >
                                  <Pause className="w-4 h-4 mr-2" />
                                  Pauziraj
                                </Button>
                              </>
                            )}

                            {event.status === "paused" && (
                              <Button
                                onClick={() => handleStartEvent(event.id)}
                                disabled={loading}
                                variant="default"
                                size="sm"
                              >
                                <Play className="w-4 h-4 mr-2" />
                                Nastavi
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