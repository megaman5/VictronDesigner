import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, RotateCcw, Plus } from "lucide-react";

interface UserUsageRow {
  userId: string;
  userEmail: string | null;
  lifetimeSpentUsd: number;
  lifetimeLimitUsd: number;
  lifetimeRemainingUsd: number;
  monthSpentUsd: number;
  requests: number;
  unpricedRequests: number;
  lastUsedAt: string | null;
  spendSince: string | null;
  note: string | null;
  updatedBy: string | null;
}

interface UsageResponse {
  users: UserUsageRow[];
  defaultLifetimeLimitUsd: number;
  monthlyLimitUsd: number;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Per-user AI spend, and the two controls that matter: top someone up after
 * they tip, or reset their counter. Spend is an estimate from list prices, so
 * requests on unpriced models are called out rather than silently counted as
 * free.
 */
export default function AiUsageAdmin() {
  const { toast } = useToast();
  const [creditAmounts, setCreditAmounts] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery<UsageResponse>({
    queryKey: ["/api/admin/ai/usage"],
  });

  const mutate = useMutation({
    mutationFn: async ({ userId, action, body }: { userId: string; action: string; body: any }) => {
      const res = await apiRequest("POST", `/api/admin/ai/usage/${userId}/${action}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai/usage"] });
      toast({ title: "Updated" });
    },
    onError: (e: any) => {
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading usage...
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-destructive">Could not load usage. Admin access required.</div>;
  }

  const users = data?.users ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">AI Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Default allowance {usd(data?.defaultLifetimeLimitUsd ?? 0)} per user, with a{" "}
          {usd(data?.monthlyLimitUsd ?? 0)}/month rate cap. Both must pass for a request to run.
          Figures are estimates from published list prices, not a bill.
        </p>
      </div>

      {users.length === 0 && (
        <p className="text-sm text-muted-foreground">No platform-billed AI usage recorded yet.</p>
      )}

      {users.map((u) => {
        const exhausted = u.lifetimeRemainingUsd <= 0;
        const pct = u.lifetimeLimitUsd > 0
          ? Math.min(100, (u.lifetimeSpentUsd / u.lifetimeLimitUsd) * 100)
          : 0;

        return (
          <Card key={u.userId} data-testid={`usage-row-${u.userId}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <span>{u.userEmail ?? u.userId}</span>
                {exhausted && <Badge variant="destructive">Out of allowance</Badge>}
                {u.unpricedRequests > 0 && (
                  <Badge variant="secondary" title="Cost unknown for these - model had no price entry">
                    {u.unpricedRequests} unpriced
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Lifetime</div>
                  <div className="font-mono">
                    {usd(u.lifetimeSpentUsd)} / {usd(u.lifetimeLimitUsd)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Remaining</div>
                  <div className="font-mono">{usd(u.lifetimeRemainingUsd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">This month</div>
                  <div className="font-mono">{usd(u.monthSpentUsd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Requests</div>
                  <div className="font-mono">{u.requests}</div>
                </div>
              </div>

              <div className="h-1.5 rounded bg-muted overflow-hidden">
                <div
                  className={`h-full ${exhausted ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              {(u.spendSince || u.note) && (
                <p className="text-xs text-muted-foreground">
                  {u.spendSince && <>Counting since {new Date(u.spendSince).toLocaleString()}. </>}
                  {u.note}
                  {u.updatedBy && <> — set by {u.updatedBy}</>}
                </p>
              )}

              <div className="flex items-end gap-2 flex-wrap">
                <div className="space-y-1">
                  <Label className="text-xs">Add credit (USD)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    className="h-8 w-28"
                    placeholder="10"
                    value={creditAmounts[u.userId] ?? ""}
                    onChange={(e) =>
                      setCreditAmounts((p) => ({ ...p, [u.userId]: e.target.value }))
                    }
                    data-testid={`input-credit-${u.userId}`}
                  />
                </div>
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={mutate.isPending || !Number(creditAmounts[u.userId])}
                  onClick={() =>
                    mutate.mutate({
                      userId: u.userId,
                      action: "credit",
                      body: {
                        amountUsd: Number(creditAmounts[u.userId]),
                        note: "Credited after tip",
                      },
                    })
                  }
                  data-testid={`button-credit-${u.userId}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add credit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={mutate.isPending}
                  onClick={() =>
                    mutate.mutate({ userId: u.userId, action: "reset", body: { note: "Spend reset" } })
                  }
                  data-testid={`button-reset-${u.userId}`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset spend
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
