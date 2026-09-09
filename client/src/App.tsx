import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { initAnalytics } from "@/lib/analytics";
import { applyHeadForPath } from "@/lib/head";
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
const MesskonzeptTool = lazy(() => import("@/pages/tools/MesskonzeptTool"));
const AllocationTool = lazy(() => import("@/pages/tools/AllocationTool"));
const MarktkommunikationTool = lazy(() => import("@/pages/tools/MarktkommunikationTool"));
const ApiReference = lazy(() => import("@/pages/tools/ApiReference"));

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

/**
 * The build emits a static HTML file per route with the right title,
 * description and canonical, so a crawler and a link preview get the correct
 * answer without executing anything. This keeps it correct for the other case:
 * navigation inside the running application, where no new document is fetched.
 */
function useDocumentHead() {
  const [location] = useLocation();
  useEffect(() => {
    applyHeadForPath(location);
  }, [location]);
}

function useAnalyticsPageView() {
  const [location] = useLocation();
  // Install the queue stub and load the script before anything can fire.
  useEffect(() => {
    initAnalytics();
  }, []);
  useEffect(() => {
    const fn = (window as unknown as { plausible?: (e: string) => void }).plausible;
    if (typeof fn === "function") fn("pageview");
  }, [location]);
}

function RouteShell() {
  useScrollManagement();
  useDocumentHead();
  useAnalyticsPageView();

  return (
    <Switch>
      <Route path={"/"} component={Home} />
      {/* Deep-link routes for social share — render Home with the right hash */}
      <Route path={"/rechner"} component={Home} />
      <Route path={"/pilot"} component={Home} />
      {/*
        Each tool has its own route. A section inside a long page cannot be
        indexed, cannot be linked to from an answer, and cannot rank for the
        question it answers — the engines existed, the doors did not.
      */}
      <Route path={"/messkonzept"} component={MesskonzeptTool} />
      <Route path={"/aufteilungsschluessel"} component={AllocationTool} />
      <Route path={"/marktkommunikation"} component={MarktkommunikationTool} />
      <Route path={"/api"} component={ApiReference} />
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
      "/rechner": "rechner",
      "/pilot": "pilot-start",
    };
    const anchor = rewrites[location];
    if (!anchor) return;

    /*
     * setLocation("/") rewrites the URL, so calling replaceState first meant
     * the hash it had just written was discarded — a shared /rechner link
     * landed at the top of the page instead of at the calculator. The router
     * moves first; the hash is applied afterwards, and the scroll is performed
     * here because the hash arrives after the route effect has already run.
     */
    setLocation("/", { replace: true });
    window.history.replaceState({}, "", `/#${anchor}`);

    let frame = 0;
    let attempts = 0;
    const scrollWhenPresent = () => {
      const target = document.getElementById(anchor);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      // The section is code-split; wait for it rather than giving up at once.
      if (attempts++ < 60) frame = requestAnimationFrame(scrollWhenPresent);
    };
    frame = requestAnimationFrame(scrollWhenPresent);
    return () => cancelAnimationFrame(frame);
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
      {/*
        Entrance and reveal animations previously ran even when the visitor had
        asked their system for reduced motion; only the CSS transitions honoured
        it. reducedMotion="user" makes every motion component in the tree follow
        the same preference, so the setting means one thing across the product.
      */}
      <MotionConfig reducedMotion="user">
        <ThemeProvider defaultTheme="light">
          <TooltipProvider delayDuration={150}>
            <Toaster richColors closeButton position="top-right" />
            <AppInner />
          </TooltipProvider>
        </ThemeProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}

export default App;
