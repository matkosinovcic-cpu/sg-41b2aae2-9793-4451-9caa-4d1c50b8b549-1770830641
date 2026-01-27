import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { eventService, Event, Question } from "@/services/eventService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, SkipForward, Plus, Ticket, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminPanel() {
  const [questionText, setQuestionText] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState<boolean>(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [eventName, setEventName] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [ticketCount, setTicketCount] = useState("100");
  const [eventTickets, setEventTickets] = useState<any[]>([]);
  const [currentDrawnQuestion, setCurrentDrawnQuestion] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadQuestions();
    loadEvents();
  }, []);

  useEffect(() => {
    if (selectedEvent) {
      loadEventTickets(selectedEvent.id);
      const subscription = eventService.subscribeToEvent(selectedEvent.id, () => {
        loadEvents();
      });
      return () => {
        subscription.unsubscribe();
      };
    }
  }, [selectedEvent]);

  const loadQuestions = async () => {
    try {
      const data = await eventService.getAllQuestions();
      setQuestions(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load questions",
        variant: "destructive"
      });
    }
  };

  const loadEvents = async () => {
    try {
      const data = await eventService.getAllEvents();
      setEvents(data);
      if (selectedEvent) {
        const updated = data.find(e => e.id === selectedEvent.id);
        if (updated) {
          setSelectedEvent(updated);
          if (updated.current_question_number) {
            loadCurrentQuestion(updated.id, updated.current_question_number);
          }
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load events",
        variant: "destructive"
      });
    }
  };

  const loadEventTickets = async (eventId: string) => {
    try {
      const data = await eventService.getEventTickets(eventId);
      setEventTickets(data);
    } catch (error) {
      console.error("Failed to load tickets:", error);
    }
  };

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      setCurrentDrawnQuestion(data);
    } catch (error) {
      console.error("Failed to load current question:", error);
      setCurrentDrawnQuestion(null);
    }
  };

  const handleCreateQuestion = async () => {
    if (!questionText.trim()) {
      toast({
        title: "Error",
        description: "Question text is required",
        variant: "destructive"
      });
      return;
    }

    try {
      await eventService.createQuestion(questionText, correctAnswer);
      setQuestionText("");
      setCorrectAnswer(true);
      loadQuestions();
      toast({
        title: "Success",
        description: "Question created successfully"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create question",
        variant: "destructive"
      });
    }
  };

  const handleCreateEvent = async () => {
    if (!eventName.trim()) {
      toast({
        title: "Error",
        description: "Event name is required",
        variant: "destructive"
      });
      return;
    }

    try {
      await eventService.createEvent(eventName);
      setEventName("");
      loadEvents();
      toast({
        title: "Success",
        description: "Event created successfully"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create event",
        variant: "destructive"
      });
    }
  };

  const handleGenerateQuestions = async () => {
    if (!selectedEvent) return;

    try {
      const result = await eventService.generateEventQuestions(selectedEvent.id);
      
      if (result.count < 90) {
        toast({
          title: "Warning",
          description: `Not enough questions in pool. Generated ${result.count} questions (pool has only ${result.total}). Add more questions to reach 90.`,
          variant: "default"
        });
      } else {
        toast({
          title: "Success",
          description: "90 questions generated for event"
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate questions",
        variant: "destructive"
      });
    }
  };

  const handleGenerateTickets = async () => {
    if (!selectedEvent) return;

    const count = parseInt(ticketCount);
    if (isNaN(count) || count < 1) {
      toast({
        title: "Error",
        description: "Please enter a valid number of tickets",
        variant: "destructive"
      });
      return;
    }

    try {
      await eventService.generateTickets(selectedEvent.id, count);
      loadEventTickets(selectedEvent.id);
      toast({
        title: "Success",
        description: `${count} tickets generated successfully`
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate tickets",
        variant: "destructive"
      });
    }
  };

  const handleStartEvent = async () => {
    if (!selectedEvent) return;

    try {
      await eventService.startEvent(selectedEvent.id);
      loadEvents();
      toast({
        title: "Success",
        description: "Event started"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start event",
        variant: "destructive"
      });
    }
  };

  const handleDrawNextQuestion = async () => {
    if (!selectedEvent) return;

    try {
      const result = await eventService.drawNextQuestion(selectedEvent.id);
      loadEvents();
      toast({
        title: "Question Drawn",
        description: `Question ${result.question.question_number}`
      });

      setTimeout(async () => {
        const winner = await eventService.checkForWinner(selectedEvent.id);
        if (winner) {
          toast({
            title: "🎉 WINNER!",
            description: `Ticket ${winner.serial_number} has won!`,
            variant: "default"
          });
          loadEvents();
        }
      }, 10500);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to draw question",
        variant: "destructive"
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      draft: "bg-gray-500",
      active: "bg-green-500",
      paused: "bg-yellow-500",
      finished: "bg-blue-500"
    };
    return <Badge className={colors[status as keyof typeof colors]}>{status.toUpperCase()}</Badge>;
  };

  return (
    <>
      <SEO title="Admin Panel - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-6">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-8 text-center">
            <h1 className="text-5xl font-black text-white mb-2 drop-shadow-lg">ADMIN PANEL</h1>
            <p className="text-white/90 text-lg">Manage questions, events, and live games</p>
          </div>

          <Tabs defaultValue="questions" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2 bg-white/20 backdrop-blur-sm">
              <TabsTrigger value="questions">Questions</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>

            <TabsContent value="questions" className="space-y-4">
              <Card className="bg-white/95 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Create Question</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    placeholder="Question text"
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                  />
                  <div className="flex gap-4">
                    <Button
                      variant={correctAnswer ? "default" : "outline"}
                      onClick={() => setCorrectAnswer(true)}
                      className="flex-1"
                    >
                      Correct Answer: YES
                    </Button>
                    <Button
                      variant={!correctAnswer ? "default" : "outline"}
                      onClick={() => setCorrectAnswer(false)}
                      className="flex-1"
                    >
                      Correct Answer: NO
                    </Button>
                  </div>
                  <Button onClick={handleCreateQuestion} className="w-full" size="lg">
                    <Plus className="mr-2" /> Create Question
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white/95 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Question Pool ({questions.length} total)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {questions.map((q) => (
                      <div key={q.id} className="p-3 bg-gray-50 rounded-lg flex justify-between items-center">
                        <span className="flex-1">{q.text}</span>
                        <Badge variant={q.correct_answer ? "default" : "secondary"}>
                          {q.correct_answer ? "YES" : "NO"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="events" className="space-y-4">
              <Card className="bg-white/95 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Create Event</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    placeholder="Event name"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                  />
                  <Button onClick={handleCreateEvent} className="w-full" size="lg">
                    <Plus className="mr-2" /> Create Event
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white/95 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Events</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {events.map((event) => (
                      <div
                        key={event.id}
                        className={`p-4 rounded-lg cursor-pointer transition-all ${
                          selectedEvent?.id === event.id
                            ? "bg-purple-100 border-2 border-purple-500"
                            : "bg-gray-50 hover:bg-gray-100"
                        }`}
                        onClick={() => setSelectedEvent(event)}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <h3 className="font-bold text-lg">{event.name}</h3>
                            <p className="text-sm text-gray-600">
                              Current Question: {event.current_question_number || "None"}
                            </p>
                          </div>
                          {getStatusBadge(event.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {selectedEvent && (
                <>
                  <Card className="bg-white/95 backdrop-blur-sm border-2 border-purple-500">
                    <CardHeader>
                      <CardTitle className="flex justify-between items-center">
                        <span>Event Details: {selectedEvent.name}</span>
                        {getStatusBadge(selectedEvent.status)}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-purple-50 rounded-lg text-center">
                          <p className="text-sm text-gray-600">Current Question</p>
                          <p className="text-3xl font-bold text-purple-600">
                            {selectedEvent.current_question_number || "-"}
                          </p>
                        </div>
                        <div className="p-4 bg-pink-50 rounded-lg text-center">
                          <p className="text-sm text-gray-600">Status</p>
                          <p className="text-3xl font-bold text-pink-600">
                            {selectedEvent.status}
                          </p>
                        </div>
                      </div>

                      {selectedEvent.winner_ticket_id && (
                        <div className="p-6 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-lg text-center">
                          <p className="text-white text-2xl font-black mb-2">🎉 WINNER! 🎉</p>
                          <p className="text-white text-lg">Ticket ID: {selectedEvent.winner_ticket_id}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {currentDrawnQuestion && selectedEvent.status === "active" && (
                    <Card className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
                      <CardHeader>
                        <CardTitle className="text-white text-center text-3xl">
                          Question #{currentDrawnQuestion.question_number} Drawn
                        </CardTitle>
                        <p className="text-white/90 text-center text-lg">
                          Draw Index: {currentDrawnQuestion.question_number} / 90
                        </p>
                      </CardHeader>
                      <CardContent>
                        <div className="p-8 bg-white/20 backdrop-blur-sm rounded-lg text-center">
                          <p className="text-3xl font-black text-white mb-4">
                            {currentDrawnQuestion.questions?.text}
                          </p>
                          <div className="mt-6">
                            <Badge className={`text-lg px-6 py-2 ${currentDrawnQuestion.questions?.correct_answer ? "bg-green-500" : "bg-red-500"}`}>
                              Correct Answer: {currentDrawnQuestion.questions?.correct_answer ? "YES" : "NO"}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Card className="bg-white/95 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle>Event Setup</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Button
                        onClick={handleGenerateQuestions}
                        className="w-full"
                        size="lg"
                        disabled={selectedEvent.status !== "draft"}
                      >
                        Generate 90 Questions
                      </Button>

                      <div className="flex gap-4">
                        <Input
                          type="number"
                          placeholder="Number of tickets"
                          value={ticketCount}
                          onChange={(e) => setTicketCount(e.target.value)}
                          disabled={selectedEvent.status !== "draft"}
                        />
                        <Button
                          onClick={handleGenerateTickets}
                          disabled={selectedEvent.status !== "draft"}
                        >
                          <Ticket className="mr-2" /> Generate
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white/95 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle>Generated Tickets ({eventTickets.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {eventTickets.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">No tickets generated yet</p>
                      ) : (
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {eventTickets.map((ticket) => (
                            <div
                              key={ticket.id}
                              className={`p-3 rounded-lg flex justify-between items-center ${
                                ticket.is_winner
                                  ? "bg-gradient-to-r from-yellow-100 to-orange-100 border-2 border-yellow-500"
                                  : "bg-gray-50"
                              }`}
                            >
                              <span className="font-mono font-semibold">{ticket.serial_number}</span>
                              {ticket.is_winner && (
                                <Badge className="bg-yellow-500">WINNER 🎉</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-white/95 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle>Game Control</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Button
                        onClick={handleStartEvent}
                        className="w-full bg-green-600 hover:bg-green-700"
                        size="lg"
                        disabled={selectedEvent.status !== "draft"}
                      >
                        <PlayCircle className="mr-2" /> Start Event
                      </Button>

                      <Button
                        onClick={handleDrawNextQuestion}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                        size="lg"
                        disabled={selectedEvent.status !== "active"}
                      >
                        <SkipForward className="mr-2" /> Draw Next Question
                      </Button>
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