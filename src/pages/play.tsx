import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Ticket } from "lucide-react";
import { ticketService } from "@/services/ticketService";

export default function PlayPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Free tickets tracking
  const [freeTicketCount, setFreeTicketCount] = useState(0);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);

  const MAX_FREE_TICKETS = 4;

  useEffect(() => {
    async function init() {
      try {
        // 1. First fetch active event (REQUIRED for session creation)
        const { data: events, error: eventError } = await supabase
          .from("events")
          .select("*")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1);

        if (eventError) throw eventError;
        
        const currentEvent = events && events.length > 0 ? events[0] : null;
        
        if (currentEvent) {
          setActiveEvent(currentEvent);
        } else {
          // No active event, can't proceed with session creation if it requires event_id
          setLoading(false);
          return;
        }

        // 2. Get or create session (now that we have event_id)
        let token = localStorage.getItem("player_session_token");
        
        if (!token) {
          // Create new session
          const newToken = crypto.randomUUID();
          const { data: session, error: sessionError } = await supabase
            .from("player_sessions")
            .insert({
              session_token: newToken,
              event_id: currentEvent.id // REQUIRED field
            })
            .select("session_token, id")
            .single();
          
          if (sessionError) throw sessionError;
          
          token = session.session_token;
          localStorage.setItem("player_session_token", token);
          setSessionToken(token);
          setSessionId(session.id);
        } else {
          setSessionToken(token);
          
          // Get session ID
          const { data: session, error: sessionError } = await supabase
            .from("player_sessions")
            .select("id")
            .eq("session_token", token)
            .single();
          
          if (sessionError) throw sessionError;
          setSessionId(session.id);
        }
      } catch (err: any) {
        console.error("Error initializing play page:", err);
        setError(err.message || "Greška pri učitavanju.");
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  // Fetch free ticket count when sessionId and activeEvent are available
  useEffect(() => {
    async function fetchFreeTicketCount() {
      if (!sessionId || !activeEvent) return;
      
      try {
        setIsLoadingTickets(true);
        
        const { data: tickets, error } = await supabase
          .from("tickets")
          .select("id")
          .eq("session_id", sessionId)
          .eq("event_id", activeEvent.id);
        
        if (error) throw error;
        
        setFreeTicketCount(tickets?.length || 0);
      } catch (err: any) {
        console.error("Error fetching ticket count:", err);
      } finally {
        setIsLoadingTickets(false);
      }
    }

    fetchFreeTicketCount();
  }, [sessionId, activeEvent]);

  async function handleFreeTicket() {
    if (!activeEvent || !sessionId) {
      setError("Nema aktivnog eventa ili sesije.");
      return;
    }
    
    // Check limit before creating
    if (freeTicketCount >= MAX_FREE_TICKETS) {
      setError(`Dosegnuo si maksimalan broj besplatnih tiketa (${MAX_FREE_TICKETS}/${MAX_FREE_TICKETS}).`);
      return;
    }
    
    try {
      setIsSubmitting(true);
      setError("");
      setSuccess("");
      
      // Create 1 free ticket
      const result = await ticketService.createFreeTicketsForPlayer(
        activeEvent.id,
        sessionId,
        1
      );
      
      if (result.created === 0) {
        setError(`Već imaš maksimalan broj besplatnih tiketa (${MAX_FREE_TICKETS}/${MAX_FREE_TICKETS}).`);
        return;
      }
      
      setSuccess("Tiket uspješno kreiran!");
      
      // Update count
      setFreeTicketCount(prev => prev + 1);
      
      // Redirect to player page after short delay
      setTimeout(() => {
        router.push("/player");
      }, 1000);
      
    } catch (err: any) {
      console.error("Error creating free ticket:", err);
      setError(err.message || "Greška pri kreiranju tiketa.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <div className="container mx-auto p-4 max-w-2xl">
        <Alert>
          <AlertDescription>
            Trenutno nema aktivnog eventa. Pokušajte kasnije.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isAtMaxLimit = freeTicketCount >= MAX_FREE_TICKETS;

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-6 w-6" />
            Preuzmi Tiket
          </CardTitle>
          <CardDescription>
            Preuzmi besplatni tiket za event: <strong>{activeEvent.name}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Free ticket count display */}
          <div className="text-center p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">TEST FAZA</p>
            <p className="text-2xl font-bold">
              Imaš {freeTicketCount} / {MAX_FREE_TICKETS} besplatna tiketa
            </p>
          </div>

          {/* Error display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success display */}
          {success && (
            <Alert>
              <AlertDescription className="text-green-600">{success}</AlertDescription>
            </Alert>
          )}

          {/* Max limit reached message */}
          {isAtMaxLimit && (
            <Alert>
              <AlertDescription>
                Dosegnuo si maksimalan broj besplatnih tiketa ({MAX_FREE_TICKETS}/{MAX_FREE_TICKETS}).
                Idi na stranicu tiketa da vidiš sve svoje tikete.
              </AlertDescription>
            </Alert>
          )}

          {/* Free ticket button */}
          <Button
            onClick={handleFreeTicket}
            disabled={isSubmitting || isLoadingTickets || isAtMaxLimit}
            className="w-full"
            size="lg"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Kreiram tiket...
              </>
            ) : isAtMaxLimit ? (
              `Dostignut limit ${MAX_FREE_TICKETS}/${MAX_FREE_TICKETS}`
            ) : (
              `Preuzmi tiket (FREE) - ${freeTicketCount + 1}/${MAX_FREE_TICKETS}`
            )}
          </Button>

          {/* View all tickets button */}
          {freeTicketCount > 0 && (
            <Button
              variant="outline"
              onClick={() => router.push("/player")}
              className="w-full"
              size="lg"
            >
              Vidi sve moje tikete ({freeTicketCount})
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}