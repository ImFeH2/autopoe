import type {
  AgentHistoryPage,
  AgentHistoryRun,
  AgentHistoryRunMetadata,
} from "@/lib/backend";
export type AgentHistoryCache = {
  metadataByRunId: Record<string, AgentHistoryRunMetadata>;
  orderedRunIds: string[];
  detailByRunId: Record<string, AgentHistoryRun>;
  expandedIds: string[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  hasEarlier: boolean;
  nextBeforeSequence: number | null;
  generation: number;
  scrollTop: number;
  followsLatest: boolean;
  newRunCount: number;
};
export function createAgentHistoryCache(): AgentHistoryCache {
  return {
    metadataByRunId: {},
    orderedRunIds: [],
    detailByRunId: {},
    expandedIds: [],
    loaded: false,
    loading: false,
    error: null,
    hasEarlier: false,
    nextBeforeSequence: null,
    generation: 0,
    scrollTop: 0,
    followsLatest: true,
    newRunCount: 0,
  };
}
export function mergeAgentHistoryPage(
  current: AgentHistoryCache,
  page: AgentHistoryPage,
): AgentHistoryCache {
  const metadataByRunId = { ...current.metadataByRunId };
  const newRunIds = page.runs.filter((run) => !metadataByRunId[run.run_id]);
  for (const run of page.runs) metadataByRunId[run.run_id] = run;
  const orderedRunIds = Object.values(metadataByRunId)
    .sort((left, right) => left.sequence - right.sequence)
    .map((run) => run.run_id);
  return {
    ...current,
    metadataByRunId,
    orderedRunIds,
    loaded: true,
    loading: false,
    error: null,
    hasEarlier: page.has_earlier,
    nextBeforeSequence: page.next_before_sequence,
    newRunCount:
      current.loaded && !current.followsLatest
        ? current.newRunCount + newRunIds.length
        : current.newRunCount,
  };
}
