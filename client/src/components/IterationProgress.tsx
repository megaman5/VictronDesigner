import { CheckCircle2, Loader2, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface IterationProgressProps {
  currentIteration: number;
  maxIterations: number;
  currentScore: number;
  status: string;
}

export function IterationProgress({
  currentIteration,
  maxIterations,
  currentScore,
  status,
}: IterationProgressProps) {
  const progress = (currentIteration / maxIterations) * 100;
  const isComplete = status.includes("✅") || status.includes("⚠️");
  const isOptimized = status.includes("✅");

  return (
    <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[9999] w-96 animate-in slide-in-from-top-5 duration-300">
      <Card className={`border-4 ${isOptimized ? 'border-green-500' : isComplete ? 'border-yellow-500' : 'border-blue-500'} shadow-2xl bg-white dark:bg-slate-800`}>
        <CardContent className="pt-6 pb-4">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isComplete ? (
                  <CheckCircle2 className={`h-6 w-6 ${isOptimized ? 'text-green-500' : 'text-yellow-500'}`} />
                ) : (
                  <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                )}
                <span className="font-bold text-lg text-slate-900 dark:text-white">
                  {isComplete ? "AI Design Complete" : "AI Optimizing Design"}
                </span>
              </div>
              {currentScore > 0 && (
                <Badge variant={currentScore >= 70 ? "default" : "secondary"} className="text-sm font-bold">
                  {currentScore}/100
                </Badge>
              )}
            </div>

            {/* Status Message */}
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {status}
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Iteration {currentIteration} of {maxIterations}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {/* Iteration Steps */}
            <div className="flex gap-2 justify-center">
              {Array.from({ length: maxIterations }).map((_, i) => {
                const iterationNum = i + 1;
                const isCurrentOrPast = iterationNum <= currentIteration;
                const isCurrent = iterationNum === currentIteration;

                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center gap-1 flex-1 transition-all`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        isCurrentOrPast
                          ? isCurrent
                            ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                            : 'bg-primary/20 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {isCurrentOrPast && !isCurrent && isComplete ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        iterationNum
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {iterationNum === 1 ? "Generate" : iterationNum === 2 ? "Validate" : "Refine"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Quality Indicator */}
            {currentScore > 0 && (
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Design Quality:</span>
                  <span className={`font-semibold ${
                    currentScore >= 90 ? 'text-green-600' :
                    currentScore >= 70 ? 'text-blue-600' :
                    currentScore >= 50 ? 'text-yellow-600' :
                    'text-red-600'
                  }`}>
                    {currentScore >= 90 ? 'Excellent' :
                     currentScore >= 70 ? 'Good' :
                     currentScore >= 50 ? 'Fair' :
                     'Needs Work'}
                  </span>
                </div>
              </div>
            )}

            {/* Quality Tips */}
            {!isComplete && currentIteration > 1 && (
              <div className="flex items-start gap-2 p-2 bg-muted rounded-md">
                <Zap className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  AI is analyzing validation feedback and improving the design...
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
