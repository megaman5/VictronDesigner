import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2, LogOut, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

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
      </div>
    </div>
  );
}
