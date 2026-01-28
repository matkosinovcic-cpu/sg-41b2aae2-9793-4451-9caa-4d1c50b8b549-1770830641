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
import { Play, Pause, SkipForward, Plus, Ticket as TicketIcon, Trophy, CheckCircle, XCircle } from "lucide-react";

export default function AdminPanel() {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventQuestions, setEventQuestions] = useState<EventQuestion[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketStats, setTicketStats] = useState<TicketStats[]>([]);
  const [newEventName, setNewEventName] = useState("");
  const [ticketCount, setTicketCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    if (selectedEvent) {
      loadEventDetails(selectedEvent.id);
      loadTicketStats(selectedEvent.id);
    }
  }, [selectedEvent?.id]);

  // Real-time subscription for answers
  useEffect(() => {
    if (!selectedEvent) return;

    const subscription = answerService.subscribeToEventAnswers(selectedEvent.id, () => {
      loadTicketStats(selectedEvent.id);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [selectedEvent?.id]);

  // Polling for stats updates
  useEffect(() => {
    if (!selectedEvent || selectedEvent.status !== "active") return;

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
      const stats = await answerService.getEventTicketStats(eventId);
      setTicketStats(stats);
    } catch (error) {
      console.error("Failed to load ticket stats:", error);
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
      await eventService.createEvent(newEventName);
      setNewEventName("");
      await loadEvents();
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
                              {event.winner_ticket_serial && (
                                <div className="flex items-center gap-2 bg-yellow-100 px-3 py-1 rounded">
                                  <Trophy className="w-5 h-5 text-yellow-600" />
                                  <span className="font-bold text-yellow-600">
                                    Winner: {event.winner_ticket_serial}
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
                                    (event.drawn_numbers?.length || 0) >= 90 ||
                                    !!event.winner_ticket_serial
                                  }
                                  variant="default"
                                  size="sm"
                                >
                                  <SkipForward className="w-4 h-4 mr-2" />
                                  Izvuci sljedeće pitanje
                                </Button>
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

                  <Card className="bg-white/95 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle>Statistika igrača</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {ticketStats.length === 0 ? (
                        <p className="text-gray-600 text-center py-4">
                          Nema odgovora još. Čekamo da igrači odgovore...
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {ticketStats.map((stat) => (
                            <Card key={stat.ticket_serial} className="border-2">
                              <CardContent className="pt-4">
                                <div className="text-center mb-3">
                                  <Badge className="bg-purple-600 text-white">
                                    {stat.ticket_serial}
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-center gap-4">
                                  <div className="flex items-center gap-2">
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                    <span className="text-2xl font-black text-green-600">
                                      {stat.correct}
                                    </span>
                                  </div>
                                  <span className="text-2xl font-bold text-gray-400">
                                    /
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl font-black text-gray-600">
                                      {stat.answered}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-center mt-2 text-sm text-gray-600">
                                  {stat.answered > 0
                                    ? `${Math.round((stat.correct / stat.answered) * 100)}% točno`
                                    : "Nema odgovora"}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-white/95 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle>Ulaznice ({tickets.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {tickets.map((ticket) => (
                          <Card key={ticket.id} className="border-2">
                            <CardContent className="pt-4">
                              <div className="text-center mb-2">
                                <Badge className="bg-blue-600 text-white">
                                  {ticket.serial_number}
                                </Badge>
                                {ticket.is_winner && (
                                  <div className="flex items-center justify-center gap-2 mt-2">
                                    <Trophy className="w-6 h-6 text-yellow-500" />
                                    <span className="text-lg font-black text-yellow-600">
                                      POBJEDNIK!
                                    </span>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white/95 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle>Pitanja događaja ({eventQuestions.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {eventQuestions.map((eq) => (
                          <div
                            key={eq.id}
                            className={`p-3 rounded border-2 ${
                              eq.question_number === selectedEvent.current_question_number
                                ? "border-green-500 bg-green-50"
                                : "border-gray-200"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <Badge
                                className={
                                  eq.question_number ===
                                  selectedEvent.current_question_number
                                    ? "bg-green-600"
                                    : "bg-gray-600"
                                }
                              >
                                #{eq.question_number}
                              </Badge>
                              <span className="font-semibold">
                                {eq.questions?.text}
                              </span>
                              <Badge variant="outline">
                                {eq.questions?.correct_answer}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}