/**
 * Onboarding Helper - Manages onboarding popup display preferences
 * 
 * Uses localStorage with cookie fallback for persistence
 * Tracks: hidden flag and last shown timestamp
 */

const STORAGE_KEY = "ps_onboarding";
const COOKIE_NAME = "ps_onboarding_hidden";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface OnboardingState {
  hidden: boolean;
  lastShown: number | null;
}

/**
 * Get onboarding state from storage
 */
export function getOnboardingState(): OnboardingState {
  try {
    // Try localStorage first
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        hidden: parsed.hidden ?? false,
        lastShown: parsed.lastShown ?? null,
      };
    }
  } catch (err) {
    console.warn("[Onboarding] localStorage not available or invalid data:", err);
  }

  // Fallback to cookie check
  try {
    const cookies = document.cookie.split("; ");
    const onboardingCookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (onboardingCookie) {
      const value = onboardingCookie.split("=")[1];
      return {
        hidden: value === "true",
        lastShown: null,
      };
    }
  } catch (err) {
    console.warn("[Onboarding] Cookie check failed:", err);
  }

  return { hidden: false, lastShown: null };
}

/**
 * Save onboarding state to storage
 */
export function saveOnboardingState(state: OnboardingState): void {
  try {
    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.log("[Onboarding] State saved to localStorage:", state);
  } catch (err) {
    console.warn("[Onboarding] localStorage save failed:", err);
  }

  // Always save to cookie as fallback
  try {
    const maxAge = 365 * 24 * 60 * 60; // 1 year
    document.cookie = `${COOKIE_NAME}=${state.hidden}; path=/; max-age=${maxAge}; SameSite=Lax`;
    console.log("[Onboarding] State saved to cookie");
  } catch (err) {
    console.warn("[Onboarding] Cookie save failed:", err);
  }
}

/**
 * Mark onboarding as shown now
 */
export function markOnboardingShown(): void {
  const state = getOnboardingState();
  state.lastShown = Date.now();
  saveOnboardingState(state);
}

/**
 * Hide onboarding permanently
 */
export function hideOnboardingPermanently(): void {
  saveOnboardingState({
    hidden: true,
    lastShown: Date.now(),
  });
}

/**
 * Check if onboarding should be shown
 * Returns true if should show, false otherwise
 */
export function shouldShowOnboarding(): boolean {
  const state = getOnboardingState();

  // If user opted out, never show
  if (state.hidden) {
    console.log("[Onboarding] Hidden by user preference");
    return false;
  }

  // If never shown before, show it
  if (!state.lastShown) {
    console.log("[Onboarding] First time - will show");
    return true;
  }

  // If shown within last 24 hours, don't show again (optional rate limiting)
  const timeSinceLastShown = Date.now() - state.lastShown;
  if (timeSinceLastShown < ONE_DAY_MS) {
    console.log("[Onboarding] Shown recently (within 24h) - skipping");
    return false;
  }

  // Otherwise, show it (user hasn't opted out but it's been >24h)
  console.log("[Onboarding] Last shown >24h ago - will show again");
  return true;
}

/**
 * Reset onboarding state (for testing)
 */
export function resetOnboardingState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
    console.log("[Onboarding] State reset");
  } catch (err) {
    console.warn("[Onboarding] Reset failed:", err);
  }
}