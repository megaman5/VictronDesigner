import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  Activity,
  Users,
  Cpu,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  Calendar,
  Loader2,
  LogIn,
  ShieldAlert,
  LogOut,
  RefreshCw,
  Trash2,
  MessageSquare,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

interface Stats {
  totalSessions: number;
  uniqueVisitors: number;
  totalAIRequests: number;
  successfulAIRequests: number;
  failedAIRequests: number;
  totalEvents: number;
  totalErrors: number;
  averageAIDuration: number;
  averageQualityScore: number;
  sessionsToday: number;
  aiRequestsToday: number;
  sessionsLast7Days: number;
  aiRequestsLast7Days: number;
}

interface DailyAnalytics {
  date: string;
  sessions: number;
  uniqueVisitors: number;
  aiRequests: number;
  successfulAI: number;
  aiSuccessRate: number;
  events: number;
}

interface AILog {
  id: string;
  timestamp: string;
  visitorId?: string;
  userId?: string;
  action: string;
  prompt: string;
  systemVoltage: number;
  success: boolean;
  durationMs: number;
  iterations?: number;
  qualityScore?: number;
  componentCount?: number;
  wireCount?: number;
  errorMessage?: string;
  model?: string;
  response?: {
    components?: any[];
    wires?: any[];
    description?: string;
    recommendations?: string[];
  };
}

interface Session {
  id: string;
  visitorId: string;
  userId?: string;
  userEmail?: string;
  startTime: string;
  lastActivity: string;
  userAgent: string;
  ip: string;
  pageViews: number;
  actions: number;
}

interface ErrorLog {
  id: string;
  timestamp: string;
  type: string;
  endpoint?: string;
  message: string;
  stack?: string;
}

interface AIBreakdown {
  [action: string]: {
    total: number;
    successful: number;
    failed: number;
    avgDuration: number;
    avgQuality: number;
  };
}

export default function ObservabilityAdmin() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<DailyAnalytics[]>([]);
  const [aiLogs, setAILogs] = useState<AILog[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [aiBreakdown, setAIBreakdown] = useState<AIBreakdown>({});
  const [selectedAILog, setSelectedAILog] = useState<AILog | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);
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

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, analyticsRes, aiLogsRes, sessionsRes, errorsRes, breakdownRes] = await Promise.all([
        fetch("/api/admin/observability/stats"),
        fetch("/api/admin/observability/analytics?days=30"),
        fetch("/api/admin/observability/ai-logs?limit=50"),
        fetch("/api/admin/observability/sessions?limit=50"),
        fetch("/api/admin/observability/errors?limit=50"),
        fetch("/api/admin/observability/ai-breakdown"),
      ]);

      if (statsRes.status === 401 || statsRes.status === 403) {
        toast({ title: "Access Denied", variant: "destructive" });
        return;
      }

      const [statsData, analyticsData, aiLogsData, sessionsData, errorsData, breakdownData] = await Promise.all([
        statsRes.json(),
        analyticsRes.json(),
        aiLogsRes.json(),
        sessionsRes.json(),
        errorsRes.json(),
        breakdownRes.json(),
      ]);

      setStats(statsData);
      setAnalytics(analyticsData);
      setAILogs(aiLogsData);
      setSessions(sessionsData);
      setErrors(errorsData);
      setAIBreakdown(breakdownData);
    } catch (error: any) {
      console.error("Error loading data:", error);
      toast({ title: "Error", description: "Failed to load observability data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authChecked && user?.isAdmin) {
      loadData();
    } else if (authChecked) {
      setLoading(false);
    }
  }, [authChecked, user]);

  const handleLogin = () => {
    window.location.href = `/auth/google?returnTo=${encodeURIComponent("/observability-admin")}`;
  };

  const handleLogout = async () => {
    try {
      await fetch("/auth/logout", { method: "POST" });
      setUser(null);
      toast({ title: "Logged out" });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleCleanup = async () => {
    if (!confirm("This will delete data older than 90 days. Continue?")) return;
    
    try {
      const response = await fetch("/api/admin/observability/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: 90 }),
      });
      
      if (response.ok) {
        const result = await response.json();
        toast({
          title: "Cleanup Complete",
          description: `Removed: ${result.sessionsRemoved} sessions, ${result.aiLogsRemoved} AI logs, ${result.eventsRemoved} events, ${result.errorsRemoved} errors`,
        });
        loadData();
      }
    } catch (error) {
      toast({ title: "Cleanup Failed", variant: "destructive" });
    }
  };

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Loading state
  if (!authChecked || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated
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
              Sign in with Google to access the observability dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleLogin} className="w-full gap-2" size="lg">
              <LogIn className="h-5 w-5" />
              Sign in with Google
            </Button>
            <Button variant="outline" onClick={() => setLocation("/")} className="w-full gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Designer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not admin
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
              <Button variant="outline" onClick={handleLogout} className="flex-1 gap-2">
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
              <Button variant="outline" onClick={() => setLocation("/")} className="flex-1 gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Admin dashboard
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-7xl py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Designer
              </Button>
            </div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Activity className="h-8 w-8" />
              Observability Dashboard
            </h1>
            <p className="text-muted-foreground">
              Signed in as {user.displayName} ({user.email})
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={loadData} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/feedback-admin")} className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Feedback
            </Button>
            <Button variant="outline" size="sm" onClick={handleCleanup} className="gap-2">
              <Trash2 className="h-4 w-4" />
              Cleanup Old Data
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Today's Sessions</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-blue-500" />
                  {stats.sessionsToday}
                </CardTitle>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Unique Visitors</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Users className="h-5 w-5 text-green-500" />
                  {stats.uniqueVisitors}
                </CardTitle>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>AI Requests Today</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-purple-500" />
                  {stats.aiRequestsToday}
                </CardTitle>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>AI Success Rate</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-emerald-500" />
                  {stats.totalAIRequests > 0 
                    ? Math.round((stats.successfulAIRequests / stats.totalAIRequests) * 100)
                    : 0}%
                </CardTitle>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Avg AI Duration</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  {formatDuration(stats.averageAIDuration)}
                </CardTitle>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Avg Quality Score</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-teal-500" />
                  {stats.averageQualityScore || 0}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Summary Row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">Total Sessions</div>
                <div className="text-xl font-bold">{stats.totalSessions}</div>
              </CardContent>
            </Card>
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">Total AI Requests</div>
                <div className="text-xl font-bold">{stats.totalAIRequests}</div>
              </CardContent>
            </Card>
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">Last 7 Days Sessions</div>
                <div className="text-xl font-bold">{stats.sessionsLast7Days}</div>
              </CardContent>
            </Card>
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">Total Errors</div>
                <div className="text-xl font-bold text-destructive">{stats.totalErrors}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* AI Breakdown */}
        {Object.keys(aiBreakdown).length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                AI Action Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Object.entries(aiBreakdown).map(([action, data]) => (
                  <Card key={action} className="bg-muted/30">
                    <CardContent className="pt-4">
                      <div className="font-semibold mb-2">{action}</div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>Total: <span className="font-medium">{data.total}</span></div>
                        <div>Success: <span className="font-medium text-green-600">{data.successful}</span></div>
                        <div>Failed: <span className="font-medium text-red-600">{data.failed}</span></div>
                        <div>Avg Duration: <span className="font-medium">{formatDuration(data.avgDuration)}</span></div>
                        <div>Avg Quality: <span className="font-medium">{data.avgQuality}</span></div>
                        <div>
                          Success Rate: 
                          <span className="font-medium ml-1">
                            {data.total > 0 ? Math.round((data.successful / data.total) * 100) : 0}%
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs for detailed data */}
        <Tabs defaultValue="ai-logs" className="space-y-4">
          <TabsList>
            <TabsTrigger value="ai-logs" className="gap-2">
              <Cpu className="h-4 w-4" />
              AI Logs ({aiLogs.length})
            </TabsTrigger>
            <TabsTrigger value="sessions" className="gap-2">
              <Users className="h-4 w-4" />
              Sessions ({sessions.length})
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Daily Analytics
            </TabsTrigger>
            <TabsTrigger value="errors" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              Errors ({errors.length})
            </TabsTrigger>
          </TabsList>

          {/* AI Logs Tab */}
          <TabsContent value="ai-logs">
            <Card>
              <CardHeader>
                <CardTitle>Recent AI Requests</CardTitle>
                <CardDescription>Last 50 AI generation requests - click a row for details</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Quality</TableHead>
                        <TableHead>Components</TableHead>
                        <TableHead>Prompt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aiLogs.map((log) => (
                        <TableRow 
                          key={log.id} 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedAILog(log)}
                        >
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatDate(log.timestamp)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.action}</Badge>
                          </TableCell>
                          <TableCell>
                            {log.success ? (
                              <Badge className="bg-green-500">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Success
                              </Badge>
                            ) : (
                              <Badge variant="destructive">
                                <XCircle className="h-3 w-3 mr-1" />
                                Failed
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{formatDuration(log.durationMs)}</TableCell>
                          <TableCell>{log.qualityScore || "-"}</TableCell>
                          <TableCell>{log.componentCount || 0}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={log.prompt}>
                            {log.prompt.substring(0, 50)}...
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sessions Tab */}
          <TabsContent value="sessions">
            <Card>
              <CardHeader>
                <CardTitle>Recent Sessions</CardTitle>
                <CardDescription>Last 50 user sessions - click a row for details</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead>Last Activity</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Page Views</TableHead>
                        <TableHead>Actions</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Browser</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((session) => (
                        <TableRow 
                          key={session.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedSession(session)}
                        >
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatDate(session.startTime)}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatDate(session.lastActivity)}
                          </TableCell>
                          <TableCell>
                            {session.userEmail ? (
                              <Badge variant="secondary">{session.userEmail}</Badge>
                            ) : (
                              <span className="text-muted-foreground">Anonymous</span>
                            )}
                          </TableCell>
                          <TableCell>{session.pageViews}</TableCell>
                          <TableCell>{session.actions}</TableCell>
                          <TableCell className="text-xs font-mono">{session.ip}</TableCell>
                          <TableCell className="max-w-[150px] truncate text-xs" title={session.userAgent}>
                            {session.userAgent.split(" ")[0]}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics">
            <Card>
              <CardHeader>
                <CardTitle>Daily Analytics (Last 30 Days)</CardTitle>
                <CardDescription>Day-by-day breakdown of usage</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Sessions</TableHead>
                        <TableHead>Unique Visitors</TableHead>
                        <TableHead>AI Requests</TableHead>
                        <TableHead>AI Success Rate</TableHead>
                        <TableHead>Events</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.slice().reverse().map((day) => (
                        <TableRow key={day.date}>
                          <TableCell className="font-medium">{day.date}</TableCell>
                          <TableCell>{day.sessions}</TableCell>
                          <TableCell>{day.uniqueVisitors}</TableCell>
                          <TableCell>{day.aiRequests}</TableCell>
                          <TableCell>
                            <Badge variant={day.aiSuccessRate >= 80 ? "default" : day.aiSuccessRate >= 50 ? "secondary" : "destructive"}>
                              {day.aiSuccessRate}%
                            </Badge>
                          </TableCell>
                          <TableCell>{day.events}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Errors Tab */}
          <TabsContent value="errors">
            <Card>
              <CardHeader>
                <CardTitle>Recent Errors</CardTitle>
                <CardDescription>Last 50 errors logged - click a row for details</CardDescription>
              </CardHeader>
              <CardContent>
                {errors.length === 0 ? (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>No Errors</AlertTitle>
                    <AlertDescription>No errors have been logged recently.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Endpoint</TableHead>
                          <TableHead>Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {errors.map((error) => (
                          <TableRow 
                            key={error.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setSelectedError(error)}
                          >
                            <TableCell className="text-xs whitespace-nowrap">
                              {formatDate(error.timestamp)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="destructive">{error.type}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{error.endpoint || "-"}</TableCell>
                            <TableCell className="max-w-[300px]">
                              <span className="text-sm text-destructive" title={error.message}>
                                {error.message.substring(0, 100)}
                                {error.message.length > 100 && "..."}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* AI Log Detail Dialog */}
      <Dialog open={!!selectedAILog} onOpenChange={() => setSelectedAILog(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              AI Request Details
            </DialogTitle>
            <DialogDescription>
              {selectedAILog && formatDate(selectedAILog.timestamp)}
            </DialogDescription>
          </DialogHeader>

          {selectedAILog && (
            <div className="space-y-6">
              {/* Status and Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Status</div>
                  <div className="mt-1">
                    {selectedAILog.success ? (
                      <Badge className="bg-green-500">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Success
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Failed
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Action</div>
                  <div className="mt-1">
                    <Badge variant="outline">{selectedAILog.action}</Badge>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Duration</div>
                  <div className="mt-1 font-medium">{formatDuration(selectedAILog.durationMs)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">System Voltage</div>
                  <div className="mt-1 font-medium">{selectedAILog.systemVoltage}V</div>
                </div>
              </div>

              {/* Results */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Quality Score</div>
                  <div className="mt-1 font-medium">{selectedAILog.qualityScore || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Iterations</div>
                  <div className="mt-1 font-medium">{selectedAILog.iterations || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Components</div>
                  <div className="mt-1 font-medium">{selectedAILog.componentCount || 0}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Wires</div>
                  <div className="mt-1 font-medium">{selectedAILog.wireCount || 0}</div>
                </div>
              </div>

              {/* User Info */}
              <div>
                <h3 className="font-semibold mb-2">User Info</h3>
                <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
                  <div><span className="text-muted-foreground">Visitor ID:</span> {selectedAILog.visitorId || "-"}</div>
                  <div><span className="text-muted-foreground">User ID:</span> {selectedAILog.userId || "Anonymous"}</div>
                  <div><span className="text-muted-foreground">Model:</span> {selectedAILog.model || "-"}</div>
                </div>
              </div>

              {/* Prompt */}
              <div>
                <h3 className="font-semibold mb-2">Prompt</h3>
                <pre className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto">
                  {selectedAILog.prompt}
                </pre>
              </div>

              {/* Error Message (if failed) */}
              {selectedAILog.errorMessage && (
                <div>
                  <h3 className="font-semibold mb-2 text-destructive">Error Message</h3>
                  <pre className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg text-sm text-destructive whitespace-pre-wrap overflow-x-auto">
                    {selectedAILog.errorMessage}
                  </pre>
                </div>
              )}

              {/* Response (if successful) */}
              {selectedAILog.response && (
                <div className="space-y-4">
                  {/* Description */}
                  {selectedAILog.response.description && (
                    <div>
                      <h3 className="font-semibold mb-2">AI Description</h3>
                      <p className="bg-muted p-3 rounded-lg text-sm">
                        {selectedAILog.response.description}
                      </p>
                    </div>
                  )}

                  {/* Recommendations */}
                  {selectedAILog.response.recommendations && selectedAILog.response.recommendations.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">Recommendations</h3>
                      <ul className="bg-muted p-3 rounded-lg text-sm list-disc list-inside space-y-1">
                        {selectedAILog.response.recommendations.map((rec, i) => (
                          <li key={i}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Components */}
                  {selectedAILog.response.components && selectedAILog.response.components.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">
                        Components Generated ({selectedAILog.response.components.length})
                      </h3>
                      <div className="bg-muted p-3 rounded-lg max-h-[200px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-1">ID</th>
                              <th className="text-left p-1">Type</th>
                              <th className="text-left p-1">Name</th>
                              <th className="text-left p-1">Position</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedAILog.response.components.map((comp: any) => (
                              <tr key={comp.id} className="border-b border-muted-foreground/20">
                                <td className="p-1 font-mono">{comp.id}</td>
                                <td className="p-1">{comp.type}</td>
                                <td className="p-1">{comp.name}</td>
                                <td className="p-1">({comp.x}, {comp.y})</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Wires */}
                  {selectedAILog.response.wires && selectedAILog.response.wires.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">
                        Wires Generated ({selectedAILog.response.wires.length})
                      </h3>
                      <div className="bg-muted p-3 rounded-lg max-h-[200px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-1">From</th>
                              <th className="text-left p-1">To</th>
                              <th className="text-left p-1">Polarity</th>
                              <th className="text-left p-1">Gauge</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedAILog.response.wires.map((wire: any, i: number) => (
                              <tr key={i} className="border-b border-muted-foreground/20">
                                <td className="p-1 font-mono text-[10px]">
                                  {wire.fromComponentId}:{wire.fromTerminal}
                                </td>
                                <td className="p-1 font-mono text-[10px]">
                                  {wire.toComponentId}:{wire.toTerminal}
                                </td>
                                <td className="p-1">
                                  <span className={wire.polarity === 'positive' ? 'text-red-500' : wire.polarity === 'negative' ? 'text-gray-700 dark:text-gray-300' : ''}>
                                    {wire.polarity}
                                  </span>
                                </td>
                                <td className="p-1">{wire.gauge}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Full JSON Response (collapsible) */}
                  <details className="group">
                    <summary className="font-semibold cursor-pointer hover:text-primary">
                      Full JSON Response (click to expand)
                    </summary>
                    <pre className="mt-2 bg-muted p-4 rounded-lg text-xs whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">
                      {JSON.stringify(selectedAILog.response, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Session Detail Dialog */}
      <Dialog open={!!selectedSession} onOpenChange={() => setSelectedSession(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Session Details
            </DialogTitle>
            <DialogDescription>
              {selectedSession && `Started ${formatDate(selectedSession.startTime)}`}
            </DialogDescription>
          </DialogHeader>

          {selectedSession && (
            <div className="space-y-6">
              {/* Session Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Page Views</div>
                  <div className="mt-1 text-2xl font-bold">{selectedSession.pageViews}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Actions</div>
                  <div className="mt-1 text-2xl font-bold">{selectedSession.actions}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Started</div>
                  <div className="mt-1 text-sm">{formatDate(selectedSession.startTime)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Last Activity</div>
                  <div className="mt-1 text-sm">{formatDate(selectedSession.lastActivity)}</div>
                </div>
              </div>

              {/* User Info */}
              <div>
                <h3 className="font-semibold mb-2">User</h3>
                <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
                  {selectedSession.userEmail ? (
                    <>
                      <div><span className="text-muted-foreground">Email:</span> {selectedSession.userEmail}</div>
                      <div><span className="text-muted-foreground">User ID:</span> {selectedSession.userId}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">Anonymous user</div>
                  )}
                  <div><span className="text-muted-foreground">Visitor ID:</span> <span className="font-mono">{selectedSession.visitorId}</span></div>
                </div>
              </div>

              {/* Technical Info */}
              <div>
                <h3 className="font-semibold mb-2">Technical Info</h3>
                <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
                  <div><span className="text-muted-foreground">IP Address:</span> <span className="font-mono">{selectedSession.ip}</span></div>
                  <div><span className="text-muted-foreground">Session ID:</span> <span className="font-mono text-xs">{selectedSession.id}</span></div>
                </div>
              </div>

              {/* User Agent */}
              <div>
                <h3 className="font-semibold mb-2">User Agent</h3>
                <pre className="bg-muted p-3 rounded-lg text-xs whitespace-pre-wrap overflow-x-auto">
                  {selectedSession.userAgent}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Error Detail Dialog */}
      <Dialog open={!!selectedError} onOpenChange={() => setSelectedError(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Error Details
            </DialogTitle>
            <DialogDescription>
              {selectedError && formatDate(selectedError.timestamp)}
            </DialogDescription>
          </DialogHeader>

          {selectedError && (
            <div className="space-y-6">
              {/* Error Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Type</div>
                  <div className="mt-1">
                    <Badge variant="destructive">{selectedError.type}</Badge>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Endpoint</div>
                  <div className="mt-1 font-mono text-sm">{selectedError.endpoint || "-"}</div>
                </div>
              </div>

              {/* Error Message */}
              <div>
                <h3 className="font-semibold mb-2">Error Message</h3>
                <pre className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg text-sm text-destructive whitespace-pre-wrap overflow-x-auto">
                  {selectedError.message}
                </pre>
              </div>

              {/* Stack Trace */}
              {selectedError.stack && (
                <div>
                  <h3 className="font-semibold mb-2">Stack Trace</h3>
                  <pre className="bg-muted p-4 rounded-lg text-xs whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">
                    {selectedError.stack}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
