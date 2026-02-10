import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ticketService, Ticket } from "@/services/ticketService";
import { eventService, Event } from "@/services/eventService";
import { getSupabaseDebugInfo } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Ticket as TicketIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import Head from "next/head";
import { RegistrationModal } from "@/components/RegistrationModal";
import { OnboardingModal } from "@/components/OnboardingModal";

export default function PlayPage() {
  const router = useRouter();
  const { venue: venueSlug, debug } = router.query;
  
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [event, setEvent] = useState<Event | null>(null);
  const [ticket, setTicket] = useState<Ticket[] | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [envError, setEnvError] = useState(false);
  const [timeoutError, setTimeoutError] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [lastRequest, setLastRequest] = useState<string>("");

  const isDebugMode = debug === "1";

  // ENV validation on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const info = getSupabaseDebugInfo();
      setDebugInfo(info);
      
      if (!info?.client_ready) {
        setEnvError(true);
        console.error("[PlayPage] ❌ Supabase ENV missing");
      }
    }
  }, []);

  // Load active event with timeout
  useEffect(() => {
    if (!router.isReady || envError) {
      if (envError) setLoadingEvent(false);
      return;
    }

    const loadActiveEvent = async () => {
      const timeoutId = setTimeout(() => {
        setTimeoutError(true);
        setLoadingEvent(false);
        console.error("[PlayPage] ⏱️ Timeout after 8s");
      }, 8000);

      try {
        setLastRequest("eventService.getActiveEvent");
        if (isDebugMode) {
          console.log("[PlayPage] Request: getActiveEvent");
        }

        // Fix: Removed venueSlug argument as getActiveEvent takes no args
        const activeEvent = await eventService.getActiveEvent();
        
        clearTimeout(timeoutId);
        
        if (isDebugMode) {
          console.log("[PlayPage] Response: getActiveEvent", {
            success: !!activeEvent,
            event_id: activeEvent?.id,
            event_name: activeEvent?.name
          });
        }

        setEvent(activeEvent);
      } catch (error: any) {
        clearTimeout(timeoutId);
        
        if (isDebugMode) {
          console.error("[PlayPage] Error: getActiveEvent", {
            code: error.code,
            message: error.message,
            details: error.details
          });
        }

        console.error("Error loading active event:", error);
      } finally {
        clearTimeout(timeoutId);
        setLoadingEvent(false);
      }
    };

    loadActiveEvent();
  }, [router.isReady, venueSlug, envError, isDebugMode]);

  // Auto-load existing tickets for registered players
  useEffect(() => {
    if (!event || ticket) return;

    const loadExistingTickets = async () => {
      try {
        const savedEmail = localStorage.getItem("player_email");
        if (!savedEmail) return;

        if (isDebugMode) {
          console.log("[PlayPage] Auto-loading tickets for:", savedEmail);
        }

        const tickets = await ticketService.getPlayerTickets(savedEmail, event.id);
        
        if (isDebugMode) {
          console.log("[PlayPage] Loaded tickets:", tickets.length);
        }

        if (tickets.length > 0) {
          setTicket(tickets);
        }
      } catch (error) {
        console.error("[PlayPage] Error loading existing tickets:", error);
      }
    };

    loadExistingTickets();
  }, [event, ticket, isDebugMode]);

  const handleRegistrationSuccess = (result: any) => {
    if (result.success && result.tickets) {
      setTicket(result.tickets);
      setShowRegistration(false);
      setShowOnboarding(true);
      toast({
        title: "Uspješno!",
        description: `Kreirano ${result.tickets.length} listića.`,
      });
    }
  };

  // ENV Error Screen
  if (envError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md border-red-200 shadow-xl">
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
            <div className="bg-red-50 p-3 rounded text-sm text-red-700 font-mono">
              <p>NEXT_PUBLIC_SUPABASE_URL</p>
              <p>NEXT_PUBLIC_SUPABASE_ANON_KEY</p>
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
        <Card className="w-full max-w-md border-orange-200 shadow-xl">
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

  return (
    <>
      <Head>
        <title>Igraj Pitalicu Skitalicu</title>
      </Head>

      <div className="min-h-screen bg-gray-100">
        {/* DEBUG Banner - Preview Only */}
        {typeof window !== "undefined" && 
         (window.location.hostname.includes("softgen") || 
          window.location.hostname.includes("vercel.app") ||
          window.location.hostname.includes("localhost")) && (
          <div className="bg-green-600 text-white text-center py-2 text-sm font-mono">
            <strong>PLAYER PREVIEW = PROD LOGIC</strong>
            {event && (
              <span className="ml-4">
                Event: {event.id.slice(0, 8)}... | 
                Tickets: {ticket?.length || 0} | 
                {ticket && ticket.length > 0 && (() => {
                  const totalCorrect = ticket.reduce((sum, t) => {
                    const correct = (t.ticket_questions || []).filter((q: any) => q.is_correct === true).length;
                    return sum + correct;
                  }, 0);
                  const totalIncorrect = ticket.reduce((sum, t) => {
                    const incorrect = (t.ticket_questions || []).filter((q: any) => q.is_correct === false).length;
                    return sum + incorrect;
                  }, 0);
                  return ` Global T:${totalCorrect} N:${totalIncorrect}`;
                })()}
              </span>
            )}
          </div>
        )}

        {/* Header */}
        <div className="bg-white shadow-sm border-b">
          <div className="container mx-auto px-4 py-4">
            <h1 className="text-2xl font-bold text-center">Pitalica Skitalica</h1>
          </div>
        </div>

        <main className="container mx-auto px-4 py-8">
          {loadingEvent ? (
            <div className="text-center py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
              <p className="text-gray-500">Učitavanje kviza...</p>
            </div>
          ) : !event ? (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">
                Nema aktivnog kviza na ovoj lokaciji. Pokušajte kasnije.
              </p>
              {isDebugMode && (
                <p className="text-xs text-gray-400 mt-2">Venue: {venueSlug || "default"}</p>
              )}
            </div>
          ) : !ticket ? (
            <Card className="max-w-md mx-auto shadow-md">
              <CardHeader>
                <CardTitle className="text-center">Dobrodošli!</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-center text-gray-600">
                  Registrirajte se i preuzmite svoje listiće
                </p>
                <Button 
                  onClick={() => setShowRegistration(true)}
                  className="w-full"
                  size="lg"
                >
                  Preuzmi listiće
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6 animate-in fade-in duration-500">
              <div className="text-center">
                <h2 className="text-xl font-bold mb-2">Vaši Listići</h2>
                <Badge variant="outline">{ticket.length} listića</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ticket.map((t) => (
                  <Card 
                    key={t.id}
                    className="cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
                    onClick={() => router.push(`/player?ticket=${t.id}${debug ? '&debug=1' : ''}`)}
                  >
                    <CardHeader className="pb-3 bg-gray-50/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <TicketIcon className="h-5 w-5 text-primary" />
                          <span className="font-bold text-lg">{t.serial_number}</span>
                        </div>
                        <Badge variant="secondary">Klikni za igru</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="grid grid-cols-5 gap-2">
                        {t.ticket_numbers?.sort((a, b) => a - b).slice(0, 15).map((num) => (
                          <div
                            key={num}
                            className="aspect-square rounded bg-white border flex items-center justify-center text-sm font-bold text-gray-700 shadow-sm"
                          >
                            {num}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Debug Panel */}
        {isDebugMode && debugInfo && (
          <div className="fixed bottom-4 right-4 bg-black/90 text-white p-4 rounded-lg text-xs font-mono max-w-sm space-y-1 z-50 shadow-2xl border border-gray-700">
            <p className="font-bold text-yellow-400 mb-2 flex justify-between">
              <span>🔍 DEBUG MODE</span>
              <span className="text-gray-400 cursor-pointer" onClick={() => window.location.href = window.location.pathname}>✕</span>
            </p>
            <p>hostname: <span className="text-green-300">{debugInfo.hostname}</span></p>
            <p>supabase_url: <span className="text-blue-300">{debugInfo.supabase_url_domain}</span></p>
            <p>url_masked: {debugInfo.supabase_url_last6}</p>
            <p>anon_key: {debugInfo.anon_key_present ? "✅ PRESENT" : "❌ MISSING"}</p>
            <p>key_masked: {debugInfo.anon_key_last6}</p>
            <p>client_ready: {debugInfo.client_ready ? "✅ YES" : "❌ NO"}</p>
            <p className="pt-2 border-t border-gray-600">last_request: <span className="text-yellow-300">{lastRequest}</span></p>
            {event && (
              <>
                <p className="pt-2 border-t border-gray-600">event_id: {event.id.slice(0, 8)}...</p>
                <p>event_name: {event.name}</p>
              </>
            )}
            {ticket && <p>tickets_count: {ticket.length}</p>}
          </div>
        )}

        <RegistrationModal
          open={showRegistration}
          onOpenChange={setShowRegistration}
          onSuccess={handleRegistrationSuccess}
          eventId={event?.id || ""}
          venueId={typeof venueSlug === "string" ? venueSlug : ""}
        />

        <OnboardingModal
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
          onDismiss={() => setShowOnboarding(false)}
        />
      </div>
    </>
  );
}