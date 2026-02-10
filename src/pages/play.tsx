import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OnboardingModal } from "@/components/OnboardingModal";
import { RegistrationModal } from "@/components/RegistrationModal";
import { ticketService, type Ticket } from "@/services/ticketService";
import { eventService, type Event, type EventQuestion } from "@/services/eventService";
import { answerService } from "@/services/answerService";
import { supabase } from "@/integrations/supabase/client";
import { getPlayerSession, updateSessionAfterRegistration, type PlayerSession } from "@/lib/playerHelper";
import { useToast } from "@/hooks/use-toast";

// Helper: Synchronous Preview detection
function isPreviewEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.host;
  return (
    host.includes("softgen.ai") ||
    host.includes("softgen.dev") ||
    host.includes("vercel.app") ||
    host.includes("localhost") ||
    host.includes("127.0.0.1")
  );
}

export default function PlayPage() {
  const router = useRouter();
  const { debug } = router.query;
  const { toast } = useToast();
  
  const [isPreview, setIsPreview] = useState(false);
  const [hasRedirected, setHasRedirected] = useState(false);
  const isDebugMode = debug === "1";

  const [ticket, setTicket] = useState<Ticket[]>([]);
  const [event, setEvent] = useState<Event | null>(null);
  const [ticketStats, setTicketStats] = useState<Record<string, { answered: number; correct: number; incorrect: number; accuracy: number }>>({});
  
  // Auth state (Prod + Preview fallback)
  const [email, setEmail] = useState<string>("");
  const [nickname, setNickname] = useState<string>("");
  const [showRegistration, setShowRegistration] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [lastRequest, setLastRequest] = useState<string>("");

  const [globalStats, setGlobalStats] = useState<{
    drawnQuestions: number;
    correctAnswers: number;
    incorrectAnswers: number;
    accuracy: number;
  }>({
    drawnQuestions: 0,
    correctAnswers: 0,
    incorrectAnswers: 0,
    accuracy: 0
  });

  // Player flow state (Preview only)
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionText, setQuestionText] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [playerAnswers, setPlayerAnswers] = useState<Record<number, { answer: boolean; isCorrect: boolean }>>({});
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [playerSession, setPlayerSession] = useState<PlayerSession | null>(null);

  // Detect preview mode after mount (prevents hydration mismatch)
  useEffect(() => {
    const hostname = window.location.hostname;
    setIsPreview(
      hostname.includes("softgen") ||
      hostname.includes("vercel.app") ||
      hostname.includes("localhost")
    );
  }, []);

  // Load player session (Preview only)
  useEffect(() => {
    if (!isPreview) return;

    const loadSession = async () => {
      const session = await getPlayerSession();
      setPlayerSession(session);
      
      if (session) {
        console.log("[PlayPage] Player session loaded:", {
          playerId: session.playerId.slice(0, 8),
          nickname: session.nickname
        });
      } else {
        console.log("[PlayPage] No player session found");
      }
    };

    loadSession();
  }, [isPreview]);

  // ENV validation on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key || url === "invalid_url" || key === "invalid_anon_key") {
      toast({
        title: "Supabase nije pravilno konfiguriran.",
        variant: "destructive",
      });
    }
  }, []);

  // Load active event
  useEffect(() => {
    if (!router.isReady || !isDebugMode) return;

    const loadActiveEvent = async () => {
      try {
        const activeEvent = await eventService.getActiveEvent();
        setEvent(activeEvent);
      } catch (error) {
        console.error("[PlayPage] Error loading active event:", error);
      }
    };

    loadActiveEvent();
  }, [router.isReady, isDebugMode]);

  // Auto-load existing tickets
  useEffect(() => {
    if (!event || ticket.length > 0) return;

    const loadExistingTickets = async () => {
      try {
        const savedEmail = localStorage.getItem("player_email");
        if (!savedEmail) return;

        const tickets = await ticketService.getPlayerTickets(savedEmail, event.id);
        
        if (tickets.length > 0) {
          setTicket(tickets);
        }
      } catch (error) {
        console.error("[PlayPage] Error loading existing tickets:", error);
      }
    };

    loadExistingTickets();
  }, [event, ticket, isDebugMode]);

  // Fetch statistics for all tickets
  useEffect(() => {
    if (!ticket || !event || !isPreview) return;

    const fetchStats = async () => {
      try {
        // Fetch stats for each ticket
        const statsPromises = ticket.map(async (t) => {
          const answers = await answerService.getTicketAnswers(t.id);
          const ticketNumbers = t.ticket_numbers || [];
          
          const answered = answers.length;
          const correct = answers.filter(a => a.is_correct).length;
          const incorrect = answers.filter(a => !a.is_correct).length;
          const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;

          return {
            ticketId: t.id,
            stats: { answered, correct, incorrect, accuracy }
          };
        });

        const results = await Promise.all(statsPromises);
        
        // Build stats map
        const statsMap: typeof ticketStats = {};
        results.forEach(({ ticketId, stats }) => {
          statsMap[ticketId] = stats;
        });
        setTicketStats(statsMap);

        // Calculate global stats
        const totalCorrect = results.reduce((sum, { stats }) => sum + stats.correct, 0);
        const totalIncorrect = results.reduce((sum, { stats }) => sum + stats.incorrect, 0);
        const totalAnswered = totalCorrect + totalIncorrect;
        const globalAccuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

        setGlobalStats({
          drawnQuestions: event.drawn_numbers?.length || 0,
          correctAnswers: totalCorrect,
          incorrectAnswers: totalIncorrect,
          accuracy: globalAccuracy
        });
      } catch (error) {
        console.error("[PlayPage] Error fetching stats:", error);
      }
    };

    fetchStats();
  }, [ticket, event, isPreview]);

  // Realtime subscription for current question (Preview only)
  useEffect(() => {
    if (!event || !isPreview) return;

    console.log("[PlayPage] Setting up realtime subscription for event:", event.id);

    const eventSub = supabase
      .channel(`play-event-${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
          filter: `id=eq.${event.id}`
        },
        async (payload) => {
          const updatedEvent = payload.new as Event;
          console.log("[PlayPage] Event updated:", {
            current_number: updatedEvent.current_drawn_number,
            drawn_count: updatedEvent.drawn_numbers?.length
          });
          
          setEvent(updatedEvent);
          
          // Load current question if number changed
          if (updatedEvent.current_drawn_number) {
            await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_drawn_number);
          }
        }
      )
      .subscribe();

    // Load initial current question if exists
    if (event.current_drawn_number) {
      loadCurrentQuestion(event.id, event.current_drawn_number);
    }

    return () => {
      console.log("[PlayPage] Cleaning up subscription");
      eventSub.unsubscribe();
    };
  }, [event?.id, isPreview]);

  // Timer countdown (Preview only)
  useEffect(() => {
    if (!event?.question_open_until || !isPreview) {
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
  }, [event?.question_open_until, isPreview]);

  // Load current question details
  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log(`[PlayPage] Loading question #${questionNumber}`);
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      setCurrentQuestion(data);

      // Fetch question text
      if (data?.question_id) {
        const { data: qData, error: qError } = await supabase
          .from("questions")
          .select("text")
          .eq("id", data.question_id)
          .single();

        if (!qError && qData) {
          console.log("[PlayPage] NEW QUESTION:", data.question_number, qData.text);
          setQuestionText(qData.text);
        }
      }
    } catch (error) {
      console.error("[PlayPage] Error loading question:", error);
    }
  };

  // Submit answer (Preview only)
  const handleAnswer = async (answerYesNo: boolean) => {
    if (!currentQuestion || !event) return;

    // In Preview: Use player session
    if (isPreview) {
      if (!playerSession) {
        toast({
          title: "Greška",
          description: "Molimo registrirajte se prvo.",
          variant: "destructive",
        });
        return;
      }

      try {
        setSubmittingAnswer(true);

        // Get or create session
        const session = await answerService.getOrCreateSession(event.id);

        // Submit answer for first ticket
        const firstTicket = ticket[0];
        await answerService.submitAnswer(
          session.id,
          event.id,
          currentQuestion.question_number,
          answerYesNo ? "YES" : "NO",
          firstTicket.serial_number
        );

        // Get correct answer
        const { data: questionData } = await supabase
          .from("questions")
          .select("correct_answer")
          .eq("id", currentQuestion.question_id)
          .single();

        const isCorrect = questionData
          ? (answerYesNo ? "YES" : "NO") === (questionData.correct_answer ? "YES" : "NO")
          : false;

        // Update local state
        setPlayerAnswers(prev => ({
          ...prev,
          [currentQuestion.question_number]: { answer: answerYesNo, isCorrect }
        }));

        console.log("[PlayPage] Answer submitted:", {
          question: currentQuestion.question_number,
          answer: answerYesNo ? "DA" : "NE",
          correct: isCorrect,
          playerId: playerSession.playerId.slice(0, 8),
          nickname: playerSession.nickname
        });

        toast({
          title: isCorrect ? "✓ Točan odgovor!" : "✗ Netočan odgovor",
          description: `Pitanje #${currentQuestion.question_number}`,
          variant: isCorrect ? "default" : "destructive",
        });

        // Refresh page to update statistics
        setTimeout(() => window.location.reload(), 500);

      } catch (error: any) {
        console.error("[PlayPage] Submit error:", error);
        toast({
          title: "Greška",
          description: error.message || "Greška pri slanju odgovora",
          variant: "destructive",
        });
      } finally {
        setSubmittingAnswer(false);
      }
      return;
    }

    // Production: Original guard logic
    if (!email || !nickname) {
      alert("Molimo prijavite se prvo");
      return;
    }

    try {
      setSubmittingAnswer(true);

      // Get or create session
      const session = await answerService.getOrCreateSession(event.id);

      // Submit answer for first ticket
      const firstTicket = ticket[0];
      await answerService.submitAnswer(
        session.id,
        event.id,
        currentQuestion.question_number,
        answerYesNo ? "YES" : "NO",
        firstTicket.serial_number
      );

      // Get correct answer
      const { data: questionData } = await supabase
        .from("questions")
        .select("correct_answer")
        .eq("id", currentQuestion.question_id)
        .single();

      const isCorrect = questionData
        ? (answerYesNo ? "YES" : "NO") === (questionData.correct_answer ? "YES" : "NO")
        : false;

      // Update local state
      setPlayerAnswers(prev => ({
        ...prev,
        [currentQuestion.question_number]: { answer: answerYesNo, isCorrect }
      }));

      console.log("[PlayPage] Answer submitted:", {
        question: currentQuestion.question_number,
        answer: answerYesNo ? "DA" : "NE",
        correct: isCorrect
      });

      toast({
        title: isCorrect ? "✓ Točan odgovor!" : "✗ Netočan odgovor",
        description: `Pitanje #${currentQuestion.question_number}`,
        variant: isCorrect ? "default" : "destructive",
      });

      // Refresh page to update statistics
      setTimeout(() => window.location.reload(), 500);

    } catch (error: any) {
      console.error("[PlayPage] Submit error:", error);
      toast({
        title: "Greška",
        description: error.message || "Greška pri slanju odgovora",
        variant: "destructive",
      });
    } finally {
      setSubmittingAnswer(false);
    }
  };

  const handleRegistrationSuccess = (result: any) => {
    console.log("[PlayPage] Registration successful:", result);
    
    if (result.success && result.tickets) {
      setTicket(result.tickets);
      setShowRegistration(false);
    }
  };

  const handleOpenRegistration = () => {
    setShowRegistration(true);
  };

  const handleClaimTickets = async () => {
    const savedEmail = localStorage.getItem("player_email");
    const savedNickname = localStorage.getItem("player_nickname");

    if (!savedEmail || !savedNickname) {
      setShowRegistration(true);
      return;
    }

    const requestKey = `${savedEmail}-${savedNickname}`;
    if (lastRequest === requestKey) {
      console.log("[PlayPage] Duplicate request blocked");
      return;
    }

    setClaiming(true);
    setLastRequest(requestKey);

    try {
      const result = await ticketService.claimFreeTickets(savedEmail, savedNickname);
      
      if (result.success && result.tickets) {
        setTicket(result.tickets);
      }
    } catch (error: any) {
      console.error("[PlayPage] Claim error:", error);
      alert(error.message || "Greška pri preuzimanju listića");
    } finally {
      setClaiming(false);
      setTimeout(() => setLastRequest(""), 2000);
    }
  };

  // Get color for ticket number based on answer
  const getNumberColor = (ticketId: string, questionNumber: number, drawnNumbers: number[]) => {
    if (!drawnNumbers.includes(questionNumber)) {
      return "bg-gray-200 text-gray-800"; // Not drawn yet
    }

    // Check if answered
    const answers = ticketStats[ticketId];
    if (!answers) return "bg-gray-200 text-gray-800";

    // This is simplified - in real app, you'd need to check specific answer for this question
    // For now, we'll use a placeholder logic
    return "bg-gray-200 text-gray-800";
  };

  return (
    <>
      <Head>
        <title>Pitalica Skitalica - Pregled listića</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-purple-500 via-purple-400 to-orange-400">
        {/* DEBUG Banner - Preview Only */}
        {isPreview && event && (
          <div className="bg-green-600 text-white text-center py-2 text-sm font-mono">
            <strong>PREVIEW MODE</strong>
            <span className="ml-4">
              Event: {event.name} | 
              Questions: {globalStats.drawnQuestions}/90 | 
              Stats: T{globalStats.correctAnswers}·N{globalStats.incorrectAnswers}·{globalStats.accuracy}%
              {playerSession && (
                <span className="ml-4 text-yellow-300">
                  playerId={playerSession.playerId.slice(0, 8)}... | nick={playerSession.nickname}
                </span>
              )}
            </span>
          </div>
        )}

        {/* Header */}
        <div className="bg-white shadow-sm border-b">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-purple-600">PITALICA SKITALICA</h1>
                <p className="text-sm text-gray-600">
                  {isPreview && playerSession ? playerSession.nickname : (nickname || "Igrač")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 max-w-4xl">
          {!event ? (
            <Card className="max-w-md mx-auto shadow-md">
              <CardContent className="p-6 text-center">
                <p className="text-gray-600">Učitavanje aktivnog događaja...</p>
              </CardContent>
            </Card>
          ) : !ticket ? (
            <Card className="max-w-md mx-auto shadow-md">
              <CardContent className="p-6 text-center">
                <h2 className="text-xl font-bold mb-4">Preuzmi listiće</h2>
                <p className="text-gray-600 mb-6">
                  Klikni na gumb ispod da bi preuzeo besplatne listiće za {event.name}.
                </p>
                <Button
                  onClick={handleClaimTickets}
                  disabled={claiming}
                  className="w-full"
                >
                  {claiming ? "Preuzimanje..." : "Preuzmi listiće"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Global Statistics Header */}
              {isPreview && (
                <Card className="bg-white shadow-lg rounded-2xl overflow-hidden">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h1 className="text-2xl font-bold text-black">PITALICA SKITALICA</h1>
                        <p className="text-xl font-semibold text-gray-800 mt-1">
                          {localStorage.getItem("player_nickname") || "Igrač"}
                        </p>
                        <p className="text-gray-600">{event.name}</p>
                      </div>
                      <Badge className="bg-green-500 text-white px-4 py-1 text-sm rounded-full">
                        {event.status === "active" ? "U toku" : "Završeno"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-3xl font-bold text-black">
                          {globalStats.drawnQuestions}/90
                        </div>
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-green-600">
                          T {globalStats.correctAnswers}
                        </div>
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-red-600">
                          N {globalStats.incorrectAnswers}
                        </div>
                      </div>
                      <div>
                        <div className={`text-3xl font-bold ${
                          globalStats.accuracy >= 50 ? "text-green-600" : "text-red-600"
                        }`}>
                          {globalStats.accuracy}%
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Current Question Panel (Preview only) */}
              {isPreview && currentQuestion && (
                <Card className="bg-white shadow-lg rounded-2xl overflow-hidden">
                  <CardContent className="p-6">
                    <div className="text-center space-y-4">
                      <div className="text-lg text-purple-600 font-semibold">
                        Trenutno pitanje #{currentQuestion.question_number}
                      </div>
                      
                      {timeRemaining > 0 && (
                        <div className="text-5xl font-bold text-orange-500 animate-pulse">
                          {timeRemaining}s
                        </div>
                      )}
                      
                      {questionText && (
                        <div className="bg-gray-50 rounded-xl p-6 my-4">
                          <p className="text-xl text-gray-800 leading-relaxed">
                            {questionText}
                          </p>
                        </div>
                      )}
                      
                      {timeRemaining > 0 && !playerAnswers[currentQuestion.question_number] && (
                        <div className="flex gap-4 justify-center mt-6">
                          <Button
                            onClick={() => handleAnswer(true)}
                            disabled={submittingAnswer}
                            className="bg-green-500 hover:bg-green-600 text-white text-2xl font-bold py-6 px-12 rounded-xl"
                          >
                            DA
                          </Button>
                          <Button
                            onClick={() => handleAnswer(false)}
                            disabled={submittingAnswer}
                            className="bg-red-500 hover:bg-red-600 text-white text-2xl font-bold py-6 px-12 rounded-xl"
                          >
                            NE
                          </Button>
                        </div>
                      )}
                      
                      {playerAnswers[currentQuestion.question_number] && (
                        <div className={`text-xl font-bold ${
                          playerAnswers[currentQuestion.question_number].isCorrect 
                            ? "text-green-600" 
                            : "text-red-600"
                        }`}>
                          {playerAnswers[currentQuestion.question_number].isCorrect 
                            ? "✓ Točan odgovor!" 
                            : "✗ Netočan odgovor"}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Tickets Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ticket.map((t) => {
                  const stats = ticketStats[t.id] || { answered: 0, correct: 0, incorrect: 0, accuracy: 0 };
                  const ticketNumbers = t.ticket_numbers || [];
                  const drawnNumbers = event.drawn_numbers || [];

                  return (
                    <Link 
                      key={t.id} 
                      href={`/player?ticketId=${t.id}`}
                      passHref
                      className="block"
                      onClick={() => console.log("[PlayPage] Ticket clicked:", t.id)}
                    >
                      <Card
                        className="overflow-hidden border-2 shadow-md hover:shadow-lg transition-shadow cursor-pointer h-full"
                      >
                        <CardContent className="p-4">
                          {/* Serial Number */}
                          <div className="mb-3">
                            <h3 className="text-lg font-bold text-black">{t.serial_number}</h3>
                            {isPreview && (
                              <p className="text-sm text-gray-500">
                                {stats.answered}/15 | 
                                <span className="text-green-600"> T {stats.correct}</span> · 
                                <span className="text-red-600"> N {stats.incorrect}</span> | 
                                <span className={stats.accuracy >= 50 ? "text-green-600" : "text-red-600"}>
                                  {stats.accuracy}%
                                </span>
                              </p>
                            )}
                          </div>

                          {/* Numbers Grid - 5 columns x 3 rows */}
                          <div className="grid grid-cols-5 gap-2">
                            {ticketNumbers.slice(0, 15).map((num, idx) => {
                              const isDrawn = drawnNumbers.includes(num);
                              const answer = playerAnswers[num];
                              
                              let colorClass = "bg-gray-200 text-gray-800"; // Not drawn yet
                              
                              if (isDrawn && answer) {
                                // Question was drawn and answered
                                colorClass = answer.isCorrect 
                                  ? "bg-green-500 text-white" // Correct answer
                                  : "bg-red-500 text-white";  // Incorrect answer
                              } else if (isDrawn && !answer) {
                                // Question was drawn but not answered
                                colorClass = "bg-gray-400 text-white"; // Missed
                              }

                              return (
                                <div
                                  key={idx}
                                  className={`aspect-square flex items-center justify-center rounded-lg font-bold text-lg ${colorClass}`}
                                >
                                  {num}
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>

              <div className="text-center">
                <p className="text-white text-sm font-semibold">
                  Limit 4 tiketa (promo faza)
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <OnboardingModal
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        onDismiss={(dontShowAgain) => {
          // If user clicked "Kreni", proceed to registration
          handleOpenRegistration();
          // Logic for dontShowAgain could be handled here if needed
        }}
      />

      {/* Registration Modal */}
      <RegistrationModal
        open={showRegistration}
        onOpenChange={setShowRegistration}
        onSuccess={async (data) => {
          setEmail(data.email);
          setNickname(data.nickname);
          setTicket(data.tickets);
          setEvent(data.event);
          setShowRegistration(false);
          
          // Preview only: Save session
          if (isPreview && data.event) {
            await updateSessionAfterRegistration(
              data.email,
              data.nickname,
              data.tickets.map(t => t.id),
              data.event.id
            );
            
            // Reload session
            const session = await getPlayerSession();
            setPlayerSession(session);
          }
        }}
        eventId={event?.id || ""}
        venueId=""
      />
    </>
  );
}