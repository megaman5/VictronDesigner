import { ThemeProvider } from "@/lib/theme-provider";
import { ComponentLibrary } from "../ComponentLibrary";

export default function ComponentLibraryExample() {
  return (
    <ThemeProvider>
      <div className="h-screen bg-background">
        <ComponentLibrary
          onDragStart={(comp) => console.log("Dragging:", comp.name)}
          onAddCustom={() => console.log("Add custom component")}
        />
      </div>
    </ThemeProvider>
  );
}
