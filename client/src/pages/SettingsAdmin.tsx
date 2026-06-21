import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2, LogOut, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const ROUTING_STYLE_LABELS: Record<string, string> = {
  orthogonal: "Orthogonal",
  rounded: "Rounded",
  curved: "Curved",
  straight: "Straight",
};

interface User {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export default function SettingsAdmin() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiModel, setAIModel] = useState("");
  const [defaultAIModel, setDefaultAIModel] = useState("");
  const [routingEnabled, setRoutingEnabled] = useState(true);
  const [defaultRoutingStyle, setDefaultRoutingStyle] = useState("orthogonal");
  const [routingStyleOptions, setRoutingStyleOptions] = useState<string[]>([]);
  const [savingRouting, setSavingRouting] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/auth/user");
        if (response.ok) {
          setUser(await response.json());
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Auth check failed:", error);
        setUser(null);
      } finally {
        setAuthChecked(true);
      }
    };

    checkAuth();
  }, []);

  useEffect(() => {
    if (!authChecked) return;

    if (!user?.isAdmin) {
      setLoading(false);
      return;
    }

    const loadSettings = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/settings");
        if (!response.ok) throw new Error("Failed to load settings");
        const data = await response.json();
        setAIModel(data.aiModel || "");
        setDefaultAIModel(data.defaultAIModel || "");
        setRoutingEnabled(data.wireRoutingSelectorEnabled ?? true);
        setDefaultRoutingStyle(data.defaultWireRoutingStyle || "orthogonal");
        setRoutingStyleOptions(data.wireRoutingStyleOptions || []);
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [authChecked, user, toast]);

  const handleLogin = () => {
    window.location.href = `/auth/google?returnTo=${encodeURIComponent("/settings-admin")}`;
  };

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST" });
    setUser(null);
    toast({ title: "Logged out" });
  };

  const saveAIModel = async () => {
    const model = aiModel.trim();
    if (!model) {
      toast({ title: "Model is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/settings/ai-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!response.ok) throw new Error("Failed to save AI model");
      const data = await response.json();
      setAIModel(data.aiModel);
      toast({ title: "Saved", description: `AI model set to ${data.aiModel}` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveWireRouting = async (next: { enabled?: boolean; defaultStyle?: string }) => {
    setSavingRouting(true);
    try {
      const response = await fetch("/api/admin/settings/wire-routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("Failed to save wire routing settings");
      const data = await response.json();
      setRoutingEnabled(data.wireRoutingSelectorEnabled);
      setDefaultRoutingStyle(data.defaultWireRoutingStyle);
      toast({ title: "Saved", description: "Wire routing settings updated" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSavingRouting(false);
    }
  };

  if (!authChecked || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Admin Login Required</CardTitle>
            <CardDescription>Sign in to manage application settings.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleLogin} className="w-full">Sign in with Google</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have admin privileges.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" onClick={() => setLocation("/")} className="w-full">Back to Designer</Button>
            <Button variant="outline" onClick={handleLogout} className="w-full">Sign Out</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="gap-2 mb-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Designer
            </Button>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Settings className="h-7 w-7" />
              Admin Settings
            </h1>
            <p className="text-muted-foreground">Signed in as {user.displayName} ({user.email})</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>AI Model</CardTitle>
            <CardDescription>Controls the OpenAI model used for system generation, AI wiring, and iterative generation. Default: {defaultAIModel}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-model">Model name</Label>
              <Input id="ai-model" value={aiModel} onChange={(event) => setAIModel(event.target.value)} placeholder="gpt-5.4" />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveAIModel} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Model
              </Button>
              <Button variant="outline" onClick={() => setAIModel(defaultAIModel)} disabled={!defaultAIModel}>Use Default</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Wire Routing (Beta)</CardTitle>
            <CardDescription>
              Controls the wire routing style selector in the designer. When enabled, users can switch between routing styles (orthogonal, rounded, curved, straight); their choice is remembered in their browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="routing-enabled">Show routing style selector</Label>
                <p className="text-sm text-muted-foreground">Turn the beta selector on or off for everyone.</p>
              </div>
              <Switch
                id="routing-enabled"
                checked={routingEnabled}
                disabled={savingRouting}
                onCheckedChange={(checked) => saveWireRouting({ enabled: checked })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="routing-default">Default style</Label>
              <Select
                value={defaultRoutingStyle}
                onValueChange={(value) => saveWireRouting({ defaultStyle: value })}
                disabled={savingRouting}
              >
                <SelectTrigger id="routing-default" className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(routingStyleOptions.length ? routingStyleOptions : ["orthogonal", "rounded", "curved", "straight"]).map((style) => (
                    <SelectItem key={style} value={style}>
                      {ROUTING_STYLE_LABELS[style] || style}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">Used for users who haven't picked a style yet.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
