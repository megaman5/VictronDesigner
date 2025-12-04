import { Zap, Save, FolderOpen, Download, Sparkles, Cable, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TopBarProps {
  onAIPrompt?: () => void;
  onAIWire?: () => void;
  onExport?: () => void;
  onSave?: () => void;
  onOpen?: () => void;
  onWireMode?: () => void;
  wireMode?: boolean;
  onDesignReview?: () => void;
  designReviewOpen?: boolean;
}

export function TopBar({
  onAIPrompt,
  onAIWire,
  onExport,
  onSave,
  onOpen,
  onWireMode,
  wireMode = false,
  onDesignReview,
  designReviewOpen = false
}: TopBarProps) {
  return (
    <div className="h-16 border-b bg-card flex items-center justify-between px-4 gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Victron Designer</h1>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onAIPrompt}
          data-testid="button-ai-prompt"
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          AI Design
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onAIWire}
          data-testid="button-ai-wire"
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          AI Wire
        </Button>

        <Button
          variant={wireMode ? "default" : "outline"}
          size="sm"
          onClick={onWireMode}
          data-testid="button-wire-mode"
          className="gap-2"
        >
          <Cable className="h-4 w-4" />
          {wireMode ? "Connecting..." : "Add Wire"}
        </Button>

        <Button
          variant={designReviewOpen ? "default" : "outline"}
          size="sm"
          onClick={onDesignReview}
          data-testid="button-design-review"
          className="gap-2"
        >
          <ClipboardCheck className="h-4 w-4" />
          {designReviewOpen ? "Hide Review" : "Design Review"}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onOpen}
          data-testid="button-open-project"
        >
          <FolderOpen className="h-5 w-5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onSave}
          data-testid="button-save-project"
        >
          <Save className="h-5 w-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-export">
              <Download className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExport} data-testid="menu-export-diagram">
              Export Wiring Diagram
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExport} data-testid="menu-export-bom">
              Export Shopping List
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExport} data-testid="menu-export-labels">
              Export Wire Labels
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExport} data-testid="menu-export-pdf">
              Export as PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ThemeToggle />
      </div>
    </div>
  );
}
