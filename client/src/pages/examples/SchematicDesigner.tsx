import { ThemeProvider } from "@/lib/theme-provider";
import SchematicDesigner from "../SchematicDesigner";

export default function SchematicDesignerExample() {
  return (
    <ThemeProvider>
      <SchematicDesigner />
    </ThemeProvider>
  );
}
