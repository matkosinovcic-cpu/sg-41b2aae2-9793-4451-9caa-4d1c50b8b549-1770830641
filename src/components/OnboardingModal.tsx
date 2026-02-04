import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { HelpCircle, CheckCircle, Clock, Trophy } from "lucide-react";

interface OnboardingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: (dontShowAgain: boolean) => void;
}

export function OnboardingModal({ open, onOpenChange, onDismiss }: OnboardingModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleContinue = () => {
    onDismiss(dontShowAgain);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center mb-2">
            Dobrodošao u Pitalicu Skitalicu! 🎲
          </DialogTitle>
          <DialogDescription className="text-center text-base">
            Kviz uživo za brze umove
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Main Points */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg">
              <Trophy className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Igra se uživo na TV-u</h3>
                <p className="text-sm text-muted-foreground">
                  Sva pitanja se prikazuju na velikom ekranu u kafiću
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg">
              <Clock className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Odgovaraš u 9 sekundi</h3>
                <p className="text-sm text-muted-foreground">
                  Brza DA/NE pitanja - brzina i točnost se boduju
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg">
              <CheckCircle className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-1">Transparentni rezultati</h3>
                <p className="text-sm text-muted-foreground">
                  Vidi sve svoje odgovore i statistiku nakon igre
                </p>
              </div>
            </div>
          </div>

          {/* How It Works Section */}
          <div className="border-t pt-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors w-full justify-center"
            >
              <HelpCircle className="w-5 h-5" />
              <span className="font-medium">
                {showDetails ? "Sakrij" : "Kako igra funkcionira"}
              </span>
            </button>

            {showDetails && (
              <div className="mt-4 space-y-3 text-sm bg-muted/30 p-4 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="font-bold text-primary">1.</span>
                  <p>
                    <strong>Preuzmi tiket:</strong> Unesi svoje ime i preuzmi jedinstveni tiket prije početka igre
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-primary">2.</span>
                  <p>
                    <strong>Prati pitanja:</strong> Gledaj TV ekran i odgovaraj što brže možeš - svaka sekunda se računa!
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-primary">3.</span>
                  <p>
                    <strong>Provjeri rezultate:</strong> Nakon igre vidi sve svoje odgovore, bodove i usporedi se s ostalima
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Don't Show Again Checkbox */}
          <div className="flex items-center space-x-2 pt-2 border-t">
            <Checkbox
              id="dont-show"
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(checked === true)}
            />
            <Label
              htmlFor="dont-show"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Ne prikazuj više
            </Label>
          </div>

          {/* Action Button */}
          <Button
            onClick={handleContinue}
            className="w-full text-lg py-6"
            size="lg"
          >
            Kreni
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}