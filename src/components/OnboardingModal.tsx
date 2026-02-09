import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

interface OnboardingModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function OnboardingModal({ open, onDismiss }: OnboardingModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg max-w-md w-full p-6 relative">
        <button 
          onClick={onDismiss}
          className="absolute top-4 right-4 text-gray-400 hover:text-white"
        >
          <X className="h-6 w-6" />
        </button>
        
        <div className="text-center mb-6">
          <div className="text-4xl mb-4">👋</div>
          <h2 className="text-2xl font-bold mb-2">Dobrodošli!</h2>
          <p className="text-gray-400">
            Pratite pitanja na glavnom ekranu i odgovarajte ovdje.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-3 text-left bg-gray-800 p-4 rounded-lg">
            <div className="bg-yellow-500 text-black font-bold w-6 h-6 flex items-center justify-center rounded-full shrink-0">
              1
            </div>
            <div>
              <div className="font-bold">Gledajte u TV</div>
              <div className="text-sm text-gray-400">Pitanja se pojavljuju na velikom ekranu.</div>
            </div>
          </div>

          <div className="flex items-start gap-3 text-left bg-gray-800 p-4 rounded-lg">
            <div className="bg-yellow-500 text-black font-bold w-6 h-6 flex items-center justify-center rounded-full shrink-0">
              2
            </div>
            <div>
              <div className="font-bold">Provjerite svoj listić</div>
              <div className="text-sm text-gray-400">Ako imate broj pitanja na listiću, igrate!</div>
            </div>
          </div>

          <div className="flex items-start gap-3 text-left bg-gray-800 p-4 rounded-lg">
            <div className="bg-yellow-500 text-black font-bold w-6 h-6 flex items-center justify-center rounded-full shrink-0">
              3
            </div>
            <div>
              <div className="font-bold">Odgovorite točno</div>
              <div className="text-sm text-gray-400">Imate 10 sekundi za odgovor DA ili NE.</div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <Button 
            className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-6 text-lg"
            onClick={onDismiss}
          >
            Razumijem, idemo!
          </Button>
        </div>
      </div>
    </div>
  );
}