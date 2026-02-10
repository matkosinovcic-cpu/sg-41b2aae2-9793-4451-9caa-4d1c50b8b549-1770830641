import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OnboardingModal } from "@/components/OnboardingModal";
import { RegistrationModal } from "@/components/RegistrationModal";
import { ticketService, type Ticket } from "@/services/ticketService";
import { eventService, type Event } from "@/services/eventService";
import { answerService } from "@/services/answerService";

export default function PlayPage() {
  const router = useRouter();
  const { venueSlug, debug } = router.query;

  const [envError, setEnvError] = useState<string>("");
  const [event, setEvent] = useState<Event | null>(null);
  const [ticket, setTicket] = useState<Ticket[] | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [lastRequest, setLastRequest] = useState<string>("");

  const isDebugMode = debug === "1";
  const [isPreview, setIsPreview] = useState(false);

  // Ticket statistics state
  const [ticketStats, setTicketStats] = useState<{
    [ticketId: string]: {
      answered: number;
      correct: number;
      incorrect: number;
      accuracy: number;
    };
  }>({});

  // Global statistics state
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

  useEffect(() => {
    const hostname = window.location.hostname;
    setIsPreview(
      hostname.includes("softgen") ||
      hostname.includes("vercel.app") ||
      hostname.includes("localhost")
    );
  }, []);

  // ENV validation on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key || url === "invalid_url" || key === "invalid_anon_key") {
      setEnvError("Supabase nije pravilno konfiguriran.");
    }
  }, []);

  // Load active event
  useEffect(() => {
    if (!router.isReady || envError || !isDebugMode) return;

    const loadActiveEvent = async () => {
      try {
        const activeEvent = await eventService.getActiveEvent();
        setEvent(activeEvent);
      } catch (error) {
        console.error("[PlayPage] Error loading active event:", error);
      }
    };

    loadActiveEvent();
  }, [router.isReady, venueSlug, envError, isDebugMode]);

  // Auto-load existing tickets
  useEffect(() => {
    if (!event || ticket) return;

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

  const handleRegistrationSuccess = (result: any) => {
    console.log("[PlayPage] Registration successful:", result);
    
    if (result.success && result.tickets) {
      setTicket(result.tickets);
      setShowRegistration(false);
      setShowOnboarding(false);
    }
  };

  const handleOpenRegistration = () => {
    setShowOnboarding(false);
    setShowRegistration(true);
  };

  const handleClaimTickets = async () => {
    const savedEmail = localStorage.getItem("player_email");
    const savedNickname = localStorage.getItem("player_nickname");

    if (!savedEmail || !savedNickname) {
      setShowOnboarding(true);
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

  if (envError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-bold text-red-600 mb-2">Greška konfiguracije</h2>
            <p className="text-gray-600">{envError}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isDebugMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Card className="max-w-md mx-auto shadow-md">
          <CardContent className="p-8 text-center">
            <h2 className="text-2xl font-bold mb-4">Stranica nije dostupna</h2>
            <p className="text-gray-600 mb-6">
              Ova stranica je dostupna samo u debug modu.
            </p>
            <Button onClick={() => router.push("/")} className="w-full">
              Povratak na početnu
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Pitalica Skitalica - Pregled listića</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-purple-500 via-purple-400 to-orange-400">
        {/* DEBUG Banner - Preview Only */}
        {isPreview && (
          <div className="bg-green-600 text-white text-center py-2 text-sm font-mono">
            <strong>PLAYER PREVIEW = PROD LOGIC</strong>
            {event && (
              <span className="ml-4">
                Event: {event.id.slice(0, 8)}... | 
                Tickets: {ticket?.length || 0} | 
                Global T:{globalStats.correctAnswers} N:{globalStats.incorrectAnswers}
              </span>
            )}
          </div>
        )}

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

              {/* Tickets Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ticket.map((t) => {
                  const stats = ticketStats[t.id] || { answered: 0, correct: 0, incorrect: 0, accuracy: 0 };
                  const ticketNumbers = t.ticket_numbers || [];
                  const drawnNumbers = event.drawn_numbers || [];

                  return (
                    <Card
                      key={t.id}
                      className="bg-white shadow-lg rounded-2xl overflow-hidden cursor-pointer hover:shadow-xl transition-shadow"
                      onClick={() => router.push(`/player?ticketId=${t.id}`)}
                    >
                      <CardContent className="p-6">
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
                            const colorClass = isDrawn 
                              ? "bg-gray-300 text-gray-800" // Placeholder - will be replaced with actual answer colors
                              : "bg-gray-200 text-gray-800";

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

      <RegistrationModal
        open={showRegistration}
        onOpenChange={setShowRegistration}
        onSuccess={handleRegistrationSuccess}
        eventId={event?.id || ""}
        venueId={venueSlug as string || ""}
      />
    </>
  );
}