import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { eventService, Event, Ticket } from "@/services/eventService";
import { answerService, TicketStats } from "@/services/answerService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";
import { Play, Pause, SkipForward, Plus, Ticket as TicketIcon, Trophy } from "lucide-react";

export default function AdminPanel() {
  const { toast } = useToast();
  
  // Questions
  const [questionText, setQuestionText] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState<boolean>(true);
  const [questions, setQuestions] = useState<any[]>([]);

  // Events
  const [eventName, setEventName] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  
  // Tickets
  const [ticketCount, setTicketCount] = useState(10);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  
  // Stats
  const [ticketStats, setTicketStats] = useState<TicketStats[]>([]);
  
  // Loading states
  const [loading, setLoading] = useState(false);

  // Load data
  useEffect(() => {
    loadQuestions();
    loadEvents();
  }, []);

  useEffect(() => {
    if (selectedEvent) {
      loadTickets(selectedEvent.id);
      loadStats(selectedEvent.id);
    }
  }, [selectedEvent]);

  const loadQuestions = async () => {
    try {
      const data = await eventService.getAllQuestions();
      setQuestions(data);
    } catch (error: any) {
      console.error("Failed to load questions:", error);
    }
  };

  const loadEvents = async () => {
    try {
      const data = await eventService.getEvents();
      setEvents(data);
    } catch (error: any) {
      console.error("Failed to load events:", error);
    }
  };

  const loadTickets = async (eventId: string) => {
    try {
      const data = await eventService.getTickets(eventId);
      setTickets(data);
    } catch (error: any) {
      console.error("Failed to load tickets:", error);
    }
  };

  const loadStats = async (eventId: string) => {
    try {
      const data = await answerService.getEventTicketStats(eventId);
      setTicketStats(data);
    } catch (error: any) {
      console.error("Failed to load stats:", error);
    }
  };

  // Question actions
  const handleCreateQuestion = async () => {
    if (!questionText.trim()) {
      toast({
        title: "Error",
        description: "Molim unesite tekst pitanja",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      await eventService.createQuestion(questionText, correctAnswer);
      setQuestionText("");
      setCorrectAnswer(true);
      await loadQuestions();
      
      toast({
        title: "Success",
        description: "Pitanje kreirano"
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

  // Event actions
  const handleCreateEvent = async () => {
    if (!eventName.trim()) {
      toast({
        title: "Error",
        description: "Molim unesite naziv eventa",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const event = await eventService.createEvent(eventName);
      setEventName("");
      await loadEvents();
      setSelectedEvent(event);
      
      toast({
        title: "Success",
        description: "Event kreiran"
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

  const handleGenerateQuestions = async (eventId: string) => {
    setLoading(true);
    try {
      const result = await eventService.generateEventQuestions(eventId);
      
      toast({
        title: "Success",
        description: `Generirano ${result.count} pitanja (od ${result.total} dostupnih)`
      });
      
      await loadEvents();
      if (selectedEvent?.id === eventId) {
        const updated = await eventService.getEvent(eventId);
        setSelectedEvent(updated);
      }
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

  const handleGenerateTickets = async (eventId: string) => {
    setLoading(true);
    try {
      await eventService.generateTickets(eventId, ticketCount);
      await loadTickets(eventId);
      
      toast({
        title: "Success",
        description: `Generirano ${ticketCount} ulaznica`
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

  const handleStartEvent = async (eventId: string) => {
    setLoading(true);
    try {
      await eventService.startEvent(eventId);
      await loadEvents();
      
      if (selectedEvent?.id === eventId) {
        const updated = await eventService.getEvent(eventId);
        setSelectedEvent(updated);
      }
      
      toast({
        title: "Success",
        description: "Event pokrenut"
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
      console.log("[ADMIN] Drawing question for event:", eventId);
      
      const result = await eventService.drawNextQuestion(eventId);
      
      console.log("[ADMIN] Question drawn:", result.drawnNumber);
      
      await loadEvents();
      
      if (selectedEvent?.id === eventId) {
        const updated = await eventService.getEvent(eventId);
        setSelectedEvent(updated);
      }
      
      toast({
        title: "Success",
        description: `Pitanje #${result.drawnNumber} izvučeno`
      });
    } catch (error: any) {
      console.error("[ADMIN] Draw failed:", error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEO title="Admin Panel - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
        <div className="container mx-auto max-w-7xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-white mb-2">
              PITALICA SKITALICA - ADMIN
            </h1>
            <p className="text-white/60">Upravljanje sistemom</p>
          </div>

          <Tabs defaultValue="events" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="questions">Pitanja</TabsTrigger>
              <TabsTrigger value="events">Eventi</TabsTrigger>
              <TabsTrigger value="tickets">Ulaznice</TabsTrigger>
            </TabsList>

            {/* Questions Tab */}
            <TabsContent value="questions">
              <Card>
                <CardHeader>
                  <CardTitle>Kreiraj Pitanje</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    placeholder="Tekst pitanja"
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                  />
                  
                  <div className="flex gap-4">
                    <Button
                      variant={correctAnswer ? "default" : "outline"}
                      onClick={() => setCorrectAnswer(true)}
                      className="flex-1"
                    >
                      Točan odgovor: DA
                    </Button>
                    <Button
                      variant={!correctAnswer ? "default" : "outline"}
                      onClick={() => setCorrectAnswer(false)}
                      className="flex-1"
                    >
                      Točan odgovor: NE
                    </Button>
                  </div>

                  <Button
                    onClick={handleCreateQuestion}
                    disabled={loading || !questionText.trim()}
                    className="w-full"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Dodaj Pitanje
                  </Button>

                  <div className="text-sm text-gray-600">
                    Ukupno pitanja u pool-u: {questions.length}
                  </div>
                </CardContent>
              </Card>

              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sva Pitanja ({questions.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {questions.map((q) => (
                      <div
                        key={q.id}
                        className="p-3 bg-gray-50 rounded border flex justify-between items-center"
                      >
                        <span className="flex-1">{q.text}</span>
                        <Badge variant={q.correct_answer ? "default" : "destructive"}>
                          {q.correct_answer ? "DA" : "NE"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Events Tab */}
            <TabsContent value="events">
              <Card>
                <CardHeader>
                  <CardTitle>Kreiraj Event</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    placeholder="Naziv eventa"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                  />
                  <Button
                    onClick={handleCreateEvent}
                    disabled={loading || !eventName.trim()}
                    className="w-full"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Kreiraj Event
                  </Button>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                {events.map((event) => (
                  <Card
                    key={event.id}
                    className={selectedEvent?.id === event.id ? "ring-2 ring-blue-500" : ""}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{event.name}</CardTitle>
                        <Badge
                          variant={
                            event.status === "active"
                              ? "default"
                              : event.status === "finished"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {event.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <div className="text-gray-500">Status</div>
                          <Badge variant={
                            event.status === "active" ? "default" :
                            event.status === "finished" ? "secondary" :
                            "outline"
                          }>
                            {event.status}
                          </Badge>
                        </div>
                        <div>
                          <div className="text-gray-500">Pitanje</div>
                          <div className="font-semibold">
                            {lastDrawnNumber || 0} / {totalQuestions || 90}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500">Izvučeno</div>
                          <div className="font-semibold">{questionIndex}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Tiketa</div>
                          <div className="font-semibold">{ticketCount}</div>
                        </div>
                      </div>

                      {event.winner_ticket_id && (
                        <div className="bg-yellow-100 border border-yellow-400 rounded p-2 flex items-center gap-2">
                          <Trophy className="w-4 h-4 text-yellow-600" />
                          <span className="text-sm font-bold text-yellow-900">
                            POBJEDNIK: {event.winner_ticket_id.slice(-4)}
                          </span>
                        </div>
                      )}

                      <div className="flex flex-col gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedEvent(event)}
                        >
                          Odaberi Event
                        </Button>

                        {event.status === "draft" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleGenerateQuestions(event.id)}
                              disabled={loading}
                            >
                              Generiraj 90 Pitanja
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleStartEvent(event.id)}
                              disabled={loading}
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Pokreni Event
                            </Button>
                          </>
                        )}

                        {event.status === "active" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleDrawNextQuestion(event.id)}
                              disabled={loading}
                            >
                              <SkipForward className="w-4 h-4 mr-2" />
                              Izvuci Sljedeće Pitanje
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePauseEvent(event.id)}
                              disabled={loading}
                            >
                              <Pause className="w-4 h-4 mr-2" />
                              Pauziraj
                            </Button>
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
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Tickets Tab */}
            <TabsContent value="tickets">
              {selectedEvent ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Generiraj Ulaznice - {selectedEvent.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Input
                        type="number"
                        placeholder="Broj ulaznica"
                        value={ticketCount}
                        onChange={(e) => setTicketCount(parseInt(e.target.value) || 0)}
                        min={1}
                        max={100}
                      />
                      <Button
                        onClick={() => handleGenerateTickets(selectedEvent.id)}
                        disabled={loading || ticketCount < 1}
                        className="w-full"
                      >
                        <TicketIcon className="w-4 h-4 mr-2" />
                        Generiraj {ticketCount} Ulaznica
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="mt-6">
                    <CardHeader>
                      <CardTitle>Ulaznice ({tickets.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {tickets.map((ticket) => {
                          const stats = ticketStats.find(s => s.ticket_id === ticket.id);
                          
                          return (
                            <Card key={ticket.id} className={ticket.is_winner ? "border-4 border-yellow-400" : ""}>
                              <CardContent className="pt-4">
                                <div className="flex items-center justify-between mb-2">
                                  <Badge>{ticket.serial_number}</Badge>
                                  {ticket.is_winner && (
                                    <Trophy className="w-5 h-5 text-yellow-500" />
                                  )}
                                </div>
                                
                                {stats && (
                                  <div className="grid grid-cols-3 gap-2 text-xs mt-2">
                                    <div className="text-center">
                                      <div className="font-bold text-green-600">{stats.correct}</div>
                                      <div className="text-gray-500">Točno</div>
                                    </div>
                                    <div className="text-center">
                                      <div className="font-bold text-red-600">{stats.incorrect}</div>
                                      <div className="text-gray-500">Netočno</div>
                                    </div>
                                    <div className="text-center">
                                      <div className="font-bold text-blue-600">{stats.percentage}%</div>
                                      <div className="text-gray-500">Točnost</div>
                                    </div>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-gray-500">
                    Odaberi event da vidiš ulaznice
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <Toaster />
    </>
  );
}