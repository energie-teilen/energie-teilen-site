import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

/**
 * Energie Teilen — application shell.
 *
 *   - Home + NotFound code-split via React.lazy.
 *   - Legal pages (Impressum / Datenschutz / AGB) are now ROUTED. They are
 *     legally mandatory in Germany and were previously 404ing from the footer.
 *   - Smooth-scrolls to a hash anchor on first mount (e.g. /#rechner).
 *   - Restores scroll on plain navigation; respects hash anchors.
 *   - Page-view hook runs on every route change (Plausible).
 */

const Home = lazy(() => import("./pages/Home"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Impressum = lazy(() => import("@/pages/legal/Impressum"));
const Datenschutz = lazy(() => import("@/pages/legal/Datenschutz"));
const Agb = lazy(() => import("@/pages/legal/Agb"));

function useScrollManagement() {
  const [location] = useLocation();
  useEffect(() => {
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
      {/* Legally required pages */}
      <Route path={"/impressum"} component={Impressum} />
      <Route path={"/datenschutz"} component={Datenschutz} />
      <Route path={"/agb"} component={Agb} />
      <Route path={"/404"} component={NotFound} />
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
 * Legal routes are explicitly excluded so they keep their own URL.
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
      window.history.replaceState({}, "", "/" + target);
      setLocation("/");
    }
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
