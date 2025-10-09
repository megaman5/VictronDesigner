import { useState } from "react";
import { ThemeProvider } from "@/lib/theme-provider";
import { AIPromptDialog } from "../AIPromptDialog";
import { Button } from "@/components/ui/button";

export default function AIPromptDialogExample() {
  const [open, setOpen] = useState(false);

  return (
    <ThemeProvider>
      <div className="h-screen bg-background flex items-center justify-center">
        <Button onClick={() => setOpen(true)}>Open AI Dialog</Button>
        <AIPromptDialog
          open={open}
          onOpenChange={setOpen}
          onGenerate={(prompt) => console.log("Generated from:", prompt)}
        />
      </div>
    </ThemeProvider>
  );
}
