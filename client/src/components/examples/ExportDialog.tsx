import { useState } from "react";
import { ThemeProvider } from "@/lib/theme-provider";
import { ExportDialog } from "../ExportDialog";
import { Button } from "@/components/ui/button";

export default function ExportDialogExample() {
  const [open, setOpen] = useState(false);

  return (
    <ThemeProvider>
      <div className="h-screen bg-background flex items-center justify-center">
        <Button onClick={() => setOpen(true)}>Open Export Dialog</Button>
        <ExportDialog
          open={open}
          onOpenChange={setOpen}
          onExport={(options) => console.log("Export options:", options)}
        />
      </div>
    </ThemeProvider>
  );
}
