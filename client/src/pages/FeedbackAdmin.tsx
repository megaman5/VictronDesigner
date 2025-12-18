import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  ArrowLeft, 
  Mail, 
  Calendar, 
  Monitor, 
  Trash2, 
  Eye,
  Download,
  Loader2,
  MessageSquare
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

export default function FeedbackAdmin() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const loadFeedback = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/feedback");
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

  useEffect(() => {
    loadFeedback();
  }, []);

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
              View and manage user feedback submissions
            </p>
          </div>
          <Badge variant="secondary" className="text-lg px-4 py-2">
            {feedback.length} submissions
          </Badge>
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
