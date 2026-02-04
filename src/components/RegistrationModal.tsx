/**
 * Registration Modal - Minimal player registration before ticket generation
 * 
 * Fields:
 * - Nickname (required)
 * - Email (required)
 * - Confirm Email (required, must match)
 * - Age 18+ checkbox (required)
 * - Accept rules checkbox (required)
 */

import { useState } from "react";
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
import { claimFreeTickets } from "@/services/ticketService";

interface RegistrationSuccessData {
  email: string;
  nickname: string;
  userId: string;
  sessionId: string;
  tickets: any[];
  totalTickets: number;
}

interface RegistrationModalProps {
  open: boolean;
  onSuccess: (data: RegistrationSuccessData) => void;
  onCancel: () => void;
}

export function RegistrationModal({
  open,
  onSuccess,
  onCancel,
}: RegistrationModalProps) {
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isAdult, setIsAdult] = useState(false);
  const [acceptRules, setAcceptRules] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    nickname?: string;
    email?: string;
    confirmEmail?: string;
    checkboxes?: string;
    general?: string;
  }>({});

  // Real-time validation
  const validateFields = () => {
    const newErrors: typeof errors = {};

    // Nickname validation
    if (!nickname.trim()) {
      newErrors.nickname = "Nadimak je obavezan";
    } else if (nickname.trim().length < 2) {
      newErrors.nickname = "Nadimak mora imati minimalno 2 znaka";
    } else if (nickname.trim().length > 50) {
      newErrors.nickname = "Nadimak može imati maksimalno 50 znakova";
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) {
      newErrors.email = "Email je obavezan";
    } else if (!emailRegex.test(email.trim())) {
      newErrors.email = "Email nije valjan";
    }

    // Confirm email validation
    if (!confirmEmail.trim()) {
      newErrors.confirmEmail = "Ponovi email";
    } else if (email.trim() !== confirmEmail.trim()) {
      newErrors.confirmEmail = "Email se ne podudara";
    }

    // Checkboxes validation
    if (!isAdult || !acceptRules) {
      newErrors.checkboxes = "Moraš prihvatiti oba uvjeta";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validate all fields
    if (!validateFields()) {
      return;
    }

    setLoading(true);

    try {
      console.log("[RegistrationModal] 🎟️ Claiming free tickets atomically...");

      // ATOMIC: Call RPC to claim all 4 tickets in one transaction
      const result = await claimFreeTickets(
        email.trim(),
        nickname.trim(),
        4 // Max 4 free tickets
      );

      console.log("[RegistrationModal] ✅ Tickets claimed:", result);

      // Store session info in localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem("ps_player_email", email.trim());
        localStorage.setItem("ps_player_nickname", nickname.trim());
        localStorage.setItem("ps_user_id", result.user_id);
        localStorage.setItem("ps_session_id", result.session_id);
      }

      // Success - close modal and notify parent
      onSuccess({
        email: email.trim(),
        nickname: nickname.trim(),
        userId: result.user_id,
        sessionId: result.session_id,
        tickets: result.tickets,
        totalTickets: result.total_tickets,
      });

    } catch (err) {
      console.error("[RegistrationModal] ❌ Registration failed:", err);
      setErrors({
        general: err instanceof Error
          ? err.message
          : "Greška pri registraciji. Pokušajte ponovno."
      });
    } finally {
      setLoading(false);
    }
  };

  const isFormValid =
    nickname.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    email.trim() === confirmEmail.trim() &&
    isAdult &&
    acceptRules;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && !loading && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <UserPlus className="h-6 w-6" />
            Brza registracija
          </DialogTitle>
          <DialogDescription className="text-center">
            Upiši osnovne podatke da bi preuzeo tiket
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Nickname */}
          <div className="space-y-2">
            <Label htmlFor="nickname">
              Nadimak <span className="text-destructive">*</span>
            </Label>
            <Input
              id="nickname"
              type="text"
              placeholder="Tvoj nadimak"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                if (errors.nickname) {
                  setErrors({ ...errors, nickname: undefined });
                }
              }}
              disabled={loading}
              maxLength={50}
            />
            {errors.nickname && (
              <p className="text-sm text-destructive">{errors.nickname}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">
              Email <span className="text-destructive">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="tvoj@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) {
                  setErrors({ ...errors, email: undefined });
                }
              }}
              disabled={loading}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email}</p>
            )}
          </div>

          {/* Confirm Email */}
          <div className="space-y-2">
            <Label htmlFor="confirmEmail">
              Ponovi email <span className="text-destructive">*</span>
            </Label>
            <Input
              id="confirmEmail"
              type="email"
              placeholder="Ponovi email"
              value={confirmEmail}
              onChange={(e) => {
                setConfirmEmail(e.target.value);
                if (errors.confirmEmail) {
                  setErrors({ ...errors, confirmEmail: undefined });
                }
              }}
              disabled={loading}
            />
            {errors.confirmEmail && (
              <p className="text-sm text-destructive">{errors.confirmEmail}</p>
            )}
          </div>

          {/* Checkboxes */}
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <Checkbox
                id="age-check"
                checked={isAdult}
                onCheckedChange={(checked) => {
                  setIsAdult(checked === true);
                  if (errors.checkboxes) {
                    setErrors({ ...errors, checkboxes: undefined });
                  }
                }}
                disabled={loading}
              />
              <Label
                htmlFor="age-check"
                className="text-sm font-normal leading-tight cursor-pointer"
              >
                Imam 18+ godina
              </Label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="rules-check"
                checked={acceptRules}
                onCheckedChange={(checked) => {
                  setAcceptRules(checked === true);
                  if (errors.checkboxes) {
                    setErrors({ ...errors, checkboxes: undefined });
                  }
                }}
                disabled={loading}
              />
              <Label
                htmlFor="rules-check"
                className="text-sm font-normal leading-tight cursor-pointer"
              >
                Prihvaćam pravila igre
              </Label>
            </div>

            {errors.checkboxes && (
              <p className="text-sm text-destructive">{errors.checkboxes}</p>
            )}
            
            {errors.general && (
              <p className="text-sm text-destructive font-medium bg-destructive/10 p-2 rounded text-center">
                {errors.general}
              </p>
            )}
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={!isFormValid || loading}
            className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Registracija...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-5 w-5" />
                Registriraj se i preuzmi tiket
              </>
            )}
          </Button>

          {/* Cancel button (optional - only if user wants to go back) */}
          {!loading && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className="w-full"
            >
              Odustani
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}