import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ticketService } from "@/services/ticketService";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface RegistrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (data: any) => void;
  eventId: string;
  venueId: string;
}

export function RegistrationModal({ 
  open, 
  onOpenChange, 
  onSuccess,
  eventId,
  venueId 
}: RegistrationModalProps) {
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    details: string | null;
    hint: string | null;
    code: string | null;
    raw: any;
  } | null>(null);
  const [showDebugError, setShowDebugError] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setNickname("");
      setError(null);
      // Check for debug mode in URL
      setShowDebugError(typeof window !== 'undefined' && window.location.search.includes('debug=1'));
    }
  }, [open]);

  const onCancel = () => {
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!eventId) {
        throw new Error("Event ID is missing. Please refresh the page.");
      }

      console.log("[RegistrationModal] Submitting claim for:", { email, nickname, eventId, venueId });

      // Call service
      const result = await ticketService.claimFreeTickets(
        email,
        nickname
      );
      
      onSuccess(result);
      onOpenChange(false);
    } catch (err: any) {
      console.error("❌ [RegistrationModal] CLAIM_TICKETS_ERROR - Full Error Object:", JSON.stringify(err, null, 2));
      
      setError({
        message: err?.message || "Greška prilikom registracije",
        details: err?.details || null,
        hint: err?.hint || null,
        code: err?.code || null,
        raw: err
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (onOpenChange) onOpenChange(val);
      if (!val && !loading) onCancel();
    }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Brza registracija</DialogTitle>
          <DialogDescription>
            Unesi email i nadimak za preuzimanje listića.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Greška</AlertTitle>
              <AlertDescription>
                <div className="flex flex-col gap-2">
                  <span>{error.message}</span>
                  {(showDebugError || error.code) && (
                    <div className="mt-2 p-2 bg-black/10 rounded text-xs font-mono overflow-auto max-h-40">
                      <div className="font-bold mb-1">Debug Info:</div>
                      {error.code && <div>Code: {error.code}</div>}
                      {error.hint && <div>Hint: {error.hint}</div>}
                      {error.details && <div>Details: {error.details}</div>}
                      {showDebugError && (
                        <pre className="mt-2 whitespace-pre-wrap">
                          {JSON.stringify(error.raw, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="nickname" className="text-right">
              Nadimak
            </Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="col-span-3"
              required
            />
          </div>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? "Preuzimanje..." : "Registriraj se i preuzmi tiket"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}