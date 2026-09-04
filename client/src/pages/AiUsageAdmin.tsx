import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, RotateCcw, Plus, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

interface UserUsageRow {
  userId: string;
  userEmail: string | null;
  lifetimeSpentUsd: number;
  lifetimeEstimatedUsd: number;
  lifetimeLimitUsd: number;
  lifetimeRemainingUsd: number;
  monthSpentUsd: number;
  monthEstimatedUsd: number;
  requests: number;
  unpricedRequests: number;
  unpricedEstimatedUsd: number;
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

interface DailyUsage {
  date: string;
  costUsd: number;
  estimatedCostUsd: number;
  requests: number;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const usdPrecise = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

type SortKey = "email" | "spent" | "remaining" | "month" | "requests" | "unpriced" | "lastUsed";
type SortDir = "asc" | "desc";

const dailyChartConfig: ChartConfig = {
  costUsd: { label: "Measured", color: "hsl(var(--chart-1))" },
  estimatedCostUsd: { label: "+ Estimated (unpriced)", color: "hsl(var(--chart-3))" },
};

const userChartConfig: ChartConfig = {
  lifetimeEstimatedUsd: { label: "Est. lifetime spend", color: "hsl(var(--chart-1))" },
};

/**
 * Per-user AI spend, and the two controls that matter: top someone up after
 * they tip, or reset their counter. Real spend comes from measured token
 * usage; requests with no recorded usage (mostly pre-tracking history) get a
 * flat baseline estimate instead of being silently invisible.
 */
export default function AiUsageAdmin() {
  const { toast } = useToast();
  const [creditAmounts, setCreditAmounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("spent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, error } = useQuery<UsageResponse>({
    queryKey: ["/api/admin/ai/usage"],
  });

  const { data: dailyData } = useQuery<{ days: DailyUsage[] }>({
    queryKey: ["/api/admin/ai/usage/daily"],
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

  const users = data?.users ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? users.filter(u => (u.userEmail ?? u.userId).toLowerCase().includes(q))
      : users;

    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "email":
          return dir * (a.userEmail ?? a.userId).localeCompare(b.userEmail ?? b.userId);
        case "spent":
          return dir * (a.lifetimeEstimatedUsd - b.lifetimeEstimatedUsd);
        case "remaining":
          return dir * (a.lifetimeRemainingUsd - b.lifetimeRemainingUsd);
        case "month":
          return dir * (a.monthEstimatedUsd - b.monthEstimatedUsd);
        case "requests":
          return dir * (a.requests - b.requests);
        case "unpriced":
          return dir * (a.unpricedRequests - b.unpricedRequests);
        case "lastUsed":
          return dir * ((a.lastUsedAt ?? "").localeCompare(b.lastUsedAt ?? ""));
        default:
          return 0;
      }
    });
  }, [users, search, sortKey, sortDir]);

  const topUsersChartData = useMemo(() => {
    return [...users]
      .sort((a, b) => b.lifetimeEstimatedUsd - a.lifetimeEstimatedUsd)
      .slice(0, 10)
      .map(u => ({
        name: (u.userEmail ?? u.userId).split("@")[0],
        lifetimeEstimatedUsd: Number(u.lifetimeEstimatedUsd.toFixed(4)),
      }));
  }, [users]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none whitespace-nowrap"
      onClick={() => toggleSort(sortKeyName)}
      data-testid={`sort-${sortKeyName}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortKeyName ? (
          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </TableHead>
  );

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

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Default allowance {usd(data?.defaultLifetimeLimitUsd ?? 0)} per user, with a{" "}
          {usd(data?.monthlyLimitUsd ?? 0)}/month rate cap. Both must pass for a request to run.
          Figures are estimates from published list prices, not a bill. Requests with no recorded
          token usage get a flat baseline estimate rather than being counted as free.
        </p>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No platform-billed AI usage recorded yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Spend over time</CardTitle>
              </CardHeader>
              <CardContent>
                {dailyData?.days?.length ? (
                  <ChartContainer config={dailyChartConfig} className="aspect-auto h-[240px] w-full">
                    <AreaChart data={dailyData.days} margin={{ left: 8, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={32}
                        tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        width={48}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            labelFormatter={(v) => new Date(v).toLocaleDateString()}
                            formatter={(value, name) => [
                              usdPrecise(Number(value)),
                              name === "costUsd" ? " Measured" : " + Estimated (unpriced)",
                            ]}
                          />
                        }
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Area
                        dataKey="estimatedCostUsd"
                        type="monotone"
                        fill="var(--color-estimatedCostUsd)"
                        fillOpacity={0.15}
                        stroke="var(--color-estimatedCostUsd)"
                        strokeWidth={2}
                      />
                      <Area
                        dataKey="costUsd"
                        type="monotone"
                        fill="var(--color-costUsd)"
                        fillOpacity={0.35}
                        stroke="var(--color-costUsd)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ChartContainer>
                ) : (
                  <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                    Not enough history yet.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top users by estimated spend</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={userChartConfig} className="aspect-auto h-[240px] w-full">
                  <BarChart data={topUsersChartData} layout="vertical" margin={{ left: 8, right: 16, top: 8 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={96}
                      tick={{ fontSize: 12 }}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent formatter={(value) => [usdPrecise(Number(value)), " Est. spend"]} />}
                    />
                    <Bar dataKey="lifetimeEstimatedUsd" fill="var(--color-lifetimeEstimatedUsd)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder="Filter by email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs h-9"
              data-testid="input-filter-email"
            />
            <span className="text-sm text-muted-foreground">
              {filtered.length} of {users.length} users
            </span>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHeader label="User" sortKeyName="email" />
                    <SortHeader label="Lifetime spend" sortKeyName="spent" />
                    <SortHeader label="Remaining" sortKeyName="remaining" />
                    <SortHeader label="This month" sortKeyName="month" />
                    <SortHeader label="Requests" sortKeyName="requests" />
                    <SortHeader label="Unpriced" sortKeyName="unpriced" />
                    <SortHeader label="Last used" sortKeyName="lastUsed" />
                    <TableHead className="whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => {
                    const exhausted = u.lifetimeRemainingUsd <= 0;
                    return (
                      <TableRow key={u.userId} data-testid={`usage-row-${u.userId}`}>
                        <TableCell className="max-w-[220px]">
                          <div className="truncate font-medium">{u.userEmail ?? u.userId}</div>
                          {exhausted && (
                            <Badge variant="destructive" className="mt-1">
                              Out of allowance
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono whitespace-nowrap">
                          <div>
                            {usd(u.lifetimeSpentUsd)} / {usd(u.lifetimeLimitUsd)}
                          </div>
                          {u.unpricedRequests > 0 && (
                            <div
                              className="text-xs text-muted-foreground font-sans"
                              title="Cost estimated from typical token usage - the model had no recorded usage to price exactly"
                            >
                              +{usd(u.unpricedEstimatedUsd)} est. ({u.unpricedRequests} unpriced)
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono whitespace-nowrap">
                          {usd(u.lifetimeRemainingUsd)}
                        </TableCell>
                        <TableCell className="font-mono whitespace-nowrap">
                          {usd(u.monthSpentUsd)}
                        </TableCell>
                        <TableCell className="font-mono">{u.requests}</TableCell>
                        <TableCell>
                          {u.unpricedRequests > 0 ? (
                            <Badge variant="secondary">{u.unpricedRequests}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {u.lastUsedAt ? new Date(u.lastUsedAt).toLocaleDateString() : "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Input
                              type="number"
                              step="1"
                              min="0"
                              className="h-8 w-16"
                              placeholder="10"
                              value={creditAmounts[u.userId] ?? ""}
                              onChange={(e) =>
                                setCreditAmounts((p) => ({ ...p, [u.userId]: e.target.value }))
                              }
                              data-testid={`input-credit-${u.userId}`}
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 shrink-0"
                              title="Add credit"
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
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 shrink-0"
                              title="Reset spend"
                              disabled={mutate.isPending}
                              onClick={() =>
                                mutate.mutate({ userId: u.userId, action: "reset", body: { note: "Spend reset" } })
                              }
                              data-testid={`button-reset-${u.userId}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
