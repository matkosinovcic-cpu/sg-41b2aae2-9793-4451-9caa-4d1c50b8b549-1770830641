import { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import { ticketService } from "@/services/ticketService";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Ticket as TicketIcon, AlertCircle } from "lucide-react";
import { RegistrationModal } from "@/components/RegistrationModal";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export default function PlayPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [ticketClaimed, setTicketClaimed] = useState(false);
  const [ticketData, setTicketData] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  
  // Debug state
  const [debugInfo, setDebugInfo] = useState({
    venue_slug: "",
    venue_id: "",
    event_id: "",
    event_name: "",
    rpc_name: "",
    rpc_params: "",
    rpc_status: "",
    tickets_created_count: 0,
    player_id: "",
    last_error: null
  });

  useEffect(() => {
    // Check for debug param
    if (typeof window !== 'undefined') {
      setShowDebug(window.location.search.includes('debug=1'));
    }
  }, []);

  useEffect(() => {
    if (!router.isReady) return;

    const loadData = async () => {
      try {
        setLoading(true);
        const slug = (router.query.venue as string) || null;
        
        // Debug update
        setDebugInfo(prev => ({ ...prev, venue_slug: slug || "none" }));

        // 1. Get Active Event
        const { event, mode } = await eventService.getActiveOrLastFinished();
        
        if (event) {
          setActiveEvent(event);
          setDebugInfo(prev => ({ 
            ...prev, 
            event_id: event.id, 
            event_name: event.name 
          }));

          // 2. Check for existing ticket in localStorage
          const savedTicket = localStorage.getItem(`ticket_${event.id}`);
          if (savedTicket) {
            const parsed = JSON.parse(savedTicket);
            setTicketData(parsed);
            setTicketClaimed(true);
            
            // Validate ticket exists in DB
            try {
              const ticket = await ticketService.getTicket(parsed.id);
              if (ticket) {
                setTicketData(ticket);
              } else {
                // Invalid ticket, clear local storage
                localStorage.removeItem(`ticket_${event.id}`);
                setTicketClaimed(false);
                setTicketData(null);
              }
            } catch (err) {
              console.error("Error validating ticket:", err);
            }
          }
        }
      } catch (error) {
        console.error("Error loading play page data:", error);
        toast({
          title: "Greška",
          description: "Ne mogu učitati podatke o eventu.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [router.isReady, router.query.venue]);

  const handleClaimTicket = async (email: string, nickname: string) => {
    if (!activeEvent) return;

    // Save user info
    localStorage.setItem("user_email", email);
    localStorage.setItem("user_nickname", nickname);

    // Update debug info
    setDebugInfo(prev => ({ 
      ...prev, 
      rpc_name: "claim_free_tickets", 
      rpc_params: JSON.stringify({ email, nickname, limit: 1 }) 
    }));

    try {
      // 1. Check existing tickets via localStorage (simple check)
      const existingTicket = localStorage.getItem(`ticket_${activeEvent.id}`);
      
      if (existingTicket) {
        setTicketData(JSON.parse(existingTicket));
        setTicketClaimed(true);
        return;
      }

      // 2. Claim Ticket via Service (RPC)
      // Note: We use the simpler method that auto-finds active event
      const result = await ticketService.createFreeTicket(
        email, 
        nickname, 
        activeEvent.id // REQUIRED: Pass eventId
      );

      // Handle Result
      const responseData = result as any;
      const createdTickets = responseData.tickets || [];
      const ticket = createdTickets[0] || null;

      if (ticket) {
        // Save to localStorage
        localStorage.setItem(`ticket_${activeEvent.id}`, JSON.stringify(ticket));
        
        // Update State
        setTicketData(ticket);
        setTicketClaimed(true);
        setRegistrationOpen(false);

        // Update Debug
        setDebugInfo(prev => ({ 
          ...prev, 
          rpc_status: "success",
          tickets_created_count: createdTickets.length,
          player_id: responseData.player_id
        }));

        toast({
          title: "Uspjeh!",
          description: "Tvoj tiket je spreman.",
        });

        // Redirect to player view
        router.push(`/player?ticket=${ticket.id}`);
      } else {
        throw new Error("No ticket returned from server");
      }

    } catch (err: any) {
      console.error("❌ [PLAY] handleClaimTicket failed:", err);
      
      setDebugInfo(prev => ({ 
        ...prev, 
        rpc_status: "error",
        last_error: err
      }));

      toast({
        title: "Greška",
        description: err.message || "Neuspješna registracija.",
        variant: "destructive",
      });
      
      throw err;
    }
  };

  const handleRegistrationSuccess = (data: any) => {
    console.log("Registration success:", data);
    setRegistrationOpen(false);
    
    // Check if we got tickets back
    const responseData = data as any;
    if (responseData && responseData.tickets && responseData.tickets.length > 0) {
      const ticket = responseData.tickets[0];
      setTicketData(ticket);
      setTicketClaimed(true);
      
      // Save to local storage
      if (activeEvent) {
        localStorage.setItem(`ticket_${activeEvent.id}`, JSON.stringify(ticket));
      }
      
      // Redirect to player page
      router.push(`/player?ticket=${ticket.id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
        <Loader2 className="h-12 w-12 text-white animate-spin" />
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 p-4">
        <Card className="w-full max-w-md bg-white/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-center text-xl text-red-600 flex items-center justify-center gap-2">
              <AlertCircle className="h-6 w-6" />
              Nema aktivnog eventa
            </CardTitle>
            <CardDescription className="text-center">
              Trenutno nema aktivne igre. Molimo pokušajte kasnije.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <>
      <SEO title="Preuzmi Tiket - Pitalica Skitalica" />
      
      {showDebug && (
        <div className="fixed top-0 left-0 right-0 bg-black/95 text-white p-4 text-xs z-50 overflow-auto max-h-64">
          <div className="font-bold mb-2">🔍 DEBUG INFO</div>
          <div className="grid grid-cols-2 gap-2">
            <div>Event ID: {debugInfo.event_id || "N/A"}</div>
            <div>Event: {debugInfo.event_name || "N/A"}</div>
            <div>Venue ID: {debugInfo.venue_id || "N/A"}</div>
            <div>RPC: {debugInfo.rpc_name || "N/A"}</div>
            <div>Status: {debugInfo.rpc_status || "N/A"}</div>
            <div>Tickets: {debugInfo.tickets_created_count || 0}</div>
            {debugInfo.last_error && (
              <div className="col-span-2 mt-2 p-2 bg-red-900/50 rounded">
                <div className="font-bold">Last Error:</div>
                <pre className="text-xs overflow-auto">{debugInfo.last_error}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={cn("min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 p-4", showDebug && "pt-64")}>
        <div className="max-w-md mx-auto space-y-8 pt-10">
          
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-extrabold text-white drop-shadow-md">
              PITALICA SKITALICA
            </h1>
            <p className="text-white/90 text-lg font-medium">
              {activeEvent.name}
            </p>
          </div>

          <Card className="bg-white/95 backdrop-blur shadow-xl border-0">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl text-purple-700">
                Preuzmi Svoj Tiket
              </CardTitle>
              <CardDescription>
                Sudjeluj u igri i osvoji nagrade!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              
              <div className="flex justify-center py-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-purple-500 blur-xl opacity-20 rounded-full"></div>
                  <TicketIcon className="w-24 h-24 text-purple-600 relative z-10" />
                </div>
              </div>

              {!ticketClaimed ? (
                <div className="space-y-4">
                  <Button 
                    size="lg" 
                    className="w-full text-lg font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg transform transition active:scale-95"
                    onClick={() => setRegistrationOpen(true)}
                  >
                    Registriraj se i preuzmi tiket
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    *Potrebna je samo email adresa
                  </p>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-green-700 font-medium">
                      ✅ Tiket uspješno preuzet!
                    </p>
                    <p className="text-sm text-green-600 mt-1">
                      Serijski broj: <span className="font-mono font-bold">{ticketData?.serial_number}</span>
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    className="w-full border-purple-200 text-purple-700 hover:bg-purple-50"
                    onClick={() => router.push(`/player?ticket=${ticketData?.id}`)}
                  >
                    Otvori moj tiket
                  </Button>
                </div>
              )}

            </CardContent>
          </Card>
          
          <div className="text-center text-white/60 text-sm">
            &copy; 2026 Pitalica Skitalica
          </div>
        </div>
      </div>

      {showDebug && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/90 text-white p-2 text-xs z-50 border-t border-white/20">
          <div className="flex justify-between items-center">
            <div>
              <span className="font-bold">Build Info:</span> 
              {" "}Commit: {process.env.GIT_COMMIT?.substring(0, 7) || "local"}
              {" | "}Build: {new Date(process.env.BUILD_TIME || Date.now()).toLocaleString()}
            </div>
            <div>
              <span className="font-bold">Supabase:</span> 
              {" "}...{process.env.NEXT_PUBLIC_SUPABASE_URL?.split(".")[0].slice(-6) || "N/A"}
              {" | "}ENV: {process.env.ENV_NAME || "dev"}
            </div>
          </div>
        </div>
      )}

      <RegistrationModal
        open={registrationOpen}
        onOpenChange={setRegistrationOpen}
        onSuccess={handleRegistrationSuccess}
        eventId={activeEvent.id}
        venueId={(activeEvent as any).venue_id || ""}
      />
    </>
  );
}