import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle, Info, TrendingUp, Zap, Layout, Terminal, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import type { ValidationResult, ValidationIssue } from "@shared/schema";

interface DesignReviewPanelProps {
  components: any[];
  wires: any[];
  systemVoltage: number;
  onIssueClick?: (issue: ValidationIssue) => void;
}

export function DesignReviewPanel({
  components,
  wires,
  systemVoltage,
  onIssueClick,
}: DesignReviewPanelProps) {
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Auto-validate on component/wire changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      validateDesign();
    }, 500);

    return () => clearTimeout(timer);
  }, [components, wires]);

  const validateDesign = async () => {
    setIsValidating(true);
    try {
      const response = await fetch("/api/validate-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components, wires, systemVoltage }),
      });

      if (!response.ok) {
        throw new Error("Validation failed");
      }

      const result: ValidationResult = await response.json();
      setValidationResult(result);
    } catch (error) {
      console.error("Validation error:", error);
    } finally {
      setIsValidating(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    if (score >= 50) return "text-orange-600";
    return "text-red-600";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 90) return "Excellent";
    if (score >= 70) return "Good";
    if (score >= 50) return "Fair";
    return "Poor";
  };

  const getSeverityIcon = (severity: ValidationIssue["severity"]) => {
    switch (severity) {
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case "warning":
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case "info":
        return <Info className="h-4 w-4 text-blue-600" />;
    }
  };

  const getSeverityColor = (severity: ValidationIssue["severity"]) => {
    switch (severity) {
      case "error":
        return "border-red-500 bg-red-50 dark:bg-red-950/30";
      case "warning":
        return "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30";
      case "info":
        return "border-blue-500 bg-blue-50 dark:bg-blue-950/30";
    }
  };

  const getCategoryIcon = (category: ValidationIssue["category"]) => {
    switch (category) {
      case "electrical":
        return <Zap className="h-4 w-4" />;
      case "wire-sizing":
        return <TrendingUp className="h-4 w-4" />;
      case "layout":
        return <Layout className="h-4 w-4" />;
      case "terminal":
        return <Terminal className="h-4 w-4" />;
      case "ai-quality":
        return <Cpu className="h-4 w-4" />;
    }
  };

  const groupedIssues = validationResult?.issues.reduce((acc, issue) => {
    if (!acc[issue.category]) {
      acc[issue.category] = [];
    }
    acc[issue.category].push(issue);
    return acc;
  }, {} as Record<string, ValidationIssue[]>) || {};

  const errorCount = validationResult?.issues.filter(i => i.severity === "error").length || 0;
  const warningCount = validationResult?.issues.filter(i => i.severity === "warning").length || 0;
  const infoCount = validationResult?.issues.filter(i => i.severity === "info").length || 0;

  if (!validationResult && !isValidating) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Design Review</CardTitle>
          <CardDescription>Validate your electrical system design</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={validateDesign} className="w-full">
            Run Validation
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall Score Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Design Quality Score</span>
            {validationResult?.valid ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className={`text-5xl font-bold ${getScoreColor(validationResult?.score || 0)}`}>
                {validationResult?.score || 0}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {getScoreLabel(validationResult?.score || 0)}
              </div>
            </div>
            <div className="flex-1 space-y-2">
              <Progress value={validationResult?.score || 0} className="h-2" />
              <div className="flex gap-2 text-xs">
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errorCount} Errors
                </Badge>
                <Badge variant="outline" className="flex items-center gap-1 border-yellow-500 text-yellow-700">
                  <AlertCircle className="h-3 w-3" />
                  {warningCount} Warnings
                </Badge>
                <Badge variant="outline" className="flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  {infoCount} Info
                </Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <div className="text-muted-foreground">Components</div>
              <div className="font-semibold">{validationResult?.metrics?.componentCount}</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Wires</div>
              <div className="font-semibold">{validationResult?.metrics?.wireCount}</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Avg Spacing</div>
              <div className="font-semibold">{validationResult?.metrics?.avgComponentSpacing?.toFixed(0) || 'N/A'}px</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Layout Efficiency</div>
              <div className="font-semibold">{validationResult?.metrics?.layoutEfficiency?.toFixed(0) || 'N/A'}%</div>
            </div>
          </div>

          <Button
            onClick={validateDesign}
            className="w-full"
            variant="outline"
            disabled={isValidating}
          >
            {isValidating ? "Validating..." : "Re-validate Design"}
          </Button>
        </CardContent>
      </Card>

      {/* Issues List */}
      {validationResult && validationResult.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Issues & Recommendations</CardTitle>
            <CardDescription>
              {errorCount > 0 && `${errorCount} critical issues found. `}
              {warningCount > 0 && `${warningCount} warnings. `}
              Click an issue for details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {Object.entries(groupedIssues).map(([category, issues]) => (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold capitalize">
                      {getCategoryIcon(category as any)}
                      <span>{category.replace(/-/g, " ")}</span>
                      <Badge variant="secondary" className="ml-auto">
                        {issues.length}
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      {issues.map((issue, idx) => (
                        <div
                          key={`${category}-${idx}`}
                          className={`p-3 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md ${getSeverityColor(issue.severity)}`}
                          onClick={() => onIssueClick?.(issue)}
                        >
                          <div className="flex items-start gap-2">
                            {getSeverityIcon(issue.severity)}
                            <div className="flex-1 space-y-1">
                              <div className="text-sm font-medium leading-tight">
                                {issue.message}
                              </div>
                              {issue.suggestion && (
                                <div className="text-xs text-muted-foreground italic">
                                  💡 {issue.suggestion}
                                </div>
                              )}
                              {issue.componentIds && issue.componentIds.length > 0 && (
                                <div className="flex gap-1 mt-2">
                                  {issue.componentIds.map(id => (
                                    <Badge key={id} variant="outline" className="text-xs">
                                      {id}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* No Issues */}
      {validationResult && validationResult.issues.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
              <div className="font-semibold">No Issues Found!</div>
              <div className="text-sm text-muted-foreground">
                Your design follows all electrical standards and best practices.
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
