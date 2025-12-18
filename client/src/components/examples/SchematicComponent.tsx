import { ThemeProvider } from "@/lib/theme-provider";
import { SchematicComponent } from "../SchematicComponent";

export default function SchematicComponentExample() {
  return (
    <ThemeProvider>
      <div className="p-8 bg-background flex flex-wrap gap-8">
        <SchematicComponent type="multiplus" name="MultiPlus 1200VA" />
        <SchematicComponent type="mppt" name="MPPT 100/30" />
        <SchematicComponent type="cerbo" name="Cerbo GX" />
        <SchematicComponent type="bmv" name="BMV-712" />
        <SchematicComponent type="battery" name="Battery Bank" />
        <SchematicComponent type="solar-panel" name="Solar Panel" />
        <SchematicComponent type="ac-load" name="AC Loads" />
        <SchematicComponent type="dc-load" name="DC Loads" />
      </div>
    </ThemeProvider>
  );
}
