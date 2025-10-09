import { ThemeProvider } from "@/lib/theme-provider";
import { PropertiesPanel } from "../PropertiesPanel";

export default function PropertiesPanelExample() {
  return (
    <ThemeProvider>
      <div className="h-screen bg-background">
        <PropertiesPanel
          selectedComponent={{
            name: "MultiPlus 1200VA",
            voltage: 12,
            current: 100,
            power: 1200,
          }}
          wireCalculation={{
            current: 100,
            length: 15,
            voltage: 12,
            recommendedGauge: "4 AWG",
            voltageDrop: 2.1,
            status: "valid",
          }}
        />
      </div>
    </ThemeProvider>
  );
}
