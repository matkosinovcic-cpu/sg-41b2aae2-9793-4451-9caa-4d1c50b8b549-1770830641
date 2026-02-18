import { SEO } from "@/components/SEO";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Gamepad2, Users, Tv } from "lucide-react";

export default function Home() {
  return (
    <>
      <SEO 
        title="Pitalica Skitalica - Live Quiz Game"
        description="Real-time quiz game system for cafés and online events"
      />
      <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
        <div className="container mx-auto px-4 py-16">
          <div className="text-center mb-16">
            <h1 className="text-6xl font-black text-white mb-4 drop-shadow-lg">
              PITALICA SKITALICA
            </h1>
            <p className="text-2xl text-white/90 font-semibold">
              Live Quiz Game for Cafés & Events
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Link href="/admin" className="block">
              <div className="bg-white rounded-3xl p-8 shadow-2xl hover:shadow-3xl transition-all hover:scale-105 cursor-pointer">
                <div className="bg-purple-100 w-20 h-20 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                  <Gamepad2 className="w-10 h-10 text-purple-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3 text-center">
                  Admin Panel
                </h2>
                <p className="text-gray-600 text-center">
                  Create questions, manage events, and control the game
                </p>
              </div>
            </Link>

            <Link href="/player" className="block">
              <div className="bg-white rounded-3xl p-8 shadow-2xl hover:shadow-3xl transition-all hover:scale-105 cursor-pointer">
                <div className="bg-pink-100 w-20 h-20 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                  <Users className="w-10 h-10 text-pink-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3 text-center">
                  Player Screen
                </h2>
                <p className="text-gray-600 text-center">
                  Join with your ticket and answer questions
                </p>
              </div>
            </Link>

            <Link href="/tv" className="block">
              <div className="bg-white rounded-3xl p-8 shadow-2xl hover:shadow-3xl transition-all hover:scale-105 cursor-pointer">
                <div className="bg-orange-100 w-20 h-20 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                  <Tv className="w-10 h-10 text-orange-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3 text-center">
                  TV Screen
                </h2>
                <p className="text-gray-600 text-center">
                  Full-screen display with questions and countdown
                </p>
              </div>
            </Link>
          </div>

          <div className="mt-16 text-center">
            <div className="inline-block bg-white/20 backdrop-blur-sm rounded-2xl px-8 py-4">
              <p className="text-white text-lg font-semibold">
                🎯 90 Questions • 🎟️ 15 Numbers per Ticket • ⏱️ 10 Second Countdown
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}