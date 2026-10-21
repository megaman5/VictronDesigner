import { useState, useEffect, useRef } from "react";
import html2canvas from "html2canvas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SessionExpiredDialog } from "@/components/SessionExpiredDialog";
import type { DesignDocument } from "@shared/design-document";
import type { SchematicComponent, Wire } from "@shared/schema";

interface SaveDesignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  components: SchematicComponent[];
  wires: Wire[];
  systemVoltage: number;
  existingDesignId?: string;
  existingName?: string;
  document?: DesignDocument;
  existingVersion?: number;
  onSaved?: (designId: string, name: string, version?: number, design?: any) => void;
  onSessionExpired?: () => void;
}

export function SaveDesignDialog({
  open,
  onOpenChange,
  components,
  wires,
  systemVoltage,
  existingDesignId,
  existingName,
  document,
  existingVersion,
  onSaved,
  onSessionExpired,
}: SaveDesignDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState(existingName || "");
  const [description, setDescription] = useState("");
  const request = useRef<{key:string;id:string}|null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState<"update" | "copy" | null>(null);
  const [sessionExpiredOpen, setSessionExpiredOpen] = useState(false);

  // Reset name when dialog opens
  useEffect(() => {
    if (open) {
      setName(existingName || "");
      setDescription(document?.metadata.description || "");
      setConflict(false);
      request.current=null;
      setSaveMode(null);
    }
  }, [open, existingName]);

  const hasExistingDesign = !!existingDesignId;
  const nameChanged = hasExistingDesign && name.trim() !== existingName;

  const captureScreenshot = async (): Promise<string | undefined> => {
    try {
      const canvasElement = window.document.querySelector('[data-testid="canvas-drop-zone"]') as HTMLElement;
      if (!canvasElement) return undefined;
      
      const canvas = await html2canvas(canvasElement, {
        backgroundColor: "#1a1a2e",
        scale: 0.5, // Lower resolution for thumbnails
        useCORS: true,
        logging: false,
      });
      
      return canvas.toDataURL("image/png", 0.7);
    } catch (error) {
      console.error("Error capturing screenshot:", error);
      return undefined;
    }
  };

  const handleSave = async (asCopy: boolean = false) => {
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Please enter a design name",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    setSaveMode(asCopy ? "copy" : "update");

    try {
      const thumbnail = await captureScreenshot();

      // If saving as copy or no existing design, create new
      const isNewDesign = asCopy || !existingDesignId;
      const url = isNewDesign ? "/api/designs" : `/api/designs/${existingDesignId}`;
      const method = isNewDesign ? "POST" : "PUT";

      const requestKey=JSON.stringify({isNewDesign,name,description,document,components,wires,systemVoltage,existingVersion});
      if(request.current?.key!==requestKey) request.current={key:requestKey,id:crypto.randomUUID()};
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId:request.current.id,
          expectedVersion:existingVersion,
          source:"manual",
          document:document ? {...document,metadata:{...document.metadata,name:name.trim(),description:description.trim()}} : undefined,
          name: name.trim(),
          description: description.trim() || undefined,
          systemVoltage,
          components,
          wires,
          thumbnail,
        }),
      });

      if (!response.ok) {
        if(response.status===409){setConflict(true);return;}
        if (response.status === 401) {
          // Session expired - show login dialog
          setSessionExpiredOpen(true);
          return;
        }
        const error = await response.json();
        throw new Error(error.error || "Failed to save design");
      }

      const design = await response.json();

      toast({
        title: asCopy ? "Copied!" : "Saved!",
        description: asCopy 
          ? `Design saved as "${name}"` 
          : `Design "${name}" saved successfully`,
      });

      onSaved?.(design.id, name.trim(),design.version,design);
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error saving design:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save design",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
      setSaveMode(null);
    }
  };

  const handleReLogin = () => {
    setSessionExpiredOpen(false);
    onOpenChange(false);
    // Redirect to login with return to current page
    window.location.href = `/auth/google?returnTo=${encodeURIComponent(window.location.pathname)}`;
  };

  return (
    <>
      <SessionExpiredDialog
        open={sessionExpiredOpen}
        onOpenChange={setSessionExpiredOpen}
        onLogin={handleReLogin}
      />
      
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-5 w-5" />
              {hasExistingDesign ? "Save Design" : "Save New Design"}
            </DialogTitle>
          <DialogDescription>
            {hasExistingDesign 
              ? "Update this design or save as a new copy."
              : "Save your current design to your account for later use."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {conflict && <p role="alert" className="text-sm text-destructive">Another session saved a newer version. Your work is kept. Save as Copy to keep both, or cancel and open the cloud design.</p>}
          <div className="space-y-2">
            <Label htmlFor="design-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="design-name"
              placeholder="My Solar System"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
            {nameChanged && (
              <p className="text-xs text-muted-foreground">
                Name changed — use "Save as Copy" to create a new design
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="design-description">Description (optional)</Label>
            <Textarea
              id="design-description"
              placeholder="Brief description of this design..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={saving}
            />
          </div>

          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium mb-1">Design summary:</p>
            <ul className="text-muted-foreground space-y-1">
              <li>• {components.length} components</li>
              <li>• {wires.length} wires</li>
              <li>• {systemVoltage}V system</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          
          {hasExistingDesign && (
            <Button 
              variant="outline" 
              onClick={() => handleSave(true)} 
              disabled={saving}
            >
              {saving && saveMode === "copy" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Copying...
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Save as Copy
                </>
              )}
            </Button>
          )}
          
          <Button onClick={() => handleSave(false)} disabled={saving || conflict}>
            {saving && saveMode === "update" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {hasExistingDesign ? "Update" : "Save"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
