import { Zap, Save, FolderOpen, Download, Sparkles, Cable, CheckCircle2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  onDesignQuality?: () => void;
  onFeedback?: () => void;
  wireMode?: boolean;
  hasComponents?: boolean; // Whether canvas has components (for AI Iterate mode)
  designQualityScore?: number;
}

export function TopBar({ onAIPrompt, onAIWire, onExport, onSave, onOpen, onWireMode, onDesignQuality, onFeedback, wireMode = false, hasComponents = false, designQualityScore }: TopBarProps) {
  return (
    <TooltipProvider>
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
          {hasComponents ? "AI Iterate" : "AI Design"}
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
          variant="outline"
          size="sm"
          onClick={onDesignQuality}
          data-testid="button-design-quality"
          className="gap-2"
        >
          <CheckCircle2 className="h-4 w-4" />
          Quality
          {designQualityScore !== undefined && (
            <span className="ml-1 font-semibold">{designQualityScore}</span>
          )}
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="icon"
                disabled
                data-testid="button-open-project"
                className="opacity-50 cursor-not-allowed"
              >
                <FolderOpen className="h-5 w-5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Coming Soon - Not yet implemented</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="icon"
                disabled
                data-testid="button-save-project"
                className="opacity-50 cursor-not-allowed"
              >
                <Save className="h-5 w-5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Coming Soon - Not yet implemented</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button 
                variant="ghost" 
                size="icon" 
                disabled
                data-testid="button-export"
                className="opacity-50 cursor-not-allowed"
              >
                <Download className="h-5 w-5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Coming Soon - Not yet implemented</p>
          </TooltipContent>
        </Tooltip>

        <Button
          variant="outline"
          size="sm"
          onClick={onFeedback}
          data-testid="button-feedback"
          className="gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Feedback
        </Button>

        <ThemeToggle />
        </div>
      </div>
    </TooltipProvider>
  );
}
