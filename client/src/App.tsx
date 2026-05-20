import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

/**
 * Energy Civic Ledger — application shell.
 *
 * Upgrades over the previous version:
 *   - Home and NotFound are code-split via React.lazy so initial JS stays small.
 *   - A polished Suspense fallback matches the institutional aesthetic.
 *   - Smooth-scrolls to a hash anchor on first mount (e.g. /#rechner from social shares).
 *   - Restores window scroll position on plain navigation; respects hash anchors.
 *   - Track-page-view hook runs on every route change for Plausible / future analytics.
 *   - Stays on Vite + React 19 + wouter — no stack change.
 */

const Home = lazy(() => import("./pages/Home"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function useScrollManagement() {
  const [location] = useLocation();

  useEffect(() => {
    // Wait one frame so the new route has actually rendered
    const raf = requestAnimationFrame(() => {
      const hash = window.location.hash.replace("#", "");
      if (hash) {
        const target = document.getElementById(hash);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    });
    return () => cancelAnimationFrame(raf);
  }, [location]);
}

function useAnalyticsPageView() {
  const [location] = useLocation();

  useEffect(() => {
    // Plausible (loaded later via a <script> tag) listens on this event
    // window.plausible?.("pageview")
    const fn = (window as unknown as { plausible?: (e: string) => void }).plausible;
    if (typeof fn === "function") fn("pageview");
  }, [location]);
}

function RouteShell() {
  useScrollManagement();
  useAnalyticsPageView();

  return (
    <Switch>
      <Route path={"/"} component={Home} />
      {/* Deep-link routes for social share — render Home with the right hash */}
      <Route path={"/rechner"} component={Home} />
      <Route path={"/pilot"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function SuspenseFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Energie Teilen · wird vorbereitet
        </p>
      </div>
    </div>
  );
}

/**
 * Hash deep-link normaliser: /rechner → / + scroll to #rechner.
 * Runs once on first mount; non-blocking.
 */
function useDeepLinkRewrite() {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    const rewrites: Record<string, string> = {
      "/rechner": "#rechner",
      "/pilot": "#pilot-start",
    };
    const target = rewrites[location];
    if (target) {
      // Update URL without reload; keep history clean
      window.history.replaceState({}, "", "/" + target);
      setLocation("/");
    }
    // Only run on first mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function AppInner() {
  useDeepLinkRewrite();
  return (
    <Suspense fallback={<SuspenseFallback />}>
      <RouteShell />
    </Suspense>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg),
//   than change color palette in index.css to keep consistent foreground/background
//   color across components.
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use
//   `useTheme` hook.

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider delayDuration={150}>
          <Toaster richColors closeButton position="top-right" />
          <AppInner />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
