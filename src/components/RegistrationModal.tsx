/**
 * Registration Modal - Minimal player registration before ticket generation
 */

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
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, UserPlus } from "lucide-react";
import { createFreeTicket } from "@/services/ticketService";

export interface RegistrationSuccessData {
  email: string;
  nickname: string;
  tickets: any[]; 
}

interface RegistrationModalProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void; // Added missing prop
  eventId: string;
  venueId: string;
  onSuccess: (email: string, nickname: string) => void; // Simplified to match usage in play.tsx
  onCancel: () => void;
}

export function RegistrationModal({
  open,
  onOpenChange,
  eventId,
  venueId,
  onSuccess,
  onCancel,
}: RegistrationModalProps) {
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isAdult, setIsAdult] = useState(false);
  const [acceptRules, setAcceptRules] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Custom error state for detailed reporting
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<any>(null);
  
  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<{
    nickname?: string;
    email?: string;
    confirmEmail?: string;
    checkboxes?: string;
  }>({});

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSubmitError(null);
      setErrorDetails(null);
    }
  }, [open]);

  const validateFields = () => {
    const newErrors: typeof fieldErrors = {};

    if (!nickname.trim()) newErrors.nickname = "Nadimak je obavezan";
    else if (nickname.trim().length < 2) newErrors.nickname = "Min 2 znaka";

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) newErrors.email = "Email je obavezan";
    else if (!emailRegex.test(email.trim())) newErrors.email = "Email nije valjan";

    if (email.trim() !== confirmEmail.trim()) newErrors.confirmEmail = "Email se ne podudara";

    if (!isAdult || !acceptRules) newErrors.checkboxes = "Moraš prihvatiti uvjete";

    setFieldErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setErrorDetails(null);

    if (!validateFields()) return;

    setLoading(true);

    try {
      console.log("[RegistrationModal] 🎫 Calling onSuccess directly for play.tsx to handle claim...", { eventId, venueId, email, nickname });
      
      // DELEGATE CLAIM LOGIC TO PARENT (play.tsx handles the actual RPC call now via handleClaimTicket)
      // This is cleaner as play.tsx has the debug context
      await onSuccess(email.trim().toLowerCase(), nickname.trim());
      
    } catch (err: any) {
      console.error("❌ [RegistrationModal] CLAIM_TICKETS_ERROR - FULL DIAGNOSTIC:", {
        message: err?.message || "Unknown error",
        details: err?.details || null,
        hint: err?.hint || null,
        code: err?.code || null,
        status: err?.status || null,
        statusText: err?.statusText || null,
        raw: err
      });
      
      setSubmitError(err?.message || "Došlo je do greške.");
      setErrorDetails({
        code: err?.code,
        details: err?.details,
        hint: err?.hint
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <UserPlus className="h-6 w-6" />
            Brza registracija
          </DialogTitle>
          <DialogDescription className="text-center">
            Upiši podatke za preuzimanje tiketa
          </DialogDescription>
        </DialogHeader>

        {submitError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 mb-4">
            <p className="text-sm font-bold text-red-800 mb-1">❌ Greška: {submitError}</p>
            {errorDetails && (
              <details className="mt-2">
                <summary className="text-xs font-mono text-red-600 cursor-pointer">Detalji greške (za developera)</summary>
                <div className="mt-1 text-[10px] font-mono bg-red-100 p-2 rounded overflow-auto max-h-32">
                  <div>Code: {errorDetails.code}</div>
                  {errorDetails.details && <div>Details: {errorDetails.details}</div>}
                  {errorDetails.hint && <div>Hint: {errorDetails.hint}</div>}
                </div>
              </details>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nickname">Nadimak *</Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={loading}
            />
            {fieldErrors.nickname && <p className="text-xs text-red-500">{fieldErrors.nickname}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            {fieldErrors.email && <p className="text-xs text-red-500">{fieldErrors.email}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmEmail">Ponovi Email *</Label>
            <Input
              id="confirmEmail"
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              disabled={loading}
            />
            {fieldErrors.confirmEmail && <p className="text-xs text-red-500">{fieldErrors.confirmEmail}</p>}
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <Checkbox 
                id="age" 
                checked={isAdult} 
                onCheckedChange={(c) => setIsAdult(c === true)}
                disabled={loading}
              />
              <Label htmlFor="age" className="cursor-pointer">Imam 18+ godina</Label>
            </div>
            
            <div className="flex items-center gap-2">
              <Checkbox 
                id="rules" 
                checked={acceptRules} 
                onCheckedChange={(c) => setAcceptRules(c === true)}
                disabled={loading}
              />
              <Label htmlFor="rules" className="cursor-pointer">Prihvaćam pravila</Label>
            </div>
            
            {fieldErrors.checkboxes && <p className="text-xs text-red-500">{fieldErrors.checkboxes}</p>}
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600"
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : "Registriraj se i preuzmi tiket"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}