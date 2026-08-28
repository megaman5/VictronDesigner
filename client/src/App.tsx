import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { initTracking } from "@/lib/tracking";
import { initPostHog } from "@/lib/posthog";
import SchematicDesigner from "@/pages/SchematicDesigner";
import FeedbackAdmin from "@/pages/FeedbackAdmin";
import ObservabilityAdmin from "@/pages/ObservabilityAdmin";
import SettingsAdmin from "@/pages/SettingsAdmin";
import AiUsageAdmin from "@/pages/AiUsageAdmin";
import NotFound from "@/pages/not-found";
import { KofiWidget } from "@/components/KofiWidget";

function Router() {
  return (
    <Switch>
      <Route path="/" component={SchematicDesigner} />
      <Route path="/feedback-admin" component={FeedbackAdmin} />
      <Route path="/observability-admin" component={ObservabilityAdmin} />
      <Route path="/settings-admin" component={SettingsAdmin} />
      <Route path="/ai-usage-admin" component={AiUsageAdmin} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Tip button belongs on the designer, not on the admin tooling.
function SupportWidget() {
  const [location] = useLocation();
  return location === "/" ? <KofiWidget /> : null;
}

function App() {
  // Initialize tracking on app load
  useEffect(() => {
    initTracking();
    initPostHog();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
          <SupportWidget />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
