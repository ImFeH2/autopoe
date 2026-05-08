import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChartColumnBig,
  Clock3,
  Database,
  FileWarning,
  Gauge,
  Layers3,
  RefreshCw,
  Server,
  Sparkles,
  Workflow,
} from "lucide-react";
import {
  getBucketMetricValue,
  type StatsBucket,
  type StatsEvent,
  type StatsMetric,
} from "@/lib/stats";
import {
  PageScaffold,
  PageTitleBar,
  SoftPanel,
} from "@/components/layout/PageScaffold";
import {
  CodeBlock,
  MetricCard,
  PageState,
  StatusChip,
} from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { stateBadgeColor } from "@/lib/constants";
import {
  FILTER_ALL,
  METRIC_OPTIONS,
  RANGE_OPTIONS,
  SORT_OPTIONS,
  findLastActiveBucketIndex,
  formatDuration,
  formatInteger,
  formatRate,
  formatTimestamp,
  statsFilterLabelClass,
  statsSelectTriggerClass,
} from "@/pages/stats/lib";
import { useStatsPageState } from "@/pages/stats/useStatsPageState";

function StatsLoadingState() {
  return (
    <div className="space-y-5">
      <SoftPanel>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-3 w-24 rounded-full skeleton-shimmer" />
            <div className="h-8 w-52 rounded-full skeleton-shimmer" />
          </div>
          <div className="h-9 w-32 rounded-full skeleton-shimmer" />
        </div>
      </SoftPanel>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <SoftPanel key={index} className="space-y-3">
            <div className="h-3 w-20 rounded-full skeleton-shimmer" />
            <div className="h-8 w-28 rounded-full skeleton-shimmer" />
            <div className="h-3 w-32 rounded-full skeleton-shimmer" />
          </SoftPanel>
        ))}
      </div>
      <SoftPanel className="space-y-4">
        <div className="h-3 w-28 rounded-full skeleton-shimmer" />
        <div className="h-[220px] rounded-xl skeleton-shimmer" />
      </SoftPanel>
    </div>
  );
}

function StatsEmptyState() {
  return (
    <PageState
      icon={ChartColumnBig}
      title="No stats yet"
      description="No activity in this range."
    />
  );
}

function StatsErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <PageState
      icon={AlertTriangle}
      title="Failed to load stats"
      description={message}
      tone="danger"
      action={
        <Button
          type="button"
          variant="outline"
          className="border-border bg-accent/20 text-foreground hover:bg-accent/35"
          onClick={onRetry}
        >
          Retry
        </Button>
      }
    />
  );
}

function StatsValueCard({
  title,
  value,
  icon: Icon,
  accentClassName,
}: {
  title: string;
  value: string;
  icon: typeof Activity;
  accentClassName?: string;
}) {
  return (
    <MetricCard
      label={title}
      value={value}
      icon={Icon}
      accentClassName={accentClassName}
    />
  );
}

function StatsTrendChart({
  buckets,
  metric,
}: {
  buckets: StatsBucket[];
  metric: StatsMetric;
}) {
  const [activeIndex, setActiveIndex] = useState(() =>
    findLastActiveBucketIndex(buckets),
  );

  useEffect(() => {
    setActiveIndex(findLastActiveBucketIndex(buckets));
  }, [buckets]);

  if (buckets.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-xl border border-border bg-card/30 text-[13px] text-muted-foreground">
        No trend data in the selected range.
      </div>
    );
  }

  const values = buckets.map(
    (bucket) => getBucketMetricValue(bucket, metric) ?? 0,
  );
  const maxValue =
    metric === "cache_hit_rate"
      ? 1
      : Math.max(1, ...values, ...buckets.map((bucket) => bucket.compactCount));
  const activeBucket =
    buckets[Math.min(activeIndex, buckets.length - 1)] ?? buckets[0];
  const width = 1000;
  const height = 220;
  const paddingX = 18;
  const chartWidth = width - paddingX * 2;
  const chartHeight = 146;
  const barWidth = chartWidth / buckets.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card/30 px-4 py-3">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">
            {METRIC_OPTIONS.find((option) => option.value === metric)?.label}
          </p>
          <p className="mt-2 text-sm text-foreground">
            {formatTimestamp(activeBucket.startMs)} to{" "}
            {formatTimestamp(activeBucket.endMs)}
          </p>
        </div>
        <div className="grid gap-x-5 gap-y-2 text-[12px] text-muted-foreground sm:grid-cols-4">
          <span>Requests {formatInteger(activeBucket.requestCount)}</span>
          <span>Failures {formatInteger(activeBucket.errorCount)}</span>
          <span>Tokens {formatInteger(activeBucket.totalTokens)}</span>
          <span>
            Compacts{" "}
            {formatInteger(
              activeBucket.manualCompactCount + activeBucket.autoCompactCount,
            )}
          </span>
          <span>Cache Read {formatInteger(activeBucket.cacheRead)}</span>
          <span>Cache Write {formatInteger(activeBucket.cacheWrite)}</span>
          <span>Avg Latency {formatDuration(activeBucket.avgLatencyMs)}</span>
          <span>Hit Rate {formatRate(activeBucket.cacheHitRate)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/25 p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full">
          {Array.from({ length: 5 }).map((_, index) => {
            const y = 20 + (chartHeight / 4) * index;
            return (
              <line
                key={index}
                x1={paddingX}
                y1={y}
                x2={width - paddingX}
                y2={y}
                stroke="var(--graph-grid)"
                strokeWidth="1"
              />
            );
          })}

          {buckets.map((bucket, index) => {
            const value = getBucketMetricValue(bucket, metric) ?? 0;
            const totalCompactValue =
              bucket.manualCompactCount + bucket.autoCompactCount;
            const normalizedHeight =
              metric === "compacts"
                ? (totalCompactValue / maxValue) * chartHeight
                : (value / maxValue) * chartHeight;
            const x = paddingX + index * barWidth + barWidth * 0.15;
            const y = 20 + chartHeight - normalizedHeight;

            if (metric === "compacts") {
              const manualHeight =
                maxValue > 0
                  ? (bucket.manualCompactCount / maxValue) * chartHeight
                  : 0;
              const autoHeight =
                maxValue > 0
                  ? (bucket.autoCompactCount / maxValue) * chartHeight
                  : 0;
              return (
                <g key={bucket.startMs}>
                  <rect
                    x={x}
                    y={20 + chartHeight - autoHeight}
                    width={Math.max(8, barWidth * 0.7)}
                    height={Math.max(
                      autoHeight,
                      bucket.autoCompactCount > 0 ? 2 : 0,
                    )}
                    rx="8"
                    fill="var(--primary)"
                    fillOpacity="0.78"
                  />
                  <rect
                    x={x}
                    y={20 + chartHeight - autoHeight - manualHeight}
                    width={Math.max(8, barWidth * 0.7)}
                    height={Math.max(
                      manualHeight,
                      bucket.manualCompactCount > 0 ? 2 : 0,
                    )}
                    rx="8"
                    fill="var(--graph-status-idle)"
                    fillOpacity="0.78"
                  />
                </g>
              );
            }

            const fillColor =
              metric === "errors"
                ? "var(--graph-status-error)"
                : metric === "latency"
                  ? "var(--graph-status-idle)"
                  : metric === "cache_hit_rate"
                    ? "var(--graph-status-running)"
                    : metric === "cache_read" || metric === "cache_write"
                      ? "var(--primary)"
                      : "var(--foreground)";

            return (
              <rect
                key={bucket.startMs}
                x={x}
                y={y}
                width={Math.max(8, barWidth * 0.7)}
                height={Math.max(normalizedHeight, value > 0 ? 2 : 0)}
                rx="10"
                fill={fillColor}
                fillOpacity={metric === "errors" ? "0.82" : "0.78"}
              />
            );
          })}

          {buckets.map((bucket, index) => {
            const x = paddingX + index * barWidth;
            const isActive = activeIndex === index;
            return (
              <g key={`${bucket.startMs}-overlay`}>
                {isActive ? (
                  <rect
                    x={x}
                    y={12}
                    width={barWidth}
                    height={chartHeight + 16}
                    rx="14"
                    fill="var(--accent)"
                    fillOpacity="0.35"
                  />
                ) : null}
                <rect
                  x={x}
                  y={10}
                  width={barWidth}
                  height={chartHeight + 22}
                  fill="transparent"
                  onMouseEnter={() => setActiveIndex(index)}
                />
              </g>
            );
          })}

          {buckets.map((bucket, index) => {
            const shouldShow =
              index === 0 ||
              index === buckets.length - 1 ||
              index % Math.max(1, Math.floor(buckets.length / 6)) === 0;
            if (!shouldShow) {
              return null;
            }
            const x = paddingX + index * barWidth + barWidth * 0.5;
            return (
              <text
                key={`${bucket.startMs}-label`}
                x={x}
                y={height - 12}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                fillOpacity="0.8"
                fontSize="10"
              >
                {bucket.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function StatsSectionTitle({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function EventDetail({ event }: { event: StatsEvent }) {
  if (event.kind === "compact") {
    return (
      <div className="grid gap-3 rounded-xl border border-border bg-card/30 p-4 text-[12px] text-muted-foreground sm:grid-cols-2">
        <span>Trigger {event.compact.trigger_type}</span>
        <span>Duration {formatDuration(event.compact.duration_ms)}</span>
        <span>Result {event.compact.result}</span>
        <span>Error {event.compact.error_summary || "None"}</span>
      </div>
    );
  }

  const usage = event.request.normalized_usage;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card/30 p-4">
      <div className="grid gap-3 text-[12px] text-muted-foreground sm:grid-cols-3">
        <span>Duration {formatDuration(event.request.duration_ms)}</span>
        <span>Retries {formatInteger(event.request.retry_count)}</span>
        <span>Result {event.request.result}</span>
        <span>Input {formatInteger(usage?.input_tokens ?? null)}</span>
        <span>Output {formatInteger(usage?.output_tokens ?? null)}</span>
        <span>Total {formatInteger(usage?.total_tokens ?? null)}</span>
        <span>
          Cache Read {formatInteger(usage?.cache_read_tokens ?? null)}
        </span>
        <span>
          Cache Write {formatInteger(usage?.cache_write_tokens ?? null)}
        </span>
        <span>
          Cache Hit Rate{" "}
          {formatRate(
            typeof usage?.cache_read_tokens === "number" &&
              typeof usage?.input_tokens === "number" &&
              usage.input_tokens > 0
              ? usage.cache_read_tokens / usage.input_tokens
              : null,
          )}
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            Normalized Usage
          </p>
          <CodeBlock className="max-h-[240px]">
            {JSON.stringify(event.request.normalized_usage ?? null, null, 2)}
          </CodeBlock>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            Raw Usage
          </p>
          <CodeBlock className="max-h-[240px]">
            {JSON.stringify(event.request.raw_usage ?? null, null, 2)}
          </CodeBlock>
        </div>
      </div>
    </div>
  );
}

export function StatsPage() {
  const {
    range,
    metric,
    sortKey,
    expandedEventId,
    filterOptions,
    effectiveFilters,
    overview,
    buckets,
    providerGroups,
    tabGroups,
    agentGroups,
    recentEvents,
    hasVisibleStats,
    isLoading,
    isInitialLoading,
    hasBlockingError,
    hasRecoverableError,
    errorMessage,
    refresh,
    handleRangeChange,
    handleMetricChange,
    handleSortKeyChange,
    handleFilterChange,
    toggleExpandedEvent,
  } = useStatsPageState();

  const overviewCards = [
    {
      title: "Active Workflows",
      value: formatInteger(overview.activeTabs),
      icon: Layers3,
    },
    {
      title: "Running Agents",
      value: formatInteger(overview.runningAgents),
      icon: Bot,
    },
    {
      title: "LLM Requests",
      value: formatInteger(overview.llmRequests),
      icon: Sparkles,
    },
    {
      title: "Total Tokens",
      value: formatInteger(overview.totalTokens),
      icon: Workflow,
    },
    {
      title: "Error Rate",
      value: formatRate(overview.errorRate),
      icon: FileWarning,
      accentClassName: "text-destructive",
    },
    {
      title: "Avg Latency",
      value: formatDuration(overview.avgLatencyMs),
      icon: Clock3,
      accentClassName: "text-graph-status-idle",
    },
    ...(overview.hasCacheUsage
      ? [
          {
            title: "Cache Read",
            value: formatInteger(overview.cacheRead),
            icon: Database,
            accentClassName: "text-graph-status-running",
          },
          {
            title: "Cache Write",
            value: formatInteger(overview.cacheWrite),
            icon: Server,
            accentClassName: "text-primary",
          },
          {
            title: "Cache Hit Rate",
            value: formatRate(overview.cacheHitRate),
            icon: Gauge,
            accentClassName: "text-graph-status-running",
          },
        ]
      : []),
  ];

  return (
    <PageScaffold className="min-h-0">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border px-6 py-5">
          <PageTitleBar
            title="Stats"
            hint="Overall activity, not a single task conversation."
            actions={
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className={statsFilterLabelClass}>Range</span>
                  <Select value={range} onValueChange={handleRangeChange}>
                    <SelectTrigger
                      className={`w-[120px] ${statsSelectTriggerClass}`}
                    >
                      <SelectValue placeholder="Range" />
                    </SelectTrigger>
                    <SelectContent>
                      {RANGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-5 border-border bg-accent/20 text-foreground hover:bg-accent/35"
                  onClick={() => void refresh()}
                >
                  <RefreshCw
                    className={cn("size-4", isLoading && "animate-spin")}
                  />
                  Refresh
                </Button>
              </div>
            }
            className="border-b-0 pb-0"
          />

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <span className={statsFilterLabelClass}>Provider</span>
              <Select
                value={effectiveFilters.providerId ?? FILTER_ALL}
                onValueChange={(value) =>
                  handleFilterChange("providerId", value)
                }
              >
                <SelectTrigger className={`w-full ${statsSelectTriggerClass}`}>
                  <SelectValue placeholder="All Providers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All Providers</SelectItem>
                  {filterOptions.providers.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className={statsFilterLabelClass}>Model</span>
              <Select
                value={effectiveFilters.model ?? FILTER_ALL}
                onValueChange={(value) => handleFilterChange("model", value)}
              >
                <SelectTrigger className={`w-full ${statsSelectTriggerClass}`}>
                  <SelectValue placeholder="All Models" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All Models</SelectItem>
                  {filterOptions.models.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className={statsFilterLabelClass}>Workflow</span>
              <Select
                value={effectiveFilters.tabId ?? FILTER_ALL}
                onValueChange={(value) => handleFilterChange("tabId", value)}
              >
                <SelectTrigger className={`w-full ${statsSelectTriggerClass}`}>
                  <SelectValue placeholder="All Workflows" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All Workflows</SelectItem>
                  {filterOptions.tabs.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className={statsFilterLabelClass}>Agent</span>
              <Select
                value={effectiveFilters.agentId ?? FILTER_ALL}
                onValueChange={(value) => handleFilterChange("agentId", value)}
              >
                <SelectTrigger className={`w-full ${statsSelectTriggerClass}`}>
                  <SelectValue placeholder="All Agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL}>All Agents</SelectItem>
                  {filterOptions.agents.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {isInitialLoading ? (
            <StatsLoadingState />
          ) : hasBlockingError ? (
            <StatsErrorState
              message={errorMessage}
              onRetry={() => void refresh()}
            />
          ) : !hasVisibleStats ? (
            <StatsEmptyState />
          ) : (
            <div className="space-y-6">
              {hasRecoverableError ? (
                <SoftPanel className="border-destructive/12 bg-destructive/6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-xl border border-destructive/16 bg-destructive/10 text-destructive">
                        <AlertTriangle className="size-4" />
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-foreground">
                          Stats refresh failed
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          Showing the last successful response. Retry when
                          ready.
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-border bg-accent/20 text-foreground hover:bg-accent/35"
                      onClick={() => void refresh()}
                    >
                      Retry
                    </Button>
                  </div>
                </SoftPanel>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {overviewCards.map((card) => (
                  <StatsValueCard
                    key={card.title}
                    title={card.title}
                    value={card.value}
                    icon={card.icon}
                    accentClassName={card.accentClassName}
                  />
                ))}
              </div>

              <SoftPanel className="overflow-hidden">
                <StatsSectionTitle
                  title="Trend"
                  action={
                    <Select value={metric} onValueChange={handleMetricChange}>
                      <SelectTrigger
                        className={`w-[180px] ${statsSelectTriggerClass}`}
                      >
                        <SelectValue placeholder="Metric" />
                      </SelectTrigger>
                      <SelectContent>
                        {METRIC_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
                <StatsTrendChart buckets={buckets} metric={metric} />
              </SoftPanel>

              <div className="grid gap-6 xl:grid-cols-2">
                <SoftPanel className="overflow-hidden">
                  <StatsSectionTitle title="By Provider / Model" />
                  <div className="space-y-4">
                    {providerGroups.length === 0 ? (
                      <div className="rounded-xl border border-border bg-card/30 px-4 py-6 text-[13px] text-muted-foreground">
                        No request data matches the current scope.
                      </div>
                    ) : (
                      providerGroups.map((provider) => (
                        <div
                          key={provider.key}
                          className="rounded-xl border border-border bg-card/30 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[14px] font-medium text-foreground">
                                {provider.providerLabel}
                              </p>
                              <p className="mt-1 text-[12px] text-muted-foreground">
                                Requests {formatInteger(provider.requestCount)}{" "}
                                · Errors {formatInteger(provider.errorCount)} ·
                                Tokens {formatInteger(provider.totalTokens)} ·
                                Avg {formatDuration(provider.avgLatencyMs)} ·
                                Retries {formatInteger(provider.retryCount)}
                              </p>
                            </div>
                            <div className="text-right text-[12px] text-muted-foreground">
                              <p>
                                Cache Read {formatInteger(provider.cacheRead)}
                              </p>
                              <p>
                                Cache Write {formatInteger(provider.cacheWrite)}
                              </p>
                              <p>
                                Hit Rate {formatRate(provider.cacheHitRate)}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 space-y-2">
                            {provider.models.map((model) => (
                              <div
                                key={model.key}
                                className="grid gap-2 rounded-xl border border-border bg-accent/15 px-3.5 py-3 text-[12px] text-muted-foreground md:grid-cols-[minmax(0,1.2fr)_repeat(6,minmax(0,0.8fr))]"
                              >
                                <span className="font-medium text-foreground">
                                  {model.model}
                                </span>
                                <span>
                                  Req {formatInteger(model.requestCount)}
                                </span>
                                <span>
                                  Err {formatInteger(model.errorCount)}
                                </span>
                                <span>
                                  Tok {formatInteger(model.totalTokens)}
                                </span>
                                <span>
                                  Avg {formatDuration(model.avgLatencyMs)}
                                </span>
                                <span>
                                  Cache {formatInteger(model.cacheRead)}
                                </span>
                                <span>
                                  Hit {formatRate(model.cacheHitRate)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </SoftPanel>

                <div className="space-y-6">
                  <SoftPanel className="overflow-hidden">
                    <StatsSectionTitle
                      title="By Workflow / Agent"
                      action={
                        <Select
                          value={sortKey}
                          onValueChange={handleSortKeyChange}
                        >
                          <SelectTrigger
                            className={`w-[170px] ${statsSelectTriggerClass}`}
                          >
                            <SelectValue placeholder="Sort" />
                          </SelectTrigger>
                          <SelectContent>
                            {SORT_OPTIONS.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      }
                    />
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground/80">
                          Tabs
                        </p>
                        {tabGroups.length === 0 ? (
                          <div className="rounded-xl border border-border bg-card/30 px-4 py-6 text-[13px] text-muted-foreground">
                            No matching tab aggregates.
                          </div>
                        ) : (
                          tabGroups.map((tab) => (
                            <div
                              key={tab.key}
                              className="grid gap-2 rounded-xl border border-border bg-card/30 px-4 py-3 text-[12px] text-muted-foreground md:grid-cols-[minmax(0,1.15fr)_repeat(6,minmax(0,0.75fr))]"
                            >
                              <span className="font-medium text-foreground">
                                {tab.tabTitle}
                              </span>
                              <span>Req {formatInteger(tab.requestCount)}</span>
                              <span>Err {formatInteger(tab.errorCount)}</span>
                              <span>Tok {formatInteger(tab.totalTokens)}</span>
                              <span>Cmp {formatInteger(tab.compactCount)}</span>
                              <span>
                                Run {formatInteger(tab.runningAgents)}
                              </span>
                              <span>Hit {formatRate(tab.cacheHitRate)}</span>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground/80">
                          Agents
                        </p>
                        {agentGroups.length === 0 ? (
                          <div className="rounded-xl border border-border bg-card/30 px-4 py-6 text-[13px] text-muted-foreground">
                            No matching agent aggregates.
                          </div>
                        ) : (
                          agentGroups.map((agent) => (
                            <div
                              key={agent.key}
                              className="grid gap-2 rounded-xl border border-border bg-card/30 px-4 py-3 text-[12px] text-muted-foreground md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_repeat(5,minmax(0,0.72fr))]"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">
                                  {agent.agentLabel}
                                </p>
                                <p className="truncate text-[11px] text-muted-foreground/80">
                                  {agent.roleName || "No role"} ·{" "}
                                  {agent.tabTitle}
                                </p>
                              </div>
                              <StatusChip
                                className={cn(
                                  "px-2 py-0.5 uppercase tracking-[0.12em]",
                                  agent.state
                                    ? stateBadgeColor[agent.state]
                                    : "border-border bg-accent/25 text-muted-foreground",
                                )}
                              >
                                {agent.state || "unknown"}
                              </StatusChip>
                              <span>
                                Req {formatInteger(agent.requestCount)}
                              </span>
                              <span>Err {formatInteger(agent.errorCount)}</span>
                              <span>
                                Tok {formatInteger(agent.totalTokens)}
                              </span>
                              <span>
                                Avg {formatDuration(agent.avgLatencyMs)}
                              </span>
                              <span>
                                Cache {formatInteger(agent.cacheRead)}
                              </span>
                              <span>Hit {formatRate(agent.cacheHitRate)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </SoftPanel>
                </div>
              </div>

              <SoftPanel className="overflow-hidden">
                <StatsSectionTitle title="Recent Events" />
                <div className="space-y-2">
                  {recentEvents.length === 0 ? (
                    <div className="rounded-xl border border-border bg-card/30 px-4 py-6 text-[13px] text-muted-foreground">
                      No recent events match the current scope.
                    </div>
                  ) : (
                    recentEvents.map((event) => {
                      const isExpanded = expandedEventId === event.key;
                      let summaryText = "";
                      if (event.kind === "compact") {
                        summaryText = `${event.compact.trigger_type} compact ${event.compact.result}`;
                      } else if (event.kind === "request_error") {
                        summaryText = `Request failed${event.retryCount > 0 ? ` after ${event.retryCount} retries` : ""}`;
                      } else {
                        summaryText = `Retried ${event.retryCount} time${event.retryCount === 1 ? "" : "s"}`;
                      }
                      return (
                        <div key={event.key} className="space-y-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="grid h-auto w-full gap-3 rounded-xl border border-border bg-card/30 px-4 py-3 text-left text-[12px] text-muted-foreground hover:bg-accent/20 hover:text-inherit md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.25fr)]"
                            onClick={() => toggleExpandedEvent(event.key)}
                          >
                            <span className="text-foreground/85">
                              {formatTimestamp(event.endedAt)}
                            </span>
                            <span className="truncate">{event.tabTitle}</span>
                            <span className="truncate">{event.agentLabel}</span>
                            <span className="truncate">
                              {event.providerLabel} / {event.modelLabel}
                            </span>
                            <span
                              className={cn(
                                "truncate",
                                event.kind === "request_error"
                                  ? "text-destructive"
                                  : event.kind === "compact"
                                    ? "text-graph-status-idle"
                                    : "text-graph-status-running",
                              )}
                            >
                              {summaryText}
                            </span>
                          </Button>
                          {isExpanded ? <EventDetail event={event} /> : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </SoftPanel>
            </div>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
