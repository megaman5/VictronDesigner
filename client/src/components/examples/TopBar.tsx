import { ThemeProvider } from "@/lib/theme-provider";
import { TopBar } from "../TopBar";

export default function TopBarExample() {
  return (
    <ThemeProvider>
      <div className="h-screen bg-background">
        <TopBar
          onAIPrompt={() => console.log("AI Prompt clicked")}
          onExport={() => console.log("Export clicked")}
          onSave={() => console.log("Save clicked")}
          onOpen={() => console.log("Open clicked")}
        />
      </div>
    </ThemeProvider>
  );
}
