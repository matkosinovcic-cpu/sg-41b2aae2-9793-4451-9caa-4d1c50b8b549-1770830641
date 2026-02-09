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

interface RegistrationSuccessData {
  email: string;
  nickname: string;
  tickets: any[]; // Using any to be flexible with backend response
}

interface RegistrationModalProps {
  open: boolean;
  eventId: string;
  venueId: string;
  onSuccess: (data: RegistrationSuccessData) => void;
  onCancel: () => void;
}

export function RegistrationModal({
  open,
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
      console.log("[RegistrationModal] 🎫 Claiming ticket...", { eventId, venueId, email, nickname });

      // Call service with explicit credentials
      const ticket = await createFreeTicket(
        eventId,
        venueId,
        email.trim().toLowerCase(),
        nickname.trim()
      );

      console.log("[RegistrationModal] ✅ Success:", ticket);

      // Save to localStorage
      localStorage.setItem("playerEmail", email.trim().toLowerCase());
      localStorage.setItem("playerNickname", nickname.trim());

      onSuccess({
        email: email.trim().toLowerCase(),
        nickname: nickname.trim(),
        tickets: [ticket]
      });
      
    } catch (err: any) {
      console.error("[RegistrationModal] ❌ Error:", err);
      
      const message = err?.message || "Došlo je do greške pri preuzimanju tiketa.";
      setSubmitError(message);
      
      setErrorDetails({
        code: err?.code || "UNKNOWN",
        details: err?.details || null,
        hint: err?.hint || null,
        raw: err
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !loading && onCancel()}>
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