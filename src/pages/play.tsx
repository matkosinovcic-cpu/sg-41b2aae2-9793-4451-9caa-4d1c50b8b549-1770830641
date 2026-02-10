import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { ticketService, Ticket } from "@/services/ticketService";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { answerService } from "@/services/answerService";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  AlertCircle, 
  ThumbsUp,
  ThumbsDown,
  Trophy,
  User,
  TicketIcon
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import Head from "next/head";
import { cn } from "@/lib/utils";
import { OnboardingModal } from "@/components/OnboardingModal";
import { RegistrationModal } from "@/components/RegistrationModal";
import {
  getPreviewPlayerSession,
  setPreviewPlayerSession,
  clearPreviewPlayerSession,
  isPreviewEnvironment,
  type PreviewPlayerSession
} from "@/lib/previewSession";

export default function PlayPage() {
  const router = useRouter();
  
  // Preview detection
  const [isPreview, setIsPreview] = useState(false);
  const [playerSession, setPlayerSession] = useState<PreviewPlayerSession | null>(null);
  const [nickname, setNickname] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  
  // Event & Questions
  const [event, setEvent] = useState<Event | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [drawnQuestions, setDrawnQuestions] = useState<Record<number, boolean>>({});
  const [timeRemaining, setTimeRemaining] = useState(0);
  
  // Tickets
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketStats, setTicketStats] = useState<Record<string, { 
    answered: number; 
    correct: number; 
    incorrect: number; 
    accuracy: number 
  }>>({});
  
  // Answer state
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [playerAnswers, setPlayerAnswers] = useState<Record<number, boolean>>({});
  
  // Global stats
  const [globalStats, setGlobalStats] = useState({
    answered: 0,
    correct: 0,
    incorrect: 0,
    accuracy: 0
  });
  
  // Modals
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);

  // Initialize Preview Mode & Load Session
  useEffect(() => {
    const hostname = window.location.hostname;
    const preview = 
      hostname.includes("softgen") ||
      hostname.includes("vercel.app") ||
      hostname.includes("localhost");
    
    setIsPreview(preview);

    if (preview) {
      const session = getPreviewPlayerSession();
      if (session) {
        console.log("[PlayPage] ✅ Session restored:", {
          playerId: session.playerId.slice(0, 8),
          nickname: session.nickname,
          ticketCount: session.ticketIds.length
        });
        
        setPlayerSession(session);
        setNickname(session.nickname);
        setEmail(session.email);
      } else {
        console.log("[PlayPage] ⚠️ No session - show onboarding");
        setShowOnboarding(true);
      }
    }
  }, []);

  // Load Active Event
  useEffect(() => {
    if (!router.isReady) return;

    const loadActiveEvent = async () => {
      setEventLoading(true);
      try {
        const activeEvent = await eventService.getActiveEvent();
        setEvent(activeEvent);
        console.log("[PlayPage] ✅ Event loaded:", {
          id: activeEvent.id.slice(0, 8),
          name: activeEvent.name,
          status: activeEvent.status
        });
      } catch (error: any) {
        console.error("[PlayPage] ❌ Event load error:", error);
      } finally {
        setEventLoading(false);
      }
    };

    if (isPreview || router.query.debug === "1") {
      loadActiveEvent();
    }
  }, [router.isReady, isPreview, router.query.debug]);

  // Load Tickets for Player (Preview only)
  useEffect(() => {
    if (!isPreview || !playerSession || !event) return;

    const loadTickets = async () => {
      try {
        console.log("[PlayPage] 📋 Loading tickets:", {
          playerId: playerSession.playerId.slice(0, 8),
          ticketIds: playerSession.ticketIds
        });

        const ticketPromises = playerSession.ticketIds.map(id =>
          ticketService.getTicket(id).catch(() => null)
        );
        
        const loadedTickets = await Promise.all(ticketPromises);
        const validTickets = loadedTickets.filter(t => t !== null) as Ticket[];
        
        setTickets(validTickets);
        
        // Initialize stats for each ticket
        const stats: any = {};
        validTickets.forEach(t => {
          stats[t.serial_number] = { answered: 0, correct: 0, incorrect: 0, accuracy: 0 };
        });
        setTicketStats(stats);
        
        console.log("[PlayPage] ✅ Tickets loaded:", validTickets.length);
      } catch (error) {
        console.error("[PlayPage] ❌ Error loading tickets:", error);
      }
    };

    loadTickets();
  }, [isPreview, playerSession, event]);

  // Load Drawn Questions Map
  useEffect(() => {
    if (!event) return;

    const loadDrawnQuestions = async () => {
      try {
        const drawnMap = await eventService.getDrawnQuestions(event.id);
        setDrawnQuestions(drawnMap);
        console.log("[PlayPage] ✅ Drawn questions loaded:", Object.keys(drawnMap).length);
      } catch (error) {
        console.error("[PlayPage] ❌ Error loading drawn questions:", error);
      }
    };

    loadDrawnQuestions();
  }, [event?.id]);

  // Realtime Subscription: Event & Questions
  useEffect(() => {
    if (!event) return;

    // Subscribe to event updates (status changes)
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
        (payload) => {
          if (payload.new) {
            const updatedEvent = payload.new as Event;
            setEvent(updatedEvent);
            console.log("[PlayPage] 📡 Event updated:", {
              status: updatedEvent.status,
              current_drawn: updatedEvent.current_drawn_number
            });
          }
        }
      )
      .subscribe();

    // Subscribe to event_questions (when question is drawn)
    const questionsSub = supabase
      .channel(`play-questions-${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_questions",
          filter: `event_id=eq.${event.id}`
        },
        async (payload) => {
          console.log("[PlayPage] 📡 Question change:", payload.eventType);
          
          if (payload.eventType === "UPDATE" && payload.new) {
            const questionData = payload.new as EventQuestion;
            
            // If question was just drawn
            if (questionData.drawn && !drawnQuestions[questionData.question_number]) {
              console.log("[PlayPage] 🎯 New question drawn:", questionData.question_number);
              
              // Fetch full question with text
              try {
                const fullQuestion = await eventService.getEventQuestion(
                  event.id,
                  questionData.question_number
                );
                
                setCurrentQuestion(fullQuestion);
                setDrawnQuestions(prev => ({
                  ...prev,
                  [questionData.question_number]: true
                }));
                
                console.log("[PlayPage] ✅ Current question set:", {
                  number: fullQuestion.question_number,
                  text: fullQuestion.questions?.text?.substring(0, 50) + "..."
                });
              } catch (error) {
                console.error("[PlayPage] ❌ Error fetching question:", error);
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      eventSub.unsubscribe();
      questionsSub.unsubscribe();
    };
  }, [event?.id, drawnQuestions]);

  // Subscribe to event_questions changes for real-time sync
  useEffect(() => {
    if (!event || !isPreview) return;

    console.log("[PlayPage] 📡 Subscribing to event_questions for event:", event.id);

    const channel = supabase
      .channel(`event_questions:${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_questions",
          filter: `event_id=eq.${event.id}`
        },
        (payload) => {
          console.log("[PlayPage] 🔔 Event question update:", payload);

          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            const questionData = payload.new as EventQuestion;
            
            // Only update if this is the current active question
            if (questionData.drawn_at && questionData.question_open_until) {
              console.log("[PlayPage] ✅ Setting active question:", questionData.question_number);
              setCurrentQuestion(questionData);
              
              // Calculate time remaining
              const now = Date.now();
              const openUntil = new Date(questionData.question_open_until).getTime();
              const remaining = Math.max(0, Math.floor((openUntil - now) / 1000));
              setTimeRemaining(remaining);
              setRealtimeConnected(true);
            }
          }
        }
      )
      .subscribe();

    return () => {
      console.log("[PlayPage] 🔌 Unsubscribing from event_questions");
      supabase.removeChannel(channel);
    };
  }, [event, isPreview]);

  // Subscribe to player_answers for real-time stats updates (PREVIEW ONLY)
  useEffect(() => {
    if (!event || !isPreview || !playerSession) return;

    console.log("[PlayPage] 📡 Subscribing to player_answers for player:", playerSession.playerId.slice(0, 8));

    const channel = supabase
      .channel(`player_answers:${playerSession.playerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "player_answers",
          filter: `session_id=eq.${playerSession.playerId}`
        },
        (payload) => {
          console.log("[PlayPage] 🔔 Player answer update:", payload);

          const answer = payload.new as any;
          const isCorrect = answer.is_correct === true;

          // Update player answers (for coloring numbers)
          setPlayerAnswers(prev => ({
            ...prev,
            [answer.question_number]: isCorrect
          }));

          // Update stats
          setGlobalStats(prev => ({
            answered: prev.answered + 1,
            correct: prev.correct + (isCorrect ? 1 : 0),
            incorrect: prev.incorrect + (!isCorrect ? 1 : 0),
            accuracy: Math.round(
              ((prev.correct + (isCorrect ? 1 : 0)) / (prev.answered + 1)) * 100
            )
          }));
        }
      )
      .subscribe();

    return () => {
      console.log("[PlayPage] 🔌 Unsubscribing from player_answers");
      supabase.removeChannel(channel);
    };
  }, [event, isPreview, playerSession]);

  // Countdown timer with auto-negative answer on expiry
  useEffect(() => {
    if (timeRemaining <= 0) {
      // CRITICAL: Auto-submit negative answer if not answered yet
      if (currentQuestion && !playerAnswers[currentQuestion.question_number] && !submittingAnswer) {
        console.log("[PlayPage] ⏰ Timer expired - auto-submitting NEGATIVE answer");
        handleAutoNegativeAnswer();
      }
      return;
    }

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        const newTime = Math.max(0, prev - 1);
        
        // Check if timer just hit 0
        if (newTime === 0 && prev === 1) {
          console.log("[PlayPage] ⏰ Timer reached 0 - triggering auto-negative");
        }
        
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeRemaining, currentQuestion, playerAnswers, submittingAnswer]);

  // Auto-submit negative answer when timer expires
  const handleAutoNegativeAnswer = async () => {
    if (!currentQuestion || !event || !playerSession || !tickets || tickets.length === 0) {
      console.log("[PlayPage] ⚠️ Cannot auto-submit - missing data");
      return;
    }

    console.log("[PlayPage] 🔴 AUTO-NEGATIVE ANSWER:", {
      playerId: playerSession.playerId.slice(0, 8),
      questionNumber: currentQuestion.question_number,
      reason: "Timer expired - no answer submitted"
    });

    try {
      const dbSession = await answerService.getOrCreateSession(event.id);
      const firstTicket = tickets[0];

      // Submit as NO (negative)
      await answerService.submitAnswer(
        dbSession.id,
        event.id,
        currentQuestion.question_number,
        "NO",
        firstTicket.serial_number
      );

      // Mark as incorrect
      const isCorrect = false;

      console.log("[PlayPage] ✅ Auto-negative answer submitted");

      // Update per-ticket stats
      setTicketStats(prev => ({
        ...prev,
        [firstTicket.serial_number]: {
          answered: (prev[firstTicket.serial_number]?.answered || 0) + 1,
          correct: prev[firstTicket.serial_number]?.correct || 0,
          incorrect: (prev[firstTicket.serial_number]?.incorrect || 0) + 1,
          accuracy: Math.round(
            ((prev[firstTicket.serial_number]?.correct || 0) /
              ((prev[firstTicket.serial_number]?.answered || 0) + 1)) * 100
          )
        }
      }));

      // Update global stats
      setGlobalStats(prev => ({
        answered: prev.answered + 1,
        correct: prev.correct,
        incorrect: prev.incorrect + 1,
        accuracy: Math.round(
          (prev.correct / (prev.answered + 1)) * 100
        )
      }));

      // Update player answers (for coloring numbers RED)
      setPlayerAnswers(prev => ({
        ...prev,
        [currentQuestion.question_number]: false
      }));

    } catch (error: any) {
      console.error("[PlayPage] ❌ Auto-negative submit error:", error);
    }
  };

  // Handle Answer Submission
  const handleAnswer = async (answerYesNo: boolean) => {
    if (!currentQuestion || !event) return;

    if (submittingAnswer) {
      console.log("[PlayPage] ⚠️ Already submitting");
      return;
    }

    // Check if already answered
    if (playerAnswers[currentQuestion.question_number] !== undefined) {
      console.log("[PlayPage] ⚠️ Already answered this question");
      return;
    }

    // Preview: Check session
    if (isPreview) {
      const session = getPreviewPlayerSession();
      
      if (!session || !session.playerId) {
        console.log("[PlayPage] ❌ No session, open registration");
        setShowRegistration(true);
        return;
      }

      if (!tickets || tickets.length === 0) {
        console.log("[PlayPage] ❌ No tickets");
        setShowRegistration(true);
        return;
      }

      console.log("[PlayPage] 🔍 PREVIEW SUBMIT:", {
        playerId: session.playerId.slice(0, 8),
        nickname: session.nickname,
        eventId: event.id.slice(0, 8),
        ticketId: tickets[0].id.slice(0, 8),
        questionNumber: currentQuestion.question_number,
        answer: answerYesNo ? "DA" : "NE"
      });
    } else {
      // Production guard
      if (!email || !nickname) {
        toast({
          title: "Greška",
          description: "Molimo prijavite se prvo.",
          variant: "destructive"
        });
        return;
      }
    }

    setSubmittingAnswer(true);

    try {
      // Get or create session
      const dbSession = await answerService.getOrCreateSession(event.id);
      const firstTicket = tickets[0];

      // Submit answer
      await answerService.submitAnswer(
        dbSession.id,
        event.id,
        currentQuestion.question_number,
        answerYesNo ? "YES" : "NO",
        firstTicket.serial_number
      );

      // Calculate if correct
      const isCorrect = (answerYesNo ? "YES" : "NO") === 
        (currentQuestion.questions?.correct_answer ? "YES" : "NO");

      console.log("[PlayPage] ✅ Answer submitted:", {
        question: currentQuestion.question_number,
        answer: answerYesNo ? "DA" : "NE",
        correct: isCorrect
      });

      // Update ticket stats (local state)
      setTicketStats(prev => {
        const current = prev[firstTicket.serial_number] || { 
          answered: 0, 
          correct: 0, 
          incorrect: 0, 
          accuracy: 0 
        };
        const newAnswered = current.answered + 1;
        const newCorrect = current.correct + (isCorrect ? 1 : 0);
        const newIncorrect = current.incorrect + (!isCorrect ? 1 : 0);
        const newAccuracy = Math.round((newCorrect / newAnswered) * 100);

        return {
          ...prev,
          [firstTicket.serial_number]: {
            answered: newAnswered,
            correct: newCorrect,
            incorrect: newIncorrect,
            accuracy: newAccuracy
          }
        };
      });

      // Update player answers (for coloring numbers)
      setPlayerAnswers(prev => ({
        ...prev,
        [currentQuestion.question_number]: isCorrect
      }));

      // Show toast
      toast({
        title: isCorrect ? "Točno!" : "Netočno",
        description: isCorrect ? "Odlično!" : "Pokušaj bolje sljedeći put.",
        variant: isCorrect ? "default" : "destructive"
      });

    } catch (error: any) {
      console.error("[PlayPage] ❌ Submit error:", error);
      toast({
        title: "Greška",
        description: error.message || "Neuspjelo slanje odgovora.",
        variant: "destructive"
      });
    } finally {
      setSubmittingAnswer(false);
    }
  };

  // Calculate Global Stats
  const globalStats = {
    totalQuestions: Object.keys(drawnQuestions).length,
    totalCorrect: Object.values(playerAnswers).filter(v => v === true).length,
    totalIncorrect: Object.values(playerAnswers).filter(v => v === false).length,
    accuracy: Object.values(playerAnswers).length > 0
      ? Math.round((Object.values(playerAnswers).filter(v => v === true).length / Object.values(playerAnswers).length) * 100)
      : 0
  };

  // Preview: If no session, show only onboarding/registration
  if (isPreview && !playerSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
        <Head>
          <title>Pitalica Skitalica - Igraj</title>
        </Head>

        <OnboardingModal
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
          onDismiss={(dontShowAgain) => {
            setShowOnboarding(false);
            setShowRegistration(true);
          }}
        />

        <RegistrationModal
          open={showRegistration}
          onOpenChange={setShowRegistration}
          onSuccess={(result) => {
            console.log("[PlayPage] ✅ Registration success:", {
              player_id: result.player_id,
              nickname: result.nickname,
              tickets_created: result.tickets_created
            });

            const session: Omit<PreviewPlayerSession, "timestamp"> = {
              eventId: event?.id || "",
              playerId: result.player_id,
              nickname: result.nickname,
              email: result.email,
              ticketIds: result.tickets.map((t: any) => t.id)
            };
            
            setPreviewPlayerSession(session);
            
            setPlayerSession({
              ...session,
              timestamp: Date.now()
            });
            setNickname(result.nickname);
            setEmail(result.email);
            setTickets(result.tickets);
            setShowRegistration(false);
            setShowOnboarding(false);
            
            toast({
              title: "Uspješno!",
              description: `Preuzeto ${result.tickets_created} listića.`
            });
          }}
          eventId={event?.id || ""}
          venueId=""
        />
      </div>
    );
  }

  // Loading state
  if (eventLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-gray-500">Učitavanje...</span>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-6 bg-white rounded-lg shadow-sm">
          <p className="text-gray-500">Nema aktivnog događaja.</p>
        </div>
      </div>
    );
  }

  // Main Player UI (Production-like layout)
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400">
      <Head>
        <title>Pitalica Skitalica - Igraj</title>
      </Head>

      {/* PREVIEW DEBUG BANNER */}
      {isPreview && event && (
        <div className="bg-green-600 text-white text-center py-2 text-sm font-mono">
          <strong>PREVIEW MODE = PROD LOGIC</strong>
          <span className="ml-4">
            Event: {event.id.slice(0, 8)}... | 
            Player: {playerSession?.nickname || "N/A"} | 
            ID: {playerSession?.playerId?.slice(0, 8) || "N/A"} |
            Q: {currentQuestion?.question_number || 0}/90 | 
            QID: {currentQuestion?.question_id?.slice(0, 8) || "N/A"} |
            Tickets: {tickets.length} |
            RT: {realtimeConnected ? "✓" : "✗"}
          </span>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg text-primary">PITALICA SKITALICA</h1>
            </div>
            <Badge variant={event.status === "active" ? "default" : "secondary"}>
              {event.status === "active" ? "U TOKU" : event.status}
            </Badge>
          </div>
          
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-gray-500" />
              <span className="font-medium">{playerSession?.nickname || nickname || "Igrač"}</span>
            </div>
            <div className="text-gray-600">{event.name}</div>
          </div>
        </div>
        
        {/* Global Stats Bar */}
        <div className="bg-gray-50 border-t">
          <div className="container mx-auto px-4 py-2 grid grid-cols-4 gap-4 text-center text-xs">
            <div>
              <div className="font-bold text-lg">{globalStats.totalQuestions}/90</div>
              <div className="text-gray-500">PITANJA</div>
            </div>
            <div>
              <div className="font-bold text-lg text-green-600">{globalStats.totalCorrect}</div>
              <div className="text-gray-500">TOČNO</div>
            </div>
            <div>
              <div className="font-bold text-lg text-red-600">{globalStats.totalIncorrect}</div>
              <div className="text-gray-500">NETOČNO</div>
            </div>
            <div>
              <div className="font-bold text-lg text-blue-600">{globalStats.accuracy}%</div>
              <div className="text-gray-500">TOČNOST</div>
            </div>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-6 space-y-6">
        
        {/* CURRENT QUESTION CARD */}
        {currentQuestion ? (
          <Card className="border-primary/20 shadow-md overflow-hidden">
            <div className="bg-primary/5 p-4 border-b border-primary/10 flex justify-between items-center">
              <span className="font-bold text-primary">Pitanje #{currentQuestion.question_number}</span>
              <Badge variant="outline" className="bg-white">10s</Badge>
            </div>
            <CardContent className="p-6 text-center space-y-6">
              <h2 className="text-xl font-bold text-gray-800 leading-relaxed">
                {currentQuestion.questions?.text || "Učitavanje teksta pitanja..."}
              </h2>

              {/* DA/NE BUTTONS */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <Button 
                  size="lg" 
                  className="bg-green-500 hover:bg-green-600 text-white h-16 text-lg"
                  onClick={() => handleAnswer(true)}
                  disabled={submittingAnswer || playerAnswers[currentQuestion.question_number] !== undefined}
                >
                  <ThumbsUp className="mr-2 h-6 w-6" /> DA
                </Button>
                <Button 
                  size="lg" 
                  className="bg-red-500 hover:bg-red-600 text-white h-16 text-lg"
                  onClick={() => handleAnswer(false)}
                  disabled={submittingAnswer || playerAnswers[currentQuestion.question_number] !== undefined}
                >
                  <ThumbsDown className="mr-2 h-6 w-6" /> NE
                </Button>
              </div>

              {/* FEEDBACK AFTER ANSWER */}
              {playerAnswers[currentQuestion.question_number] !== undefined && (
                <div className={cn(
                  "p-4 rounded-lg animate-in fade-in slide-in-from-bottom-2",
                  playerAnswers[currentQuestion.question_number]
                    ? "bg-green-50 border border-green-200 text-green-800"
                    : "bg-red-50 border border-red-200 text-red-800"
                )}>
                  <p className="font-medium">
                    {playerAnswers[currentQuestion.question_number] 
                      ? "✓ Točan odgovor!" 
                      : "✗ Netočan odgovor"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-gray-100 border-dashed">
            <CardContent className="p-8 text-center text-gray-500">
              <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin opacity-50" />
              <p>Čekanje na iduće pitanje...</p>
            </CardContent>
          </Card>
        )}

        {/* TICKETS GRID (2x2) */}
        {tickets.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-bold text-white flex items-center gap-2">
              <TicketIcon className="h-5 w-5" /> Moji Listići ({tickets.length})
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {tickets.map((ticket, idx) => {
                const stats = ticketStats[ticket.serial_number] || { 
                  answered: 0, 
                  correct: 0, 
                  incorrect: 0, 
                  accuracy: 0 
                };
                
                return (
                  <Card key={ticket.id} className="overflow-hidden border-2 hover:border-primary/30 transition-colors">
                    {/* Serial Number Header */}
                    <div className="bg-gray-50 p-2 text-xs text-center border-b font-mono text-gray-500 truncate">
                      {ticket.serial_number}
                    </div>
                    
                    {/* Stats Row */}
                    <div className="bg-white p-2 border-b grid grid-cols-3 gap-1 text-center text-xs">
                      <div>
                        <div className="font-bold text-green-600">{stats.correct}</div>
                        <div className="text-gray-400">T</div>
                      </div>
                      <div>
                        <div className="font-bold text-red-600">{stats.incorrect}</div>
                        <div className="text-gray-400">N</div>
                      </div>
                      <div>
                        <div className="font-bold text-blue-600">{stats.accuracy}%</div>
                        <div className="text-gray-400">%</div>
                      </div>
                    </div>
                    
                    {/* Numbers Grid */}
                    <CardContent className="p-2">
                      <div className="grid grid-cols-5 gap-1">
                        {ticket.ticket_numbers?.sort((a, b) => a - b).map(num => {
                          const isDrawn = drawnQuestions[num];
                          const wasAnswered = playerAnswers[num] !== undefined;
                          const wasCorrect = playerAnswers[num] === true;
                          
                          return (
                            <div 
                              key={num} 
                              className={cn(
                                "aspect-square flex items-center justify-center text-[10px] font-bold rounded",
                                isDrawn && wasAnswered && wasCorrect 
                                  ? "bg-green-500 text-white" 
                                  : isDrawn && wasAnswered && !wasCorrect
                                  ? "bg-red-500 text-white"
                                  : isDrawn
                                  ? "bg-primary text-white"
                                  : "bg-gray-100 text-gray-400"
                              )}
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
          </div>
        )}

      </main>
    </div>
  );
}