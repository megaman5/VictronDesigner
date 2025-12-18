import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Loader2, 
  FolderOpen, 
  Trash2, 
  FileBox,
  Calendar,
  Zap
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DesignSummary {
  id: string;
  name: string;
  description?: string;
  systemVoltage: number;
  componentCount: number;
  wireCount: number;
  hasThumbnail: boolean;
  createdAt: string;
  updatedAt: string;
}

interface OpenDesignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoad: (design: {
    id: string;
    name: string;
    components: any[];
    wires: any[];
    systemVoltage: number;
  }) => void;
}

export function OpenDesignDialog({
  open,
  onOpenChange,
  onLoad,
}: OpenDesignDialogProps) {
  const { toast } = useToast();
  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDesignId, setLoadingDesignId] = useState<string | null>(null);
  const [deletingDesignId, setDeletingDesignId] = useState<string | null>(null);

  const loadDesigns = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/designs");
      if (!response.ok) {
        throw new Error("Failed to load designs");
      }
      const data = await response.json();
      setDesigns(data);
    } catch (error: any) {
      console.error("Error loading designs:", error);
      toast({
        title: "Error",
        description: "Failed to load your saved designs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadDesigns();
    }
  }, [open]);

  const handleLoad = async (designId: string) => {
    setLoadingDesignId(designId);
    try {
      const response = await fetch(`/api/designs/${designId}`);
      if (!response.ok) {
        throw new Error("Failed to load design");
      }
      const design = await response.json();
      
      onLoad({
        id: design.id,
        name: design.name,
        components: design.components,
        wires: design.wires,
        systemVoltage: design.systemVoltage,
      });

      toast({
        title: "Design loaded",
        description: `"${design.name}" loaded successfully`,
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error("Error loading design:", error);
      toast({
        title: "Error",
        description: "Failed to load design",
        variant: "destructive",
      });
    } finally {
      setLoadingDesignId(null);
    }
  };

  const handleDelete = async (designId: string, designName: string) => {
    if (!confirm(`Delete "${designName}"? This cannot be undone.`)) {
      return;
    }

    setDeletingDesignId(designId);
    try {
      const response = await fetch(`/api/designs/${designId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete design");
      }

      toast({
        title: "Deleted",
        description: `"${designName}" deleted`,
      });

      loadDesigns();
    } catch (error: any) {
      console.error("Error deleting design:", error);
      toast({
        title: "Error",
        description: "Failed to delete design",
        variant: "destructive",
      });
    } finally {
      setDeletingDesignId(null);
    }
  };

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Open Design
          </DialogTitle>
          <DialogDescription>
            Load a previously saved design from your account.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : designs.length === 0 ? (
          <div className="text-center py-12">
            <FileBox className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No saved designs yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Use the Save button to save your first design
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px] pr-4">
            <div className="space-y-3">
              {designs.map((design) => (
                <div
                  key={design.id}
                  className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{design.name}</h3>
                      {design.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {design.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="secondary" className="text-xs">
                          {design.componentCount} components
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {design.wireCount} wires
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          <Zap className="h-3 w-3 mr-1" />
                          {design.systemVoltage}V
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Updated {formatDate(design.updatedAt)}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        onClick={() => handleLoad(design.id)}
                        disabled={loadingDesignId === design.id || deletingDesignId === design.id}
                      >
                        {loadingDesignId === design.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Load"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(design.id, design.name)}
                        disabled={loadingDesignId === design.id || deletingDesignId === design.id}
                      >
                        {deletingDesignId === design.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
