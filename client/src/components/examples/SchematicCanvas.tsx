import { ThemeProvider } from "@/lib/theme-provider";
import { SchematicCanvas } from "../SchematicCanvas";

export default function SchematicCanvasExample() {
  return (
    <ThemeProvider>
      <div className="h-screen bg-background">
        <SchematicCanvas
          onComponentSelect={(comp) => console.log("Selected:", comp.name)}
          onDrop={(x, y) => console.log("Dropped at:", x, y)}
        />
      </div>
    </ThemeProvider>
  );
}
