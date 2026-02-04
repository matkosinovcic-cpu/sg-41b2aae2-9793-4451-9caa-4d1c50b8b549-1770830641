import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Trophy, Clock, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";

interface OnboardingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: (dontShowAgain: boolean) => void;
}

export function OnboardingModal({ open, onOpenChange, onDismiss }: OnboardingModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Reset checkbox when modal opens
  useEffect(() => {
    if (open) {
      setDontShowAgain(false);
      console.log("[OnboardingModal] ✅ Modal opened");
    }
  }, [open]);

  // Handle explicit close actions only
  const handleClose = (reason: "X" | "START" | "OUTSIDE") => {
    console.log("[OnboardingModal] 🔒 Close triggered - Reason:", reason);
    console.log("[OnboardingModal] 📋 Don't show again:", dontShowAgain);
    
    // Call dismiss handler with checkbox state
    onDismiss(dontShowAgain);
    
    // Close modal
    onOpenChange(false);
  };

  // Prevent auto-close from Dialog component on iOS
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      console.log("[OnboardingModal] ⚠️ Dialog auto-close detected - treating as OUTSIDE click");
      handleClose("OUTSIDE");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => {
        console.log("[OnboardingModal] 👆 Outside click detected");
      }}>
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            Dobrodošao u Pitalicu Skitalicu! 🎉
          </DialogTitle>
          <DialogDescription className="text-center">
            Kviz uživo koji se igra u kafiću na TV-u
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Main points */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Trophy className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                <strong>Igra se uživo</strong> na TV-u u kafiću
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-pink-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                Odgovaraš na <strong>DA/NE pitanja u 9 sekundi</strong>
              </p>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                <strong>Rezultati i tiketi su transparentni</strong> nakon igre
              </p>
            </div>
          </div>

          {/* Expandable "How it works" section */}
          <div className="border-t pt-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center justify-between w-full text-sm font-semibold text-purple-600 hover:text-purple-700"
            >
              <span>Kako igra funkcionira</span>
              {showDetails ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            
            {showDetails && (
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>• <strong>Preuzmi tiket:</strong> Klikom na gumb dobivaš jedinstven serijski broj</p>
                <p>• <strong>Prati TV:</strong> Pitanja se prikazuju na ekranu u kafiću</p>
                <p>• <strong>Odgovaraj brzo:</strong> Imaš 9 sekundi za svako pitanje (DA/NE)</p>
                <p>• <strong>Provjeri rezultate:</strong> Nakon eventa vidiš točne odgovore i svoju statistiku</p>
              </div>
            )}
          </div>

          {/* "Don't show again" checkbox */}
          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="dont-show-again"
              checked={dontShowAgain}
              onCheckedChange={(checked) => {
                setDontShowAgain(checked === true);
                console.log("[OnboardingModal] ☑️ Checkbox toggled:", checked);
              }}
            />
            <label
              htmlFor="dont-show-again"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Ne prikazuj više
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={() => handleClose("START")}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            size="lg"
          >
            Kreni
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}