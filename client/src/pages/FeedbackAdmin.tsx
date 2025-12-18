import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  ArrowLeft, 
  Mail, 
  Calendar, 
  Monitor, 
  Trash2, 
  Eye,
  Download,
  Loader2,
  MessageSquare,
  LogIn,
  ShieldAlert,
  LogOut,
  Activity
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Feedback {
  id: string;
  message: string;
  email?: string;
  userAgent: string;
  timestamp: string;
  state: {
    components: any[];
    wires: any[];
    systemVoltage: number;
  };
  screenshot?: string;
}

interface User {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export default function FeedbackAdmin() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/auth/user");
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
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

  const loadFeedback = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/feedback");
      if (response.status === 401) {
        // Not authenticated
        setUser(null);
        return;
      }
      if (response.status === 403) {
        // Not admin
        toast({
          title: "Access Denied",
          description: "You don't have admin privileges",
          variant: "destructive",
        });
        return;
      }
      if (!response.ok) throw new Error("Failed to load feedback");
      const data = await response.json();
      setFeedback(data);
    } catch (error: any) {
      console.error("Error loading feedback:", error);
      toast({
        title: "Error",
        description: "Failed to load feedback",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Load feedback when user is confirmed as admin
  useEffect(() => {
    if (authChecked && user?.isAdmin) {
      loadFeedback();
    } else if (authChecked) {
      setLoading(false);
    }
  }, [authChecked, user]);

  const handleLogin = () => {
    // Redirect to Google OAuth with return URL
    window.location.href = `/auth/google?returnTo=${encodeURIComponent("/feedback-admin")}`;
  };

  const handleLogout = async () => {
    try {
      await fetch("/auth/logout", { method: "POST" });
      setUser(null);
      toast({
        title: "Logged out",
        description: "You have been logged out",
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this feedback?")) return;

    try {
      const response = await fetch(`/api/feedback/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete feedback");
      
      toast({
        title: "Success",
        description: "Feedback deleted",
      });
      
      loadFeedback();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to delete feedback",
        variant: "destructive",
      });
    }
  };

  const handleLoadState = (feedbackItem: Feedback) => {
    // Store the state in localStorage so the designer can load it
    localStorage.setItem("loadedFeedbackState", JSON.stringify({
      components: feedbackItem.state.components,
      wires: feedbackItem.state.wires,
      systemVoltage: feedbackItem.state.systemVoltage,
    }));

    toast({
      title: "State loaded",
      description: "Redirecting to designer...",
    });

    // Navigate to designer
    setTimeout(() => setLocation("/"), 500);
  };

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  // Show loading state while checking auth
  if (!authChecked || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated - show login prompt
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <ShieldAlert className="h-6 w-6" />
              Admin Access Required
            </CardTitle>
            <CardDescription>
              Please sign in with Google to access the feedback admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleLogin} className="w-full gap-2" size="lg">
              <LogIn className="h-5 w-5" />
              Sign in with Google
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation("/")}
              className="w-full gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Designer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authenticated but not admin
  if (!user.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2 text-destructive">
              <ShieldAlert className="h-6 w-6" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You don't have permission to access this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertTitle>Unauthorized</AlertTitle>
              <AlertDescription>
                Signed in as <strong>{user.email}</strong><br />
                This account does not have admin privileges.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleLogout}
                className="flex-1 gap-2"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocation("/")}
                className="flex-1 gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Designer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Admin view
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-6xl py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/")}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Designer
              </Button>
            </div>
            <h1 className="text-3xl font-bold">Feedback Admin</h1>
            <p className="text-muted-foreground">
              Signed in as {user.displayName} ({user.email})
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-lg px-4 py-2">
              {feedback.length} submissions
            </Badge>
            <Button variant="outline" size="sm" onClick={() => setLocation("/observability-admin")} className="gap-2">
              <Activity className="h-4 w-4" />
              Observability
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>

        {feedback.length === 0 ? (
          <Alert>
            <MessageSquare className="h-4 w-4" />
            <AlertDescription>
              No feedback submissions yet. Users can submit feedback using the Feedback button in the designer.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {feedback.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{item.message.substring(0, 100)}{item.message.length > 100 ? "..." : ""}</CardTitle>
                      <CardDescription className="flex flex-wrap gap-3 mt-2">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(item.timestamp)}
                        </span>
                        {item.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {item.email}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Monitor className="h-3 w-3" />
                          {item.userAgent.split(" ")[0]}
                        </span>
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedFeedback(item)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {item.state.components.length} components
                    </Badge>
                    <Badge variant="secondary">
                      {item.state.wires.length} wires
                    </Badge>
                    <Badge variant="secondary">
                      {item.state.systemVoltage}V system
                    </Badge>
                    {item.screenshot && (
                      <Badge variant="secondary">Has screenshot</Badge>
                    )}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleLoadState(item)}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Load This State in Designer
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedFeedback} onOpenChange={() => setSelectedFeedback(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Feedback Details</DialogTitle>
            <DialogDescription>
              {selectedFeedback && formatDate(selectedFeedback.timestamp)}
            </DialogDescription>
          </DialogHeader>

          {selectedFeedback && (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Message</h3>
                <p className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-lg">
                  {selectedFeedback.message}
                </p>
              </div>

              {selectedFeedback.email && (
                <div>
                  <h3 className="font-semibold mb-2">Contact Email</h3>
                  <p className="text-sm">{selectedFeedback.email}</p>
                </div>
              )}

              <div>
                <h3 className="font-semibold mb-2">Design State</h3>
                <div className="flex gap-2">
                  <Badge>{selectedFeedback.state.components.length} components</Badge>
                  <Badge>{selectedFeedback.state.wires.length} wires</Badge>
                  <Badge>{selectedFeedback.state.systemVoltage}V</Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLoadState(selectedFeedback)}
                  className="gap-2 mt-2"
                >
                  <Download className="h-4 w-4" />
                  Load in Designer
                </Button>
              </div>

              {selectedFeedback.screenshot && (
                <div>
                  <h3 className="font-semibold mb-2">Screenshot</h3>
                  <img
                    src={selectedFeedback.screenshot}
                    alt="Design screenshot"
                    className="w-full border rounded-lg"
                  />
                </div>
              )}

              <div>
                <h3 className="font-semibold mb-2">User Agent</h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {selectedFeedback.userAgent}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
