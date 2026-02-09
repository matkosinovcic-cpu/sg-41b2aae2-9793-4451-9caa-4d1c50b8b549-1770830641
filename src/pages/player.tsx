import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { ticketService, Ticket } from "@/services/ticketService";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { answerService, TicketStats } from "@/services/answerService";
import { supabase, getSupabaseDebugInfo } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Ticket as TicketIcon, Trophy, Ban, RefreshCcw, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import Head from "next/head";
import { cn } from "@/lib/utils";

// Helper for bingo grid checks
const checkBingoLine = (
  numbers: number[],
  drawnNumbers: number[]
): boolean => {
  if (numbers.length === 0) return false;
  return numbers.every(num => drawnNumbers.includes(num));
};

export default function PlayerPage() {
  const router = useRouter();
  const { ticket: ticketId, debug } = router.query;
  
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [drawnQuestions, setDrawnQuestions] = useState<Record<number, boolean>>({});
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<EventQuestion | null>(null);
  const [lastDrawnNumber, setLastDrawnNumber] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "reconnecting">("connected");
  const [envError, setEnvError] = useState(false);
  const [timeoutError, setTimeoutError] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [lastRequest, setLastRequest] = useState<string>("");
  
  // Confetti effect reference
  const confettiRef = useRef<any>(null);

  const isDebugMode = debug === "1";

  // ENV validation on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const info = getSupabaseDebugInfo();
      setDebugInfo(info);
      
      if (!info?.client_ready) {
        setEnvError(true);
        setLoading(false);
        console.error("[PlayerPage] ❌ Supabase ENV missing");
      }
    }
  }, []);

  // Load initial data with timeout
  useEffect(() => {
    if (!ticketId || typeof ticketId !== "string" || envError) return;

    const loadData = async () => {
      const timeoutId = setTimeout(() => {
        setTimeoutError(true);
        setLoading(false);
        console.error("[PlayerPage] ⏱️ Timeout after 8s");
      }, 8000);

      try {
        setLoading(true);
        
        // 1. Get ticket details
        setLastRequest("ticketService.getTicket");
        if (isDebugMode) {
          console.log("[PlayerPage] Request: getTicket", { ticketId });
        }

        const ticketData = await ticketService.getTicket(ticketId);
        setTicket(ticketData);

        if (isDebugMode) {
          console.log("[PlayerPage] Response: getTicket", {
            success: !!ticketData,
            ticket_id: ticketData.id,
            numbers_count: ticketData.ticket_numbers?.length
          });
        }

        // 2. Get event details
        setLastRequest("eventService.getEvent");
        if (isDebugMode) {
          console.log("[PlayerPage] Request: getEvent", { eventId: ticketData.event_id });
        }

        const eventData = await eventService.getEvent(ticketData.event_id);
        setEvent(eventData);

        if (isDebugMode) {
          console.log("[PlayerPage] Response: getEvent", {
            success: !!eventData,
            event_id: eventData.id,
            event_name: eventData.name
          });
        }

        // 3. Get drawn questions map
        setLastRequest("eventService.getDrawnQuestions");
        const drawnMap = await eventService.getDrawnQuestions(ticketData.event_id);
        setDrawnQuestions(drawnMap);

        if (isDebugMode) {
          console.log("[PlayerPage] Response: getDrawnQuestions", {
            drawn_count: Object.keys(drawnMap).length
          });
        }

        // 4. Get ticket stats
        setLastRequest("answerService.getTicketStats");
        const statsData = await answerService.getTicketStats(ticketId);
        setStats(statsData);

        if (isDebugMode) {
          console.log("[PlayerPage] Response: getTicketStats", {
            total_questions: statsData?.total_questions,
            correct_answers: statsData?.correct_answers
          });
        }

        clearTimeout(timeoutId);

      } catch (error: any) {
        clearTimeout(timeoutId);
        
        if (isDebugMode) {
          console.error("[PlayerPage] Error:", {
            request: lastRequest,
            code: error.code,
            message: error.message,
            details: error.details
          });
        }

        console.error("Error loading player data:", error);
        toast({
          title: "Greška pri učitavanju",
          description: error.message || "Neuspjelo učitavanje podataka listića.",
          variant: "destructive",
        });
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    loadData();
  }, [ticketId, envError, isDebugMode]);

  // Setup realtime subscriptions AFTER ticket is loaded
  useEffect(() => {
    if (!ticket || !ticket.event_id) return;

    const eventSub = supabase
      .channel(`player-event-${ticket.event_id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
          filter: `id=eq.${ticket.event_id}`
        },
        (payload) => {
          if (payload.new) {
            setEvent(payload.new as Event);
            setLastDrawnNumber(payload.new.current_drawn_number);
          }
        }
      )
      .subscribe();

    return () => {
      eventSub.unsubscribe();
    };
  }, [ticket?.event_id]);

  // ENV Error Screen
  if (envError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md border-red-200">
          <CardHeader>
            <CardTitle className="text-red-500 flex items-center gap-2">
              <AlertCircle className="h-6 w-6" />
              Supabase ENV Missing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              Supabase environment variables are missing in this environment.
            </p>
            <div className="bg-red-50 p-3 rounded text-sm text-red-700">
              <p className="font-mono">NEXT_PUBLIC_SUPABASE_URL</p>
              <p className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</p>
            </div>
            <p className="text-sm text-gray-500">
              Set these in <strong>Softgen Settings → Environment</strong> for Preview.
            </p>
            {debugInfo && (
              <div className="bg-gray-100 p-3 rounded text-xs font-mono space-y-1">
                <p>hostname: {debugInfo.hostname}</p>
                <p>supabase_url: {debugInfo.supabase_url_domain}</p>
                <p>anon_key_present: {String(debugInfo.anon_key_present)}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Timeout Error Screen
  if (timeoutError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md border-orange-200">
          <CardHeader>
            <CardTitle className="text-orange-500 flex items-center gap-2">
              <AlertCircle className="h-6 w-6" />
              Request Timeout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              Ne mogu dohvatiti podatke (timeout nakon 8s).
            </p>
            <p className="text-sm text-gray-500">
              Otvori DevTools → Network i provjeri pozive prema *.supabase.co
            </p>
            <Button onClick={() => window.location.reload()} className="w-full">
              Pokušaj ponovno
            </Button>
            {debugInfo && (
              <div className="bg-gray-100 p-3 rounded text-xs font-mono space-y-1">
                <p>hostname: {debugInfo.hostname}</p>
                <p>supabase_url: {debugInfo.supabase_url_domain}</p>
                <p>last_request: {lastRequest}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-gray-500">Učitavanje listića...</p>
          {isDebugMode && (
            <p className="text-xs text-gray-400 mt-2">Request: {lastRequest}</p>
          )}
        </div>
      </div>
    );
  }

  // Render error state if no ticket
  if (!ticket || !event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-500 flex items-center gap-2">
              <Ban className="h-6 w-6" />
              Listić nije pronađen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              Traženi listić ne postoji ili je nevažeći.
            </p>
            <Button onClick={() => router.push('/')} className="w-full">
              Povratak na naslovnicu
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate progress
  const totalNumbers = ticket.ticket_numbers?.length || 15;
  const matchedNumbers = ticket.ticket_numbers?.filter(n => drawnQuestions[n]).length || 0;
  const progress = (matchedNumbers / totalNumbers) * 100;

  return (
    <>
      <Head>
        <title>Moj Listić #{ticket.serial_number} | Pitalica Skitalica</title>
      </Head>

      <div className="min-h-screen bg-gray-100 pb-20">
        {/* Header */}
        <div className="bg-white shadow-sm border-b sticky top-0 z-10">
          <div className="container mx-auto px-4 py-3 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <TicketIcon className="h-5 w-5 text-primary" />
              <span className="font-bold text-lg">{ticket.serial_number}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={event.status === "active" ? "default" : "secondary"}>
                {event.status === "active" ? "UŽIVO" : event.status}
              </Badge>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full h-1 bg-gray-100">
            <div 
              className="h-full bg-green-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <main className="container mx-auto px-4 py-6 space-y-6">
          {/* Status Cards */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                <span className="text-3xl font-bold text-primary">{matchedNumbers}</span>
                <span className="text-xs text-gray-500 uppercase mt-1">Pogođeno</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                <span className="text-3xl font-bold text-gray-400">
                  {totalNumbers - matchedNumbers}
                </span>
                <span className="text-xs text-gray-500 uppercase mt-1">Preostalo</span>
              </CardContent>
            </Card>
          </div>

          {/* Last Drawn Number */}
          {lastDrawnNumber && (
            <div className="bg-white rounded-xl p-6 shadow-sm border text-center animate-in fade-in zoom-in duration-300">
              <p className="text-sm text-gray-500 mb-2">Posljednji izvučeni broj</p>
              <div className="flex items-center justify-center">
                <div className="h-24 w-24 rounded-full bg-primary text-white flex items-center justify-center text-5xl font-bold shadow-lg ring-4 ring-primary/20">
                  {lastDrawnNumber}
                </div>
              </div>
              <div className="mt-4">
                {ticket.ticket_numbers?.includes(lastDrawnNumber) ? (
                  <Badge className="bg-green-500 hover:bg-green-600 text-lg py-1 px-4">
                    IMAM GA! 🎉
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-gray-400">
                    Nema na listiću
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Ticket Grid */}
          <Card className="overflow-hidden border-2 border-primary/10">
            <CardHeader className="bg-gray-50 border-b pb-4">
              <CardTitle className="text-center text-lg">Bingo Listić</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-5 gap-3">
                {ticket.ticket_numbers?.sort((a, b) => a - b).map((num) => {
                  const isDrawn = drawnQuestions[num];
                  const isLastDrawn = num === lastDrawnNumber;
                  
                  return (
                    <div
                      key={num}
                      className={cn(
                        "aspect-square rounded-lg flex items-center justify-center text-lg font-bold transition-all duration-300 relative overflow-hidden",
                        isDrawn 
                          ? "bg-primary text-white shadow-md scale-105" 
                          : "bg-white border-2 border-gray-100 text-gray-700 hover:border-primary/30",
                        isLastDrawn && "ring-4 ring-yellow-400 ring-offset-2 z-10 animate-pulse"
                      )}
                    >
                      {num}
                      {isDrawn && (
                        <div className="absolute inset-0 bg-white/10 flex items-center justify-center">
                          <div className="w-full h-full absolute animate-ping bg-white/20 rounded-full" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Winner Status */}
          {ticket.is_winner && (
            <Card className="bg-yellow-50 border-yellow-200 animate-in slide-in-from-bottom duration-700">
              <CardContent className="p-6 text-center">
                <Trophy className="h-16 w-16 text-yellow-500 mx-auto mb-4 animate-bounce" />
                <h2 className="text-2xl font-bold text-yellow-700 mb-2">ČESTITAMO!</h2>
                <p className="text-yellow-600">
                  Vaš listić je dobitni! Javite se osoblju za preuzimanje nagrade.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="text-center text-xs text-gray-400 pb-8">
            Listić ID: {ticket.id} <br/>
            Event: {event.name}
          </div>
        </main>

        {/* Debug Panel */}
        {isDebugMode && debugInfo && (
          <div className="fixed bottom-4 right-4 bg-black/90 text-white p-4 rounded-lg text-xs font-mono max-w-sm space-y-1 z-50">
            <p className="font-bold text-yellow-400 mb-2">🔍 DEBUG MODE</p>
            <p>hostname: {debugInfo.hostname}</p>
            <p>supabase_url: {debugInfo.supabase_url_domain}</p>
            <p>supabase_url_last6: {debugInfo.supabase_url_last6}</p>
            <p>anon_key_present: {String(debugInfo.anon_key_present)}</p>
            <p>anon_key_last6: {debugInfo.anon_key_last6}</p>
            <p>client_ready: {String(debugInfo.client_ready)}</p>
            <p className="pt-2 border-t border-gray-600">last_request: {lastRequest}</p>
            <p>ticket_id: {ticket.id.slice(0, 8)}...</p>
            <p>event_id: {event.id.slice(0, 8)}...</p>
            <p>event_name: {event.name}</p>
            <p>numbers_count: {ticket.ticket_numbers?.length || 0}</p>
            <p>drawn_count: {Object.keys(drawnQuestions).length}</p>
          </div>
        )}
      </div>
    </>
  );
}