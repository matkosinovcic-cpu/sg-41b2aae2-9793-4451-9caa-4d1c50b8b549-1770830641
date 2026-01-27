import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
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
  const { toast } = useToast();

  useEffect(() => {
    if (event) {
      const subscription = eventService.subscribeToEvent(event.id, () => {
        loadEventData();
      });

      const questionsSubscription = eventService.subscribeToEventQuestions(event.id, () => {
        loadCurrentQuestion();
      });

      return () => {
        subscription.unsubscribe();
        questionsSubscription.unsubscribe();
      };
    }
  }, [event]);

  useEffect(() => {
    if (event?.question_open_until) {
      const interval = setInterval(() => {
        const now = new Date().getTime();
        const deadline = new Date(event.question_open_until).getTime();
        const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
        setTimeRemaining(remaining);

        if (remaining === 0) {
          setAnswered(true);
        }
      }, 100);

      return () => clearInterval(interval);
    }
  }, [event?.question_open_until]);

  const loadEventData = async () => {
    if (!ticket) return;
    try {
      const eventData = await eventService.getEvent(ticket.event_id);
      setEvent(eventData);
      if (eventData.current_question_number) {
        loadCurrentQuestion();
      }
    } catch (error) {
      console.error("Failed to load event data");
    }
  };

  const loadCurrentQuestion = async () => {
    if (!ticket || !event?.current_question_number) return;

    try {
      const { data } = await eventService.supabase
        .from("event_questions")
        .select("*, questions(*)")
        .eq("event_id", ticket.event_id)
        .eq("question_number", event.current_question_number)
        .single();

      if (data) {
        setCurrentQuestion(data);
        setAnswered(false);
      }
    } catch (error) {
      console.error("Failed to load current question");
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

  const isNumberOnTicket = (num: number) => {
    if (!ticket?.ticket_questions) return false;
    return ticket.ticket_questions.some((tq: any) => tq.question_number === num);
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
        <div className="container mx-auto max-w-2xl space-y-4">
          <Card className="bg-white/95 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-center">
                <div className="text-sm text-gray-600">Ticket</div>
                <div className="text-2xl font-black">{ticket.serial_number}</div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: 90 }, (_, i) => i + 1).map((num) => {
                  const onTicket = isNumberOnTicket(num);
                  const isDrawn = event?.current_question_number && num <= event.current_question_number;
                  return (
                    <div
                      key={num}
                      className={`aspect-square flex items-center justify-center rounded-lg font-bold text-lg transition-all ${
                        onTicket
                          ? isDrawn
                            ? "bg-green-500 text-white scale-110"
                            : "bg-purple-500 text-white"
                          : "bg-gray-200 text-gray-400"
                      }`}
                    >
                      {num}
                    </div>
                  );
                })}
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
                  <div className="text-sm text-gray-600">Question {event.current_question_number}</div>
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