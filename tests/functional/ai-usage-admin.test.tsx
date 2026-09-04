import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import AiUsageAdmin from '@/pages/AiUsageAdmin';

const usageResponse = {
  users: [
    {
      userId: 'u1',
      userEmail: 'heavy@example.com',
      lifetimeSpentUsd: 0,
      lifetimeEstimatedUsd: 3.2,
      lifetimeLimitUsd: 10,
      lifetimeRemainingUsd: 10,
      monthSpentUsd: 0,
      monthEstimatedUsd: 1.1,
      requests: 12,
      unpricedRequests: 12,
      unpricedEstimatedUsd: 3.2,
      lastUsedAt: '2026-08-20T00:00:00.000Z',
      spendSince: null,
      note: null,
      updatedBy: null,
    },
    {
      userId: 'u2',
      userEmail: 'light@example.com',
      lifetimeSpentUsd: 0.15,
      lifetimeEstimatedUsd: 0.15,
      lifetimeLimitUsd: 10,
      lifetimeRemainingUsd: 9.85,
      monthSpentUsd: 0.15,
      monthEstimatedUsd: 0.15,
      requests: 1,
      unpricedRequests: 0,
      unpricedEstimatedUsd: 0,
      lastUsedAt: '2026-08-10T00:00:00.000Z',
      spendSince: null,
      note: null,
      updatedBy: null,
    },
  ],
  defaultLifetimeLimitUsd: 10,
  monthlyLimitUsd: 5,
};

const dailyResponse = {
  days: [
    { date: '2026-08-18', costUsd: 0.05, estimatedCostUsd: 0.4, requests: 3 },
    { date: '2026-08-19', costUsd: 0.1, estimatedCostUsd: 0.6, requests: 5 },
  ],
};

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AiUsageAdmin />
    </QueryClientProvider>
  );
}

describe('AiUsageAdmin', () => {
  beforeEach(() => {
    queryClient.clear();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/admin/ai/usage/daily')) {
        return new Response(JSON.stringify(dailyResponse), { status: 200 });
      }
      if (url.includes('/api/admin/ai/usage')) {
        return new Response(JSON.stringify(usageResponse), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));
    // recharts' ResponsiveContainer needs a layout size in jsdom
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders both users once usage loads, sorted by estimated spend', async () => {
    renderPage();
    expect(await screen.findByText('heavy@example.com')).toBeInTheDocument();
    const rows = await screen.findAllByTestId(/^usage-row-/);
    expect(rows).toHaveLength(2);
    // heavy@example.com has the larger lifetimeEstimatedUsd - default sort is desc by estimate
    expect(within(rows[0]).getByText('heavy@example.com')).toBeInTheDocument();
  });

  it('surfaces the unpriced estimate instead of hiding it', async () => {
    renderPage();
    await screen.findByText('heavy@example.com');
    expect(screen.getByText(/\+\$3\.20 est\. \(12 unpriced\)/)).toBeInTheDocument();
  });

  it('filters rows by email', async () => {
    renderPage();
    await screen.findByText('heavy@example.com');
    const input = screen.getByTestId('input-filter-email');
    await import('@testing-library/user-event').then(({ default: userEvent }) =>
      userEvent.setup().type(input, 'light')
    );
    expect(screen.queryByText('heavy@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('light@example.com')).toBeInTheDocument();
  });
});
