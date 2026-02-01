import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { eventService } from "@/services/eventService";
import { ticketService } from "@/services/ticketService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export default function PlayPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [ticketSerial, setTicketSerial] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Additional free tickets modal state
  const [showAddMoreModal, setShowAddMoreModal] = useState(false);
  const [existingTicketCount, setExistingTicketCount] = useState(0);
  const [selectedAdditionalCount, setSelectedAdditionalCount] = useState<string>("1");
  const [isCreatingAdditional, setIsCreatingAdditional] = useState(false);

  useEffect(() => {
    loadActiveEvent();
    loadOrCreateSession();
  }, []);

  async function loadActiveEvent() {
    try {
      setLoading(true);
      const result = await eventService.getActiveOrLastFinished();
      
      if (result.event) {
        setActiveEvent(result.event);
      } else {
        setError("Trenutno nema aktivnog eventa. Pokušajte kasnije.");
      }
    } catch (err) {
      console.error("Error loading event:", err);
      setError("Greška pri učitavanju eventa.");
    } finally {
      setLoading(false);
    }
  }

  async function loadOrCreateSession() {
    try {
      let token = localStorage.getItem("player_session_token");
      
      if (!token) {
        // Create new session
        const result = await eventService.getActiveOrLastFinished();
        if (!result.event) {
          return;
        }
        
        const { data: session, error: sessionError } = await supabase
          .from("player_sessions")
          .insert({ 
            event_id: result.event.id,
            session_token: crypto.randomUUID() 
          })
          .select("session_token")
          .single();
        
        if (sessionError) throw sessionError;
        
        token = session.session_token;
        localStorage.setItem("player_session_token", token);
      }
      
      setSessionToken(token);
    } catch (err) {
      console.error("Error loading/creating session:", err);
    }
  }

  async function handleFreeTicket() {
    if (!activeEvent || !sessionToken) {
      setError("Nema aktivnog eventa ili sesije.");
      return;
    }
    
    try {
      setIsSubmitting(true);
      setError("");
      setSuccess("");
      
      // Get session ID from token
      const { data: session, error: sessionError } = await supabase
        .from("player_sessions")
        .select("id")
        .eq("session_token", sessionToken)
        .single();
      
      if (sessionError || !session) {
        throw new Error("Sesija nije pronađena.");
      }
      
      // Create first free ticket
      const result = await ticketService.createFreeTicketsForPlayer(
        activeEvent.id,
        session.id,
        1
      );
      
      if (result.created === 0) {
        setError("Već imaš maksimalan broj besplatnih tiketa (4/4).");
        return;
      }
      
      // Get existing ticket count for modal
      const { data: existingTickets } = await supabase
        .from("tickets")
        .select("id")
        .eq("session_id", session.id)
        .eq("event_id", activeEvent.id);
      
      const existing = existingTickets?.length || 0;
      setExistingTicketCount(existing);
      
      // Show modal for additional tickets if not at max
      if (existing < 4) {
        setShowAddMoreModal(true);
      } else {
        // Already at max, redirect to player
        router.push("/player");
      }
      
    } catch (err: any) {
      console.error("Error creating free ticket:", err);
      setError(err.message || "Greška pri kreiranju tiketa.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddAdditionalTickets() {
    if (!activeEvent || !sessionToken) return;
    
    try {
      setIsCreatingAdditional(true);
      setError("");
      
      // Get session ID from token
      const { data: session, error: sessionError } = await supabase
        .from("player_sessions")
        .select("id")
        .eq("session_token", sessionToken)
        .single();
      
      if (sessionError || !session) {
        throw new Error("Sesija nije pronađena.");
      }
      
      const requested = parseInt(selectedAdditionalCount, 10);
      
      const result = await ticketService.createFreeTicketsForPlayer(
        activeEvent.id,
        session.id,
        requested
      );
      
      if (result.created > 0) {
        setSuccess(`Uspješno dodano ${result.created} tiketa!`);
        setTimeout(() => {
          router.push("/player");
        }, 1000);
      } else {
        setError("Nema više dostupnih besplatnih tiketa.");
      }
      
    } catch (err: any) {
      console.error("Error adding additional tickets:", err);
      setError(err.message || "Greška pri dodavanju tiketa.");
    } finally {
      setIsCreatingAdditional(false);
    }
  }

  async function handleManualTicket() {
    // Existing manual ticket logic
    if (!ticketSerial.trim()) {
      setError("Molimo unesite serijski broj tiketa.");
      return;
    }
    
    try {
      setIsSubmitting(true);
      setError("");
      setSuccess("");
      
      const ticket = await ticketService.getTicketBySerial(ticketSerial.trim());
      
      if (!ticket) {
        setError("Tiket s tim serijskim brojem nije pronađen.");
        return;
      }
      
      setSuccess("Tiket pronađen! Preusmjeravam...");
      setTimeout(() => {
        router.push("/player");
      }, 1000);
      
    } catch (err: any) {
      console.error("Error fetching ticket:", err);
      setError(err.message || "Greška pri dohvaćanju tiketa.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const remaining = Math.max(0, 4 - existingTicketCount);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Preuzmi Tiket</CardTitle>
          <CardDescription>
            {activeEvent ? `Event: ${activeEvent.name}` : "Nema aktivnog eventa"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {success && (
            <Alert>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {activeEvent && (
            <>
              {/* Free ticket section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">Besplatni Tiket</h3>
                  <Badge variant="secondary">TEST FAZA</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Do 4 besplatna tiketa po igraču u test fazi.
                </p>
                <Button 
                  onClick={handleFreeTicket}
                  disabled={isSubmitting}
                  className="w-full"
                  size="lg"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Kreiram...
                    </>
                  ) : (
                    "Preuzmi tiket (FREE)"
                  )}
                </Button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">ili</span>
                </div>
              </div>

              {/* Manual ticket entry */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Unesi Serijski Broj</h3>
                <div className="space-y-2">
                  <Label htmlFor="ticketSerial">Serijski broj tiketa</Label>
                  <Input
                    id="ticketSerial"
                    placeholder="T17699..."
                    value={ticketSerial}
                    onChange={(e) => setTicketSerial(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleManualTicket();
                      }
                    }}
                  />
                </div>
                <Button 
                  onClick={handleManualTicket}
                  disabled={isSubmitting || !ticketSerial.trim()}
                  className="w-full"
                  variant="outline"
                >
                  Potvrdi
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Additional Free Tickets Modal */}
      <Dialog open={showAddMoreModal} onOpenChange={setShowAddMoreModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dodaj još besplatnih tiketa</DialogTitle>
            <DialogDescription>
              Test faza - možeš dodati još besplatnih tiketa (maksimalno 4 ukupno)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Current status */}
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Trenutno imaš</p>
              <p className="text-3xl font-bold">{existingTicketCount}/4</p>
              <p className="text-sm text-muted-foreground">tiketa</p>
            </div>

            {remaining > 0 ? (
              <>
                {/* Segmented control for count selection */}
                <div className="space-y-2">
                  <Label>Odaberi broj tiketa za dodavanje:</Label>
                  <ToggleGroup 
                    type="single" 
                    value={selectedAdditionalCount}
                    onValueChange={(value) => {
                      if (value) setSelectedAdditionalCount(value);
                    }}
                    className="justify-start"
                  >
                    <ToggleGroupItem 
                      value="1" 
                      disabled={remaining < 1}
                      className="flex-1"
                    >
                      1 tiket
                    </ToggleGroupItem>
                    <ToggleGroupItem 
                      value="2" 
                      disabled={remaining < 2}
                      className="flex-1"
                    >
                      2 tiketa
                    </ToggleGroupItem>
                    <ToggleGroupItem 
                      value="3" 
                      disabled={remaining < 3}
                      className="flex-1"
                    >
                      3 tiketa
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {success && (
                  <Alert>
                    <AlertDescription>{success}</AlertDescription>
                  </Alert>
                )}

                {/* Action buttons */}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddMoreModal(false);
                      router.push("/player");
                    }}
                    className="flex-1"
                    disabled={isCreatingAdditional}
                  >
                    Preskoči
                  </Button>
                  <Button
                    onClick={handleAddAdditionalTickets}
                    disabled={isCreatingAdditional}
                    className="flex-1"
                  >
                    {isCreatingAdditional ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Dodajem...
                      </>
                    ) : (
                      `Dodaj ${selectedAdditionalCount}`
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Alert>
                  <AlertDescription>
                    Dosegnut limit 4/4 tiketa. Ne možeš dodati više besplatnih tiketa.
                  </AlertDescription>
                </Alert>
                <Button
                  onClick={() => {
                    setShowAddMoreModal(false);
                    router.push("/player");
                  }}
                  className="w-full"
                >
                  Idi na tikete
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}