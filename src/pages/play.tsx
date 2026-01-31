import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import { ticketService } from "@/services/ticketService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Ticket } from "lucide-react";

export default function PlayPage() {
  const router = useRouter();
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActiveEvent();
  }, []);

  const loadActiveEvent = async () => {
    try {
      setLoading(true);
      setError(null);
      const event = await eventService.getActiveEvent();
      setActiveEvent(event);
      console.log("[Play] Active event loaded:", event?.name || "none");
    } catch (err) {
      console.error("[Play] Failed to load active event:", err);
      setError("Greška pri učitavanju eventa.");
    } finally {
      setLoading(false);
    }
  };

  const handleGetFreeTicket = async () => {
    if (!activeEvent) return;

    try {
      setCreating(true);
      setError(null);

      console.log("[Play] Creating free ticket for event:", activeEvent.id);
      const ticket = await ticketService.createFreeTicket(activeEvent.id);
      console.log("[Play] ✅ Ticket created:", ticket.serial_number);

      // Redirect to /player with ticket serial
      router.push(`/player?ticket=${ticket.serial_number}`);
    } catch (err) {
      console.error("[Play] ❌ Failed to create ticket:", err);
      setError("Greška pri izradi tiketa. Pokušaj ponovno.");
      setCreating(false);
    }
  };

  return (
    <>
      <SEO title="Preuzmi tiket - Pitalica Skitalica" />
      
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-3xl font-black text-center">
              PITALICA SKITALICA
            </CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="w-12 h-12 animate-spin text-purple-600 mb-4" />
                <p className="text-gray-600">Učitavam...</p>
              </div>
            ) : activeEvent ? (
              <>
                {/* Active event info */}
                <div className="bg-purple-50 rounded-lg p-4 text-center">
                  <div className="text-sm text-gray-600 mb-1">Aktivni event:</div>
                  <div className="text-xl font-bold text-purple-900">
                    {activeEvent.name}
                  </div>
                </div>

                {/* Get ticket button */}
                <Button
                  onClick={handleGetFreeTicket}
                  disabled={creating}
                  className="w-full h-16 text-lg font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                  size="lg"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Izrađujem tiket...
                    </>
                  ) : (
                    <>
                      <Ticket className="w-5 h-5 mr-2" />
                      Preuzmi tiket (FREE)
                    </>
                  )}
                </Button>

                {/* Error message */}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                    <p className="text-red-800 font-medium">{error}</p>
                  </div>
                )}

                {/* Info text */}
                <div className="text-sm text-gray-600 text-center">
                  <p>Klikni gore za besplatni tiket.</p>
                  <p className="mt-1">Bit ćeš automatski preusmjeren na igru.</p>
                </div>
              </>
            ) : (
              <>
                {/* No active event */}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                  <div className="text-4xl mb-4">⏳</div>
                  <p className="text-lg font-semibold text-yellow-900 mb-2">
                    Trenutno nema aktivnog eventa.
                  </p>
                  <p className="text-sm text-yellow-800">
                    Molimo pričekajte da event započne.
                  </p>
                </div>

                {/* Disabled button */}
                <Button
                  disabled
                  className="w-full h-16 text-lg font-bold"
                  size="lg"
                >
                  <Ticket className="w-5 h-5 mr-2" />
                  Preuzmi tiket (FREE)
                </Button>

                {/* Retry button */}
                <Button
                  onClick={loadActiveEvent}
                  variant="outline"
                  className="w-full"
                >
                  🔄 Osvježi
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}