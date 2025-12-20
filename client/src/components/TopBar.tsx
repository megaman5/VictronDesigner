import { Save, FolderOpen, Download, Sparkles, Cable, CheckCircle2, MessageSquare, LogIn, LogOut, User, Loader2, Activity, Tag, Trash2 } from "lucide-react";
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

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

interface TopBarProps {
  onAIPrompt?: () => void;
  onAIWire?: () => void;
  onExport?: () => void;
  onSave?: () => void;
  onOpen?: () => void;
  onWireMode?: () => void;
  onDesignQuality?: () => void;
  onFeedback?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onClear?: () => void;
  wireMode?: boolean;
  hasComponents?: boolean;
  designQualityScore?: number;
  user?: AuthUser | null;
  currentDesignName?: string;
  isAIWiring?: boolean;
  showWireLabels?: boolean;
  onToggleWireLabels?: () => void;
}

export function TopBar({ 
  onAIPrompt, 
  onAIWire, 
  onExport, 
  onSave, 
  onOpen, 
  onWireMode, 
  onDesignQuality, 
  onFeedback,
  onLogin,
  onLogout,
  onClear,
  wireMode = false, 
  hasComponents = false, 
  designQualityScore,
  user,
  currentDesignName,
  isAIWiring = false,
  showWireLabels = true,
  onToggleWireLabels
}: TopBarProps) {
  const isLoggedIn = !!user;

  return (
    <TooltipProvider>
      <div className="h-16 border-b bg-card flex items-center justify-between px-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img 
              src="/icon-only.png" 
              alt="VictronDesigner" 
              className="h-10 w-auto"
            />
            <h1 className="text-xl font-semibold">VictronDesigner.com</h1>
          </div>
          {currentDesignName && (
            <span className="text-sm text-muted-foreground">
              — {currentDesignName}
            </span>
          )}
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
            disabled={isAIWiring}
            data-testid="button-ai-wire"
            className="gap-2"
          >
            {isAIWiring ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Wiring...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                AI Wire
              </>
            )}
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

          {/* Open Button - enabled when logged in */}
          {isLoggedIn ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpen}
              data-testid="button-open-project"
            >
              <FolderOpen className="h-5 w-5" />
            </Button>
          ) : (
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
                <p>Sign in to open saved designs</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Save Button - enabled when logged in */}
          {isLoggedIn ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onSave}
              data-testid="button-save-project"
            >
              <Save className="h-5 w-5" />
            </Button>
          ) : (
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
                <p>Sign in to save designs</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Export Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onExport}
            data-testid="button-export"
          >
            <Download className="h-5 w-5" />
          </Button>

          {/* Clear All Button */}
          {hasComponents && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClear}
                  data-testid="button-clear-all"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Clear all components and wires</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Button
            variant={showWireLabels ? "default" : "outline"}
            size="sm"
            onClick={onToggleWireLabels}
            data-testid="button-toggle-wire-labels"
            className="gap-2"
          >
            <Tag className="h-4 w-4" />
            Labels
          </Button>

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

          {/* User Menu / Login Button */}
          {isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <User className="h-4 w-4" />
                  <span className="max-w-[100px] truncate hidden sm:inline">
                    {user.displayName || user.email}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  {user.email}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onOpen}>
                  <FolderOpen className="h-4 w-4 mr-2" />
                  My Designs
                </DropdownMenuItem>
                {user.isAdmin && (
                  <>
                    <DropdownMenuItem onClick={() => window.location.href = '/feedback-admin'}>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Feedback Admin
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => window.location.href = '/observability-admin'}>
                      <Activity className="h-4 w-4 mr-2" />
                      Observability Admin
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onLogin}
              className="gap-2"
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </Button>
          )}

          <ThemeToggle />
        </div>
      </div>
    </TooltipProvider>
  );
}
