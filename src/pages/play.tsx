import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { ticketService, Ticket } from "@/services/ticketService";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { answerService } from "@/services/answerService";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Loader2, 
  AlertCircle, 
  RefreshCcw,
  ThumbsUp,
  ThumbsDown,
  Trophy,
  TrendingUp,
  Ticket as TicketIcon
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
  
  // State
  const [isPreview, setIsPreview] = useState(false);
  const [playerSession, setPlayerSession] = useState<PreviewPlayerSession | null>(null);
  const [nickname, setNickname] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  
  const [event, setEvent] = useState<Event | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  
  const [ticket, setTicket] = useState<Ticket[]>([]); // Array of tickets
  const [ticketStats, setTicketStats] = useState<Record<string, { answered: number; correct: number; incorrect: number; accuracy: number }>>({});
  
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionTimer, setQuestionTimer] = useState(0);
  const [isQuestionActive, setIsQuestionActive] = useState(false);
  
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [playerAnswers, setPlayerAnswers] = useState<Record<number, { answer: boolean; isCorrect: boolean }>>({});
  const [answerFeedback, setAnswerFeedback] = useState<{
    show: boolean;
    message: string;
    isCorrect: boolean;
  }>({ show: false, message: "", isCorrect: false });

  // Modals
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);

  // Initialize Preview Mode
  useEffect(() => {
    setIsPreview(isPreviewEnvironment());
  }, []);

  // 1. Load Preview Session
  useEffect(() => {
    if (!isPreview) return;

    console.log("[PlayPage] 🔍 Loading Preview session...");
    const session = getPreviewPlayerSession();
    
    if (session) {
      console.log("[PlayPage] ✅ Session found:", {
        playerId: session.playerId.slice(0, 8),
        nickname: session.nickname,
        ticketCount: session.ticketIds.length
      });
      setPlayerSession(session);
      setNickname(session.nickname);
      setEmail(session.email);
    } else {
      console.log("[PlayPage] ⚠️ No session found - show onboarding");
      setShowOnboarding(true);
    }
  }, [isPreview]);

  // 2. Load Active Event
  useEffect(() => {
    if (!router.isReady) return;

    const loadActiveEvent = async () => {
      setEventLoading(true);
      setEventError(null);

      // Timeout safety for Preview
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        if (isPreview) {
          controller.abort();
          console.log("[PlayPage] ⏱️ Event fetch timeout after 8s");
        }
      }, 8000);

      try {
        const activeEvent = await eventService.getActiveEvent();
        clearTimeout(timeoutId);
        
        setEvent(activeEvent);
        console.log("[PlayPage] ✅ Event loaded:", {
          id: activeEvent.id.slice(0, 8),
          name: activeEvent.name,
          status: activeEvent.status
        });
      } catch (error: any) {
        clearTimeout(timeoutId);
        const errorMsg = error.name === 'AbortError' 
          ? "Timeout: Ne mogu učitati događaj nakon 8 sekundi."
          : error.message || "Greška pri učitavanju događaja.";
        
        console.error("[PlayPage] ❌ Event load error:", errorMsg);
        setEventError(errorMsg);
      } finally {
        setEventLoading(false);
      }
    };

    // Load if in Preview OR Debug mode
    if (isPreview || router.query.debug === "1") {
      loadActiveEvent();
    }
  }, [router.isReady, isPreview, router.query.debug]);

  // 3. Load Tickets (Preview: from session, Prod: by event)
  useEffect(() => {
    if (!event) return;

    const loadTickets = async () => {
      try {
        if (isPreview && playerSession) {
          // Preview: Load tickets from session IDs
          console.log("[PlayPage] 📋 Loading Preview tickets:", playerSession.ticketIds);
          
          if (playerSession.ticketIds.length > 0) {
            const ticketPromises = playerSession.ticketIds.map(id => 
              ticketService.getTicket(id).catch(e => {
                console.warn(`[PlayPage] Failed to load ticket ${id}`, e);
                return null;
              })
            );
            
            const results = await Promise.all(ticketPromises);
            const validTickets = results.filter(t => t !== null) as Ticket[];
            setTicket(validTickets);
            
            // Init stats
            const stats: any = {};
            validTickets.forEach(t => {
              stats[t.serial_number] = { answered: 0, correct: 0, incorrect: 0, accuracy: 0 };
            });
            setTicketStats(stats);
          }
        } else if (!isPreview && email) {
          // Production: Load by email
          const tickets = await ticketService.getPlayerTickets(email, event.id);
          setTicket(tickets);
        }
      } catch (error) {
        console.error("[PlayPage] ❌ Failed to load tickets:", error);
      }
    };

    loadTickets();
  }, [isPreview, playerSession, event, email]);

  // 4. Realtime Subscription (Event & Questions)
  useEffect(() => {
    if (!event) return;

    const subscription = eventService.subscribeToEvent(event.id, (payload) => {
      if (payload.new) {
        const updatedEvent = payload.new as Event;
        setEvent(updatedEvent);
        
        // Handle new question drawn
        if (updatedEvent.current_question_number !== event.current_question_number) {
           // Logic handled in event_questions subscription or by polling question details
        }
      }
    });

    // Subscribe to questions to get the actual question text immediately
    const qSub = eventService.subscribeToEventQuestions(event.id, async (payload) => {
       if (payload.new && payload.new.drawn) {
         const qData = payload.new as EventQuestion;
         // Need to fetch full question details including text
         const fullQuestion = await eventService.getEventQuestion(event.id, qData.question_number);
         setCurrentQuestion(fullQuestion);
         setAnswerFeedback({ show: false, message: "", isCorrect: false });
         setIsQuestionActive(true);
         // Reset timer logic here if needed
       }
    });

    return () => {
      subscription.unsubscribe();
      qSub.unsubscribe();
    };
  }, [event?.id]);


  // Handle Answer
  const handleAnswer = async (answerYesNo: boolean) => {
    if (!currentQuestion || !event) return;

    if (submittingAnswer) return;

    // PREVIEW GUARD
    if (isPreview) {
      // Check nickname as primary auth indicator in Preview
      if (!nickname || nickname === "Igrač") {
        console.log("[PlayPage] ❌ No valid nickname/session in Preview");
        setAnswerFeedback({
          show: true,
          message: "Nema aktivne prijave u Previewu",
          isCorrect: false
        });
        return;
      }

      if (!ticket || ticket.length === 0) {
        setAnswerFeedback({
          show: true,
          message: "Nema aktivnih tiketa",
          isCorrect: false
        });
        return;
      }
      
      console.log("[PlayPage] ✅ Preview submit validated for:", nickname);
    } else {
      // PROD GUARD
      if (!email || !nickname) {
        toast({
          title: "Greška",
          description: "Molimo prijavite se prvo.",
          variant: "destructive",
        });
        return;
      }
    }

    setSubmittingAnswer(true);

    try {
      // Get Session
      const session = await answerService.getOrCreateSession(event.id);
      
      // Use first ticket for submission context
      const activeTicket = ticket[0];
      if (!activeTicket) throw new Error("No active ticket");

      // Submit
      await answerService.submitAnswer(
        session.id,
        event.id,
        currentQuestion.question_number,
        answerYesNo ? "YES" : "NO",
        activeTicket.serial_number
      );

      // Local Validation (Optimistic)
      const isCorrect = currentQuestion.questions?.correct_answer === answerYesNo;

      setAnswerFeedback({
        show: true,
        message: isCorrect ? "✓ Točan odgovor!" : "✗ Netočan odgovor",
        isCorrect
      });

      // Update local state
      setPlayerAnswers(prev => ({
        ...prev,
        [currentQuestion.question_number]: { answer: answerYesNo, isCorrect }
      }));

      // Log success in Preview
      if (isPreview) {
        console.log("[PlayPage] ✅ Answer submitted:", {
          q: currentQuestion.question_number,
          ans: answerYesNo ? "DA" : "NE",
          correct: isCorrect
        });
      }

    } catch (error: any) {
      console.error("[PlayPage] Submit error:", error);
      toast({
        title: "Greška",
        description: "Neuspjelo slanje odgovora.",
        variant: "destructive"
      });
    } finally {
      setSubmittingAnswer(false);
    }
  };


  // --- RENDER ---

  if (eventLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-gray-500">Učitavanje...</span>
      </div>
    );
  }

  if (eventError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-red-50 p-4">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h3 className="text-lg font-bold text-red-700">Greška</h3>
        <p className="text-red-600 mb-4">{eventError}</p>
        <Button onClick={() => window.location.reload()} variant="outline">
          <RefreshCcw className="mr-2 h-4 w-4" /> Pokušaj ponovno
        </Button>
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

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Head>
        <title>Pitalica Skitalica - Igraj</title>
      </Head>

      {/* DEBUG BANNER (Preview Only) */}
      {isPreview && (
        <div className="bg-green-600 text-white text-xs font-mono py-1 px-2 text-center">
          PREVIEW | Player: {nickname || "N/A"} | Tickets: {ticket.length} | Evt: {event.id.slice(0,6)}
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white border-b sticky top-0 z-10 px-4 py-3 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="font-bold text-primary text-lg">Pitalica Skitalica</h1>
          <p className="text-xs text-gray-500">
            {nickname ? `Igrač: ${nickname}` : "Dobrodošli!"}
          </p>
        </div>
        <div className="flex items-center gap-2">
           <Badge variant={event.status === 'active' ? 'default' : 'secondary'}>
             {event.status === 'active' ? 'UŽIVO' : event.status}
           </Badge>
        </div>
      </div>

      <main className="container mx-auto px-4 py-6 max-w-lg">
        
        {/* ACTIVE QUESTION CARD */}
        {currentQuestion ? (
          <Card className="mb-6 border-primary/20 shadow-md overflow-hidden">
            <div className="bg-primary/5 p-4 border-b border-primary/10 flex justify-between items-center">
              <span className="font-bold text-primary">Pitanje #{currentQuestion.question_number}</span>
              {/* Timer placeholder */}
              <Badge variant="outline" className="bg-white">9s</Badge> 
            </div>
            <CardContent className="p-6 text-center space-y-6">
              <h2 className="text-xl font-bold text-gray-800 leading-relaxed">
                {currentQuestion.questions?.text || "Učitavanje teksta pitanja..."}
              </h2>

              {/* FEEDBACK MSG */}
              {answerFeedback.show && (
                <div className={cn(
                  "p-3 rounded-md text-sm font-medium animate-in fade-in slide-in-from-bottom-2",
                  answerFeedback.message.includes("Nema aktivne") ? "bg-orange-100 text-orange-800" :
                  answerFeedback.isCorrect ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                )}>
                  {answerFeedback.message}
                  {answerFeedback.message.includes("Nema aktivne") && (
                     <div className="mt-2 text-xs underline cursor-pointer" onClick={() => window.location.reload()}>
                       Osvježi za registraciju
                     </div>
                  )}
                </div>
              )}

              {/* ACTION BUTTONS */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <Button 
                  size="lg" 
                  className="bg-green-500 hover:bg-green-600 text-white h-16 text-lg"
                  onClick={() => handleAnswer(true)}
                  disabled={submittingAnswer || answerFeedback.show}
                >
                  <ThumbsUp className="mr-2 h-6 w-6" /> DA
                </Button>
                <Button 
                  size="lg" 
                  className="bg-red-500 hover:bg-red-600 text-white h-16 text-lg"
                  onClick={() => handleAnswer(false)}
                  disabled={submittingAnswer || answerFeedback.show}
                >
                  <ThumbsDown className="mr-2 h-6 w-6" /> NE
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6 bg-gray-100 border-dashed">
            <CardContent className="p-8 text-center text-gray-500">
              <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin opacity-50" />
              <p>Čekanje na iduće pitanje...</p>
            </CardContent>
          </Card>
        )}

        {/* TICKET GRID (2x2) */}
        {ticket.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-bold text-gray-700 flex items-center gap-2">
              <TicketIcon className="h-4 w-4" /> Moji Listići ({ticket.length})
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {ticket.slice(0, 4).map((t, idx) => (
                <Card key={t.id} className="overflow-hidden border-2 hover:border-primary/30 transition-colors">
                  <div className="bg-gray-50 p-2 text-xs text-center border-b font-mono text-gray-500 truncate">
                    {t.serial_number}
                  </div>
                  <CardContent className="p-2">
                    <div className="grid grid-cols-5 gap-1">
                      {t.ticket_numbers?.sort((a,b)=>a-b).map(num => {
                        // Simple visualization logic
                        const isDrawn = event.drawn_numbers?.includes(num);
                        // In real app, check if answered correctly for specific number/question
                        return (
                          <div 
                            key={num} 
                            className={cn(
                              "aspect-square flex items-center justify-center text-[10px] font-bold rounded",
                              isDrawn ? "bg-primary text-white" : "bg-gray-100 text-gray-400"
                            )}
                          >
                            {num}
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* MODALS (Preview Only) */}
      {isPreview && (
        <>
          <OnboardingModal 
            open={showOnboarding} 
            onOpenChange={setShowOnboarding}
            onDismiss={() => {
              setShowOnboarding(false);
              setShowRegistration(true);
            }}
          />
          <RegistrationModal
            open={showRegistration}
            onOpenChange={setShowRegistration}
            eventId={event?.id || ""}
            venueId=""
            onSuccess={(result) => {
              console.log("[PlayPage] Registration Success:", result);
              const ticketIds = result.tickets?.map((t: any) => t.id) || [];
              
              // Save Preview Session
              const newSession: PreviewPlayerSession = {
                eventId: event?.id || "",
                playerId: result.player_id,
                nickname: result.nickname,
                email: result.email,
                ticketIds,
                timestamp: Date.now()
              };
              setPreviewPlayerSession(newSession);
              
              // Update State
              setPlayerSession(newSession);
              setNickname(newSession.nickname);
              setTicket(result.tickets || []);
              setShowRegistration(false);
              
              toast({ title: "Registracija uspješna!", description: "Listići preuzeti." });
            }}
          />
        </>
      )}
    </div>
  );
}