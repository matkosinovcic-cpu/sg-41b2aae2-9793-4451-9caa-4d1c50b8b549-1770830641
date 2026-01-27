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
  const [ticket, setTicket] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<"disconnected" | "connected">("disconnected");
  const lastQuestionNumberRef = useRef<number | null>(null);
  const { toast } = useToast();

  // Load from localStorage on mount
  useEffect(() => {
    const storedSerial = localStorage.getItem("ticket_serial");
    const storedEventId = localStorage.getItem("event_id");

    if (storedSerial && storedEventId) {
      console.log("[PLAYER] Auto-rejoining with stored ticket:", storedSerial);
      autoRejoin(storedSerial, storedEventId);
    }
  }, []);

  const autoRejoin = async (serial: string, eventId: string) => {
    try {
      const ticketData = await eventService.getTicketBySerial(serial);
      if (ticketData.event_id === eventId) {
        setTicket(ticketData);
        const eventData = await eventService.getEvent(eventId);
        setEvent(eventData);
        lastQuestionNumberRef.current = eventData.current_question_number;
        
        // Load current question if one exists
        if (eventData.current_question_number) {
          await loadCurrentQuestion(eventId, eventData.current_question_number);
        }
      } else {
        // Invalid data, clear storage
        localStorage.removeItem("ticket_serial");
        localStorage.removeItem("event_id");
      }
    } catch (error) {
      console.error("[PLAYER] Auto-rejoin failed:", error);
      // Invalid ticket, clear storage
      localStorage.removeItem("ticket_serial");
      localStorage.removeItem("event_id");
    }
  };

  // Real-time subscriptions
  useEffect(() => {
    if (!event?.id) {
      setSubscriptionStatus("disconnected");
      return;
    }

    console.log("[PLAYER] Setting up subscription for event:", event.id);

    // Subscribe to event changes
    const eventSubscription = eventService.subscribeToEvent(event.id, async (payload) => {
      console.log("[PLAYER] Real-time event update received:", payload);
      const updatedEvent = payload.new;
      
      // Check if question number changed
      const questionChanged = updatedEvent.current_question_number !== lastQuestionNumberRef.current;
      
      if (questionChanged && updatedEvent.current_question_number) {
        console.log(`[PLAYER] Question changed from ${lastQuestionNumberRef.current} to ${updatedEvent.current_question_number}`);
        lastQuestionNumberRef.current = updatedEvent.current_question_number;
        setAnswered(false); // Reset answered state for new question
        await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_question_number);
      }
      
      setEvent(updatedEvent);
    });

    // Subscribe to ticket changes (for winner status)
    const ticketsSubscription = eventService.subscribeToTickets(event.id, (payload) => {
      console.log("[PLAYER] Ticket update received:", payload);
      if (payload.new && payload.new.id === ticket?.id) {
        setTicket(payload.new);
      }
    });

    setSubscriptionStatus("connected");
    console.log("[PLAYER] Subscriptions active");

    // Load current question on mount if one exists
    if (event.current_question_number) {
      loadCurrentQuestion(event.id, event.current_question_number);
    }

    return () => {
      console.log("[PLAYER] Cleaning up subscriptions");
      eventSubscription.unsubscribe();
      ticketsSubscription.unsubscribe();
      setSubscriptionStatus("disconnected");
    };
  }, [event?.id, ticket?.id]);

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

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log(`[PLAYER] Loading question #${questionNumber}`);
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      console.log("[PLAYER] Question loaded:", data);
      setCurrentQuestion(data);
    } catch (error) {
      console.error("[PLAYER] Failed to load question:", error);
      setCurrentQuestion(null);
    }
  };

  const handleJoin = async () => {
    if (!serialNumber.trim()) {
      toast({
        title: "Error",
        description: "Please enter a ticket serial number",
        variant: "destructive"
      });
      return;
    }

    try {
      const ticketData = await eventService.getTicketBySerial(serialNumber);
      setTicket(ticketData);
      const eventData = await eventService.getEvent(ticketData.event_id);
      setEvent(eventData);
      lastQuestionNumberRef.current = eventData.current_question_number;
      
      // Persist to localStorage
      localStorage.setItem("ticket_serial", serialNumber);
      localStorage.setItem("event_id", ticketData.event_id);
      
      // Load current question if one exists
      if (eventData.current_question_number) {
        await loadCurrentQuestion(eventData.id, eventData.current_question_number);
      }
      
      toast({
        title: "Success",
        description: "Joined successfully!"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Invalid ticket serial number",
        variant: "destructive"
      });
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
        {/* Debug Info */}
        <div className="fixed top-2 right-2 text-xs text-white bg-black/50 px-3 py-2 rounded font-mono z-50 space-y-1">
          <div>event: {event?.id?.slice(0, 8) || "none"}</div>
          <div>q: {event?.current_question_number || 0}</div>
          <div>status: {event?.status || "unknown"}</div>
          <div className={`font-bold ${subscriptionStatus === "connected" ? "text-green-400" : "text-red-400"}`}>
            sub: {subscriptionStatus}
          </div>
        </div>

        <div className="container mx-auto max-w-2xl space-y-4">
          <Card className="bg-white/95 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-center">
                <div className="text-sm text-gray-600">Ticket</div>
                <div className="text-2xl font-black">{ticket.serial_number}</div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Display only the ticket's 15 numbers in 3x5 grid */}
              <div className="grid grid-cols-5 gap-3">
                {ticket.ticket_questions
                  ?.map((tq: any) => tq.question_number)
                  .sort((a: number, b: number) => a - b)
                  .map((num: number) => {
                    const isDrawn = event?.current_question_number && num <= event.current_question_number;
                    return (
                      <div
                        key={num}
                        className={`aspect-square flex items-center justify-center rounded-lg font-black text-3xl transition-all shadow-md ${
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
              <div className="mt-4 text-center text-sm text-gray-600">
                Your ticket has 15 numbers
              </div>
            </CardContent>
          </Card>

          {ticket.is_winner && (
            <Card className="bg-gradient-to-r from-yellow-400 to-orange-500">
              <CardContent className="py-8 text-center">
                <Trophy className="w-24 h-24 text-white mx-auto mb-4" />
                <h2 className="text-4xl font-black text-white mb-2">WINNER!</h2>
                <p className="text-white text-xl">Congratulations! You won!</p>
              </CardContent>
            </Card>
          )}

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