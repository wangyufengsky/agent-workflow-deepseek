import { KnowledgePermissions } from './KnowledgePermissions.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ROUTES,
  type KnowledgeAskResponse,
  type KnowledgePermissions as KnowledgePermissionState,
  type KnowledgeCitation,
  type KnowledgeHistoryResponse,
  type KnowledgeRunProgress,
  type KnowledgeRunStatusValue,
  type KnowledgeSearchResponse,
  type KnowledgeSourceContentResponse,
  type KnowledgeSourcesResponse,
} from '@agent-workflow/shared';
import { apiGet, errorMessage } from '../../api/client.ts';
import { useBootstrap } from '../../api/hooks.ts';
import { Badge } from '../../components/Badge.tsx';
import { Button, LinkButton } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Drawer } from '../../components/Drawer.tsx';
import { EmptyState, SkeletonText } from '../../components/EmptyState.tsx';
import { Icon } from '../../components/Icon.tsx';
import { IconButton } from '../../components/IconButton.tsx';
import { Modal } from '../../components/Modal.tsx';
import { ServiceNotice } from '../../components/ServiceNotice.tsx';
import { KnowledgeConversationEntry, type SourceCardView } from './KnowledgeConversationEntry.tsx';
import { KnowledgeResearcherDrawer } from './KnowledgeResearcherDrawer.tsx';
import { useKnowledgeAsk } from './useKnowledgeAsk.ts';
import './knowledge.css';

const NARROW_QUERY = '(max-width: 1200px)';
const DOCUMENT_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'rst', 'json', 'yaml', 'yml']);

/** Source kind derived only from the frozen path (same rule as the service inventory). */
function sourceKindOf(path: string): SourceCardView['kind'] {
  if (path.startsWith('web:')) return 'web';
  if (path.startsWith('database:')) return 'database';
  const dot = path.lastIndexOf('.');
  return dot >= 0 && DOCUMENT_EXTENSIONS.has(path.slice(dot + 1).toLowerCase()) ? 'document' : 'code';
}

function runningSourceCards(progress: KnowledgeRunProgress | undefined): readonly SourceCardView[] {
  return (progress?.sourceCards ?? []).map((card) => ({ path: card.path, kind: card.kind, state: card.state, readAt: card.readAt }));
}

/** Completed results carry the frozen readPaths but no per-read timestamps. */
function resultSourceCards(result: KnowledgeAskResponse | undefined): readonly SourceCardView[] {
  const sources = result?.sources;
  if (sources === undefined) return [];
  return sources.readPaths.map((path) => ({ path, kind: sourceKindOf(path), state: sources.truncatedPaths.includes(path) ? 'truncated' : 'read' }));
}

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const update = () => { setNarrow(media.matches); };
    update();
    media.addEventListener('change', update);
    return () => { media.removeEventListener('change', update); };
  }, []);
  return narrow;
}

function markedLine(text: string, citation: KnowledgeCitation | undefined, lineNumber: number) {
  const snippet = citation?.snippet?.trim();
  if (snippet !== undefined && snippet.length > 0) {
    const index = text.indexOf(snippet);
    if (index >= 0) {
      return (
        <>
          {text.slice(0, index)}
          <mark>{text.slice(index, index + snippet.length)}</mark>
          {text.slice(index + snippet.length)}
        </>
      );
    }
  }
  if (citation?.line === lineNumber) return <mark>{text.length === 0 ? ' ' : text}</mark>;
  return text;
}

function CitationBody({
  sourcePath,
  citation,
  content,
  bytes,
  loading,
  error,
  onRetry,
}: {
  readonly sourcePath: string;
  readonly citation?: KnowledgeCitation;
  readonly content?: string;
  readonly bytes?: number;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const hitLineRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setShowFull(false); }, [sourcePath, citation?.line]);
  useEffect(() => {
    if (citation === undefined) return;
    const timer = window.setTimeout(() => {
      hitLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
    return () => { window.clearTimeout(timer); };
  }, [citation, content, sourcePath]);

  if (loading) return <SkeletonText lines={10} />;
  if (error !== null && error !== undefined) {
    return (
      <ServiceNotice
        error={error}
        title="来源正文读取失败"
        onRetry={onRetry}
      />
    );
  }
  if (content === undefined) {
    return <p className="hint">服务没有返回来源正文；本页不会伪造原文。</p>;
  }

  const lines = content.split('\n');
  const total = lines.length;
  const citationLine = citation?.line;
  const around = citation !== undefined && citationLine !== undefined && citationLine > 0 && !showFull;
  const start = around && citationLine !== undefined
    ? Math.max(0, Math.min(citationLine - 41, Math.max(0, total - 1)))
    : 0;
  const end = around && citationLine !== undefined
    ? Math.min(total, citationLine + 40)
    : total;
  const visible = lines.slice(start, end);

  return (
    <div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge tone="idle" icon="lock">只读正文</Badge>
        <span className="hint">{bytes === undefined ? '字节数未知' : `${String(bytes)} 字节`}</span>
        <span className="spacer" />
        {citation === undefined || citationLine === undefined ? null : (
          <Button
            variant="ghost"
            size="sm"
            icon={showFull ? 'eye' : 'search'}
            onClick={() => { setShowFull((current) => !current); }}
          >
            {showFull ? '只看引用附近' : '查看全文'}
          </Button>
        )}
      </div>

      {citation?.snippet === undefined ? null : (
        <div className="kb-source-snippet" style={{ marginTop: 10 }}>
          <b>引用片段</b>
          <div style={{ marginTop: 4 }}>{citation.snippet}</div>
        </div>
      )}

      <p className="hint" style={{ marginTop: 10 }}>
        {citation === undefined
          ? `显示全文 · 共 ${String(total)} 行`
          : `引用位置：第 ${String(citationLine ?? '—')} 行 · 当前显示第 ${String(start + 1)}–${String(end)} 行 / 共 ${String(total)} 行`}
      </p>

      {content.length === 0 ? (
        <p className="hint">来源正文为空。</p>
      ) : (
        <div className="kb-source-lines" role="region" aria-label="来源正文">
          {visible.map((text, index) => {
            const lineNumber = start + index + 1;
            const hit = citation !== undefined
              && (citation.line === lineNumber
                || (citation.snippet !== undefined && citation.snippet.trim().length > 0 && text.includes(citation.snippet.trim())));
            return (
              <div
                key={lineNumber}
                ref={citation?.line === lineNumber ? hitLineRef : undefined}
                className={`kb-source-line${hit ? ' hit' : ''}`}
              >
                <span className="no" aria-hidden="true">{String(lineNumber)}</span>
                <span className="code">{markedLine(text, citation, lineNumber)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CitationNav({
  index,
  total,
  onPrev,
  onNext,
}: {
  readonly index: number | undefined;
  readonly total: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}) {
  if (index === undefined || total === 0) return null;
  return (
    <div className="kb-cite-nav">
      <Button variant="secondary" size="sm" icon="chevLeft" onClick={onPrev}>
        上一处
      </Button>
      <span className="hint num">{String(index + 1)} / {String(total)}</span>
      <Button variant="secondary" size="sm" iconAfter="chevRight" onClick={onNext}>
        下一处
      </Button>
    </div>
  );
}

export function KnowledgePage() {
  const bootstrap = useBootstrap();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedLocation = useRef('');
  const narrow = useNarrowViewport();
  const [question, setQuestion] = useState('');
  const projects = bootstrap.data?.projects ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [submittedTerm, setSubmittedTerm] = useState('');
  const [permissions, setPermissions] = useState<KnowledgePermissionState>();
  const [permissionLocked, setPermissionLocked] = useState(false);
  const [modelId, setModelId] = useState('');
  const [sourceKind, setSourceKind] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sourceRequestKey, setSourceRequestKey] = useState<string>();
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [citationIndex, setCitationIndex] = useState<number | null>(null);
  const [researcherOpen, setResearcherOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [askResult, setAskResult] = useState<KnowledgeAskResponse | undefined>(undefined);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [selectedSources, setSelectedSources] = useState<ReadonlySet<string>>(new Set());
  const [selectionProject, setSelectionProject] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const projectId = selectedProjectId !== '' ? selectedProjectId : (projects[0]?.id ?? '');

  const conversationQuery = useQuery({ queryKey: ['knowledge', 'conversation', projectId, conversationId], queryFn: async () => (await apiGet<{ conversation: import('@agent-workflow/shared').KnowledgeConversation }>(`${ROUTES.knowledgeConversation(conversationId!)}?projectId=${encodeURIComponent(projectId)}`)).data.conversation, enabled: projectId !== '' && conversationId !== undefined, refetchInterval: 3000, retry: false });
  const historyQuery = useQuery({
    queryKey: ['knowledge', 'history', projectId],
    queryFn: async () => (await apiGet<KnowledgeHistoryResponse>(`/api/knowledge/history?projectId=${encodeURIComponent(projectId)}`)).data,
    enabled: projectId !== '',
    retry: false,
  });
  const askCommand = useKnowledgeAsk((result) => {
      setSelectedProjectId(result.projectId);
      setAskResult(result);
      setConversationId(result.conversationId);
      setSearchParams({ project: result.projectId, conversation: result.conversationId, ...(result.requestKey === undefined ? {} : { requestKey: result.requestKey }) }, { replace: true });
      setCitationIndex(null);
      setSourcePath(null);
      void queryClient.invalidateQueries({ queryKey: ['knowledge', 'history', result.projectId] });
  });
  useEffect(() => {
    const input = askCommand.pending?.input;
    if (input === undefined) return;
    setSelectedProjectId(input.projectId);
    setQuestion(input.question);
    setConversationId(input.conversationId);
  }, [askCommand.pending?.input]);
  const contentQuery = useQuery({
    queryKey: ['knowledge', 'content', projectId, sourcePath, sourceRequestKey, permissions?.revision],
    queryFn: async () => (await apiGet<KnowledgeSourceContentResponse>(`/api/knowledge/source?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(sourcePath ?? '')}${sourceRequestKey === undefined ? '' : `&requestKey=${encodeURIComponent(sourceRequestKey)}`}`)).data,
    enabled: projectId !== '' && sourcePath !== null,
    retry: false,
  });
  const searchQuery = useQuery({
    queryKey: ['knowledge', 'search', projectId, submittedTerm, permissions?.revision],
    queryFn: async () => (await apiGet<KnowledgeSearchResponse>(`/api/knowledge/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(submittedTerm)}`)).data,
    enabled: projectId !== '' && permissions?.originalRead === true && submittedTerm.trim().length >= 2,
    retry: false,
  });
  const sourcesQuery = useQuery({
    queryKey: ['knowledge', 'sources', projectId],
    refetchInterval: 3000,
    queryFn: async () => (await apiGet<KnowledgeSourcesResponse>(`/api/knowledge/sources?projectId=${encodeURIComponent(projectId)}`)).data,
    enabled: projectId !== '',
    retry: false,
  });

  useEffect(() => { const current = sourcesQuery.data?.permissions; if (current === undefined) return; setPermissions((previous) => previous?.projectId === current.projectId && previous.revision > current.revision ? previous : current); }, [sourcesQuery.data?.permissions]);
  useEffect(() => { try { setPermissionLocked(sessionStorage.getItem(`agent-workflow.knowledge.permissions.${projectId}`) !== null); } catch { setPermissionLocked(true); } }, [projectId]);
  const canPresent = (sources: KnowledgeAskResponse['sources']) => permissions?.projectId === projectId && permissions !== undefined && ((sources?.readPaths.some((path) => !path.startsWith('web:')) ?? true) ? permissions.originalRead : true) && (!sources?.networkSearch || permissions.publicSearch);
  useEffect(() => {
    if (permissions?.projectId !== projectId) return;
    if (askResult !== undefined && !canPresent(askResult.sources)) setAskResult(undefined);
    if (!permissions.originalRead || !permissions.publicSearch) { setSourcePath(null); setCitationIndex(null); void queryClient.invalidateQueries({ queryKey: ['knowledge', 'history', projectId] }); }
  }, [permissions?.projectId, permissions?.revision, projectId]);
  const sourceList = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data]);
  const filteredSources = sourceList.filter((source) => (sourceKind === '' || (source.kind ?? 'document') === sourceKind) && `${source.label ?? ''} ${source.path}`.toLowerCase().includes(sourceFilter.trim().toLowerCase()));
  const activeCitation = citationIndex === null ? undefined : askResult?.citations[citationIndex];

  // 默认全选，当前轮次的选择随请求冻结；切换项目时重新初始化。
  useEffect(() => {
    if (projectId === '' || sourcesQuery.data === undefined) return;
    const paths = sourceList.map((source) => source.path);
    if (selectionProject !== projectId) {
      setSelectedSources(new Set(paths));
      setSelectionProject(projectId);
      return;
    }
    setSelectedSources((current) => {
      const available = new Set(paths);
      const next = new Set([...current].filter((path) => available.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [projectId, selectionProject, sourceList, sourcesQuery.data]);

  // 项目切换后、新的来源清单到达前，先清掉旧项目选择，避免把旧来源误当成新项目已选资料。
  useEffect(() => {
    if (projectId === '' || selectionProject === '' || selectionProject === projectId) return;
    setSelectedSources(new Set());
  }, [projectId, selectionProject]);

  // 从「对话记录」页跳转回来时：?project= 选中项目、?source= 直接打开原文、?conversation= 延续同一对话。
  useEffect(() => {
    if (bootstrap.data === undefined) return;
    const locationKey = searchParams.toString();
    if (openedLocation.current === locationKey) return;
    const projectParam = searchParams.get('project');
    const sourceParam = searchParams.get('source');
    const conversationParam = searchParams.get('conversation');
    const requestParam = searchParams.get('requestKey');
    if (projectParam === null && sourceParam === null && conversationParam === null && requestParam === null) return;
    if (askCommand.pending !== undefined && requestParam !== askCommand.pending.input.requestKey) return;
    openedLocation.current = locationKey;
    if (requestParam !== null && projectParam !== null) void askCommand.openRun(requestParam, projectParam).then(() => { if (sourceParam !== null && sourceParam !== '') { setSourcePath(sourceParam); setSourceRequestKey(requestParam); } });
    if (projectParam !== null && bootstrap.data.projects.some((project) => project.id === projectParam)) {
      setSelectedProjectId(projectParam);
    }
    if (sourceParam !== null && sourceParam !== '' && requestParam === null) {
      setSourceRequestKey(undefined);
      setCitationIndex(null);
      setSourcePath(sourceParam);
    }
    if (conversationParam !== null && conversationParam !== '') setConversationId(conversationParam);
  }, [bootstrap.data, searchParams, setSearchParams]);

  const projectName = projects.find((project) => project.id === projectId)?.name ?? '未知项目';
  const conversationLocked = conversationId !== undefined || askCommand.pending !== undefined;
  const allSourcesSelected = sourceList.length > 0 && selectedSources.size === sourceList.length;
  const sourcesMissing = sourcesQuery.data !== undefined && sourceList.length === 0 && !permissions?.publicSearch;
  const sourceBlocked = selectedSources.size === 0 && !permissions?.publicSearch;
  const sourceInventoryLabel = sourcesQuery.isLoading
    ? '正在读取真实资料清单…'
    : sourcesQuery.isError
      ? '资料清单读取失败'
      : sourcesMissing
        ? '项目没有可列出的原资料来源'
        : `已加载 ${String(sourceList.length)} 份资料，已选 ${String(selectedSources.size)} 份`;
  const askReason = (value: string): string | undefined =>
    projectId === ''
      ? '先选择项目'
      : conversationId !== undefined && (conversationQuery.isError || conversationQuery.isPending)
        ? '先读取原对话状态后继续追问。'
      : conversationQuery.data?.actions.followUp.allowed === false
        ? conversationQuery.data.actions.followUp.reason ?? '当前对话不可继续追问'
      : permissionLocked
        ? '许可变更尚未核对，请先核对原许可操作。'
      : sourcesQuery.data?.askAvailability?.allowed === false
        ? sourcesQuery.data.askAvailability.reason ?? '问答暂不可用'
      : value.trim().length < 2
        ? '问题至少 2 个字'
        : askCommand.busy
          ? '正在研究，等待服务返回回答…'
          : askCommand.pending !== undefined
            ? '原问答结果待核对，核对完成后才能再次发送。'
          : sourcesQuery.isLoading || sourcesQuery.isError || sourcesMissing
            ? '先读取可用的资料来源。'
          : sourceBlocked
            ? '至少选择一个资料来源。'
            : undefined;
  const askDisabledReason = askReason(question);

  const conversationStatus: KnowledgeRunStatusValue | undefined =
    askResult !== undefined
      ? askResult.status === 'stopped' ? 'stopped' : 'completed'
      : askCommand.progress !== undefined
        ? askCommand.progress.status
        : askCommand.pending !== undefined
          ? askCommand.pending.status === 'unknown' ? 'unknown' : 'researching'
          : undefined;
  const conversationStreaming = askCommand.pending !== undefined && askResult === undefined && conversationStatus !== undefined && ['researching', 'answering', 'stopping', 'needs_answer'].includes(conversationStatus);
  const conversationQuestion = askResult?.question ?? askCommand.progress?.question ?? askCommand.pending?.input.question ?? question;
  const conversationAnswer = askResult?.answer ?? askCommand.progress?.answer ?? '';
  const conversationCards = askResult === undefined ? runningSourceCards(askCommand.progress) : resultSourceCards(askResult);
  const conversationSteps = askResult?.steps ?? askCommand.progress?.steps;
  const conversationTools = askResult?.toolActivity;
  const canCopyAnswer = !conversationStreaming && conversationAnswer.length > 0;

  const submitQuestion = (value: string) => {
    const text = value.trim();
    if (askReason(text) !== undefined) return;
    setAskResult(undefined);
    setSourcePath(null);
    setCitationIndex(null);
    setCopied(false);
    void askCommand.ask({
      projectId,
      question: text,
      conversationId,
      sourcePaths: [...selectedSources],
      networkSearch: permissions?.publicSearch ?? false,
      ...(!conversationLocked && modelId !== '' ? { modelId } : {}),
    });
  };

  const copyAnswer = () => {
    if (!canCopyAnswer) return;
    void navigator.clipboard.writeText(conversationAnswer).then(() => {
      setCopied(true);
      window.setTimeout(() => { setCopied(false); }, 1_600);
    }).catch(() => { setCopied(false); });
  };

  const regenerate = () => {
    if (askCommand.pending !== undefined) return;
    submitQuestion(conversationQuestion);
  };

  const continueStopped = () => {
    if (askResult === undefined || askResult.requestKey === undefined) return;
    void askCommand.ask({ projectId: askResult.projectId, question: askResult.question, conversationId: askResult.conversationId, sourcePaths: askResult.sources?.selectedPaths, continueFromRequestKey: askResult.requestKey });
  };

  const toggleSource = (path: string) => {
    setSelectedSources((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const closeReader = () => {
    setSourcePath(null);
    setSourceRequestKey(undefined);
    setCitationIndex(null);
  };

  const openSource = (path: string) => {
    setSourcesOpen(false);
    setResearcherOpen(false);
    setCitationIndex(null);
    setSourceRequestKey(undefined);
    setSourcePath(path);
  };

  const openCitation = (index: number) => {
    const citation = askResult?.citations[index];
    if (citation === undefined) return;
    setResearcherOpen(false);
    setCitationIndex(index);
    setSourceRequestKey(askResult?.requestKey);
    setSourcePath(citation.path);
  };

  const moveCitation = (nextIndex: number) => {
    const citation = askResult?.citations[nextIndex];
    if (citation === undefined) return;
    setCitationIndex(nextIndex);
    setSourceRequestKey(askResult?.requestKey);
    setSourcePath(citation.path);
  };

  const startNewConversation = () => {
    if (askCommand.pending !== undefined) return;
    setConversationId(undefined);
    setSearchParams({ project: projectId }, { replace: true });
    setModelId('');
    setAskResult(undefined);
    setQuestion('');
    closeReader();
    setResearcherOpen(false);
  };

  const openHistoryEntry = (entry: KnowledgeHistoryResponse['entries'][number]) => {
    if (askCommand.pending !== undefined) return;
    // Revoked records have no answer/citations; opening them would show an
    // unexplainable blank, so keep the service's unavailable reason visible.
    if (entry.readability === 'forbidden') return;
    setAskResult(entry);
    setConversationId(entry.conversationId);
    if (entry.requestKey) setSearchParams({ project: entry.projectId, conversation: entry.conversationId, requestKey: entry.requestKey }, { replace: true });
    setQuestion(entry.question);
    closeReader();
    setResearcherOpen(false);
  };

  // Design: previous/next wrap around at both ends (1→3, 3→1).
  const citationTotal = askResult?.citations.length ?? 0;
  const citePrev = () => {
    if (citationIndex === null || citationTotal === 0) return;
    moveCitation((citationIndex - 1 + citationTotal) % citationTotal);
  };
  const citeNext = () => {
    if (citationIndex === null || citationTotal === 0) return;
    moveCitation((citationIndex + 1) % citationTotal);
  };

  const reader = sourcePath === null ? null : (
    <CitationBody
      sourcePath={sourcePath}
      citation={activeCitation}
      content={contentQuery.isError ? undefined : contentQuery.data?.content}
      bytes={contentQuery.data?.bytes}
      loading={contentQuery.isLoading}
      error={contentQuery.error}
      onRetry={() => { void contentQuery.refetch(); }}
    />
  );

  return (
    <div className="page wide">
      <PageHeader
        title="知识库"
        lede="从代码、文档和数据库中查找依据，每个结论都能回到原文。问答基于项目文档，引用可回到原文；历史只保存在本机。"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="row" style={{ gap: 6 }} title={conversationLocked ? '已有对话不可更换项目，新建对话后可切换' : '当前问答归属的项目'}>
              <Icon name="folder" size="sm" />
              <select
                className="select"
                style={{ width: 'auto', height: 30 }}
                aria-label="当前项目"
                value={projectId}
                disabled={conversationLocked || projects.length === 0}
                title={conversationLocked ? '已有对话不可更换项目，新建对话后可切换' : undefined}
                onChange={(event) => { setSelectedProjectId(event.target.value); closeReader(); }}
              >
                {projects.length === 0 ? <option value="">没有项目</option> : projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              {conversationLocked ? <Icon name="lock" size="sm" /> : null}
            </span>
            <LinkButton variant="ghost" size="sm" icon="clock" to={`/knowledge/history${projectId === '' ? '' : `?project=${encodeURIComponent(projectId)}`}`}>
              对话记录
            </LinkButton>
            <Button
              variant="secondary"
              size="sm"
              icon="users"
              aria-expanded={researcherOpen}
              aria-haspopup="dialog"
              onClick={() => { closeReader(); setSourcesOpen(false); setResearcherOpen(true); }}
            >
              研究员检查
            </Button>
            <Badge
              tone={sourcesQuery.data?.askAvailability?.allowed === true ? 'ok' : 'idle'}
              icon={sourcesQuery.data?.askAvailability?.allowed === true ? 'check' : 'help'}
            >
              {sourcesQuery.data?.askAvailability?.allowed === true ? '问答可用' : sourcesQuery.data?.askAvailability?.reason ?? '选择项目后检查问答状态'}
            </Badge>
          </div>
        }
      />

      {bootstrap.isError ? (
        <div style={{ marginBottom: 16 }}>
          <ServiceNotice
            error={bootstrap.error}
            onRetry={() => {
              void bootstrap.refetch();
            }}
          />
        </div>
      ) : null}

      <div className={`kb-layout${sourcePath === null || narrow ? '' : ' with-panel'}`}>
        <div className="kb-main">
          <section className="card" style={{ padding: 28 }}>
            <div className="row" style={{ gap: 12 }}>
              <button type="button" className="tile lg" aria-label="查看知识研究员当前工作" aria-haspopup="dialog" aria-expanded={researcherOpen} onClick={() => { closeReader(); setSourcesOpen(false); setResearcherOpen(true); }} style={{ fontSize: 16, fontWeight: 600 }}>研</button>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 500 }}>知识研究员</span>
                  <Badge tone="idle" icon="lock">只读</Badge>
                  {bootstrap.data === undefined ? null : <Badge outline>{String(bootstrap.data.projects.length)} 个项目可归属</Badge>}
                </div>
                <div className="hint" style={{ marginTop: 3 }}>
                  只读当前项目已授权的资料；回答必须结合原文核对。
                </div>
              </div>
            </div>

            <h2 style={{ fontSize: 24, fontWeight: 500, marginTop: 28 }}>关于这个项目，你想了解什么？</h2>
            <p className="lede" style={{ marginTop: 8 }}>
              从代码、文档和数据库中查找依据，每个结论都能回到原文。
            </p>

            <div className="row wrap" style={{ gap: 8, marginTop: 16 }}>
              <Icon name="book" size="sm" />
              <span className="hint">{sourceInventoryLabel} · 代码 {sourceList.filter((source) => source.kind === 'code' && selectedSources.has(source.path)).length} · 文档 {sourceList.filter((source) => (source.kind ?? 'document') === 'document' && selectedSources.has(source.path)).length} · 数据库 {sourceList.filter((source) => source.kind === 'database' && selectedSources.has(source.path)).length} · 网络检索{permissions?.publicSearch ? '已开启' : '关闭'}</span>
              <Button
                variant="ghost"
                size="sm"
                icon="chevDown"
                disabled={projectId === ''}
                disabledReason={projectId === '' ? '先选择项目。' : undefined}
                onClick={() => { setSourcesOpen(true); setResearcherOpen(false); closeReader(); }}
              >
                查看资料清单
              </Button>
              <span className="hint">所选来源随本轮问题提交；下一轮可调整。</span>
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="sr" htmlFor="kb-question">向项目提问</label>
              <textarea
                id="kb-question"
                className="textarea"
                rows={3}
                value={question}
                onChange={(event) => { setQuestion(event.target.value); }}
                placeholder="描述你的问题，或粘贴需要理解的内容…"
                aria-describedby="kb-ask-note"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitQuestion(question);
                  }
                }}
              />
              <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="book"
                  onClick={() => { setSourcesOpen(true); setResearcherOpen(false); closeReader(); }}
                >
                  资料来源
                </Button>
                <label className="hint" htmlFor="kb-model">模型</label><select id="kb-model" className="select" style={{ width: 'auto' }} value={conversationLocked ? 'locked' : modelId} disabled={conversationLocked} title={conversationLocked ? '已有会话不可更换模型；新建对话后可切换' : undefined} onChange={(event) => setModelId(event.target.value)}>{conversationLocked ? <option value="locked">🔒 {askResult?.model ?? askCommand.progress?.model ?? '会话冻结模型'}</option> : <><option value="">服务默认模型</option>{bootstrap.data?.settings.models.filter((model) => model.enabled).map((model) => <option key={model.id} value={model.id}>{model.label} · {model.provider}/{model.model}</option>)}</>}</select>
                <span className="chip" title="仅将勾选来源作为本轮问答资料">
                  <Icon name="book" size="sm" />
                  来源 {sourcesQuery.isLoading ? '读取中' : sourcesQuery.isError ? '读取失败' : `${String(selectedSources.size)} / ${String(sourceList.length)}`}
                </span>
                <span className="spacer" />
                <span className="hint num">{String(question.length)} 字</span>
                <Button
                  variant="primary"
                  size="sm"
                  icon="arrowUp"
                  disabled={askDisabledReason !== undefined}
                  disabledReason={askDisabledReason}
                  onClick={() => { submitQuestion(question); }}
                >
                  {askCommand.busy ? '研究中…' : '发送'}
                </Button>
                {conversationId === undefined ? null : (
                  <Button variant="ghost" size="sm" icon="refresh" onClick={startNewConversation} disabled={askCommand.pending !== undefined} disabledReason="先核对当前问答结果。">
                    新对话
                  </Button>
                )}
              </div>
              <p className="hint" id="kb-ask-note" style={{ marginTop: 8 }}>
                Enter 发送 · Shift Enter 换行。问答使用受管 OpenCode（禁用自由工具），基于本轮冻结的代码、文档、获准数据库样本与已许可公共检索摘要回答；同一对话最近 3 条问答作为上下文，引用可点击回到原文。
              </p>
              <p className="hint" style={{ marginTop: 6 }}>
                只读取本轮选中的资料；较长资料会使用节选，回答后可核对实际读取范围。
                {sourcesMissing ? ' 项目没有找到可读取的资料，请先添加项目资料。' : ''}
              </p>
              {conversationStatus === undefined ? null : (
                <KnowledgeConversationEntry
                  question={conversationQuestion}
                  status={conversationStatus}
                  model={askResult?.model ?? askCommand.progress?.model}
                  generatedAt={askResult?.generatedAt}
                  answer={canPresent(askResult?.sources ?? askCommand.progress?.sources) ? conversationAnswer : ''}
                  streaming={conversationStreaming}
                  citations={askResult?.citations ?? []}
                  steps={conversationSteps}
                  toolActivity={conversationTools}
                  sourceCards={conversationCards}
                  activeCitationIndex={citationIndex}
                  onOpenCitation={openCitation}
                  onResearcher={() => { closeReader(); setSourcesOpen(false); setResearcherOpen(true); }}
                  researcherOpen={researcherOpen}
                  onStop={conversationStreaming ? () => { void askCommand.stop(); } : undefined}
                  stopBusy={askCommand.stopping}
                  stopDisabledReason={askCommand.progress?.stopRequestKey !== undefined ? '停止请求已发送，请先核对原停止请求。' : askCommand.stopState?.status === 'unknown' ? '停止结果待核对，不能重复发送。' : undefined}
                  onCopy={copyAnswer}
                  copied={copied}
                  onRegenerate={askResult === undefined || askResult.status === 'stopped' ? undefined : regenerate}
                  regenerateDisabledReason={askCommand.pending !== undefined ? '先核对当前问答操作。' : undefined}
                  onContinue={askResult?.status === 'stopped' ? continueStopped : undefined}
                  continueDisabledReason={askResult?.continueAvailability?.allowed === false ? askResult.continueAvailability.reason : askCommand.pending !== undefined ? '先核对当前问答结果。' : undefined}
                >
                  {askResult === undefined || askResult.citations.length === 0 ? null : (
                    <div className="kb-cite-list">
                      {askResult.citations.map((citation, index) => (
                        <button
                          key={`${citation.path}:${citation.line}:${String(index)}`}
                          type="button"
                          className="kb-cite-row"
                          aria-current={citationIndex === index}
                          onClick={() => { openCitation(index); }}
                        >
                          <span className="kb-cite-n">{String(index + 1)}</span>
                          <span className="grow" style={{ minWidth: 0 }}>
                            <span className="mono" style={{ display: 'block', fontSize: 12.5, overflowWrap: 'anywhere' }}>
                              {citation.path}:{String(citation.line)}
                            </span>
                            {citation.snippet === undefined ? null : (
                              <span className="hint" style={{ display: 'block', marginTop: 3 }}>{citation.snippet}</span>
                            )}
                          </span>
                          <Icon name="chevRight" size="sm" />
                        </button>
                      ))}
                    </div>
                  )}
                  {askResult === undefined || askResult.citations.length > 0 ? null : (
                    <p className="hint">{askResult.status === 'stopped' ? '回答在生成中停止；引用只覆盖已完成的句子，因此没有可打开的引用。' : '模型没有给出可验证的引用；这条回答不会伪造引用。'}</p>
                  )}
                  {askCommand.progress?.status === 'needs_answer' ? (
                    <div className="row wrap" style={{ gap: 8 }}>
                      <LinkButton variant="primary" size="sm" to="/inbox">去回答研究员问题</LinkButton>
                      <span className="hint">原运行时正在等待你的答复；可以在待处理中心回答或拒答。</span>
                    </div>
                  ) : null}
                </KnowledgeConversationEntry>
              )}

              {askCommand.stopState === undefined ? null : askCommand.stopState.status === 'failed' ? (
                <div className="banner danger" style={{ marginTop: 10 }} role="alert">
                  <Icon name="alert" />
                  <div className="grow">
                    <b>停止未生效</b>
                    <p className="hint">{askCommand.stopState.message ?? '服务确认原停止请求失败。'}</p>
                  </div>
                  <Button variant="secondary" size="sm" icon="stop" disabled={askCommand.stopping} disabledReason={askCommand.stopping ? '正在发送停止请求。' : undefined} onClick={() => { void askCommand.stop(); }}>重新停止</Button>
                </div>
              ) : (
                <div className="banner warn" style={{ marginTop: 10 }} role="status">
                  <Icon name="help" />
                  <div className="grow">
                    <b>停止请求待核对</b>
                    <p className="hint">停止是写操作：结果未知时只按原请求号核对，不会重发。{askCommand.stopState.message === undefined ? '' : `（${askCommand.stopState.message}）`}</p>
                    <code>{askCommand.stopState.requestKey}</code>
                  </div>
                  <Button variant="secondary" size="sm" icon="refresh" disabled={askCommand.stopping} disabledReason={askCommand.stopping ? '正在核对原停止请求。' : undefined} onClick={() => { void askCommand.reconcileStop(); }}>核对停止请求</Button>
                </div>
              )}

              {askCommand.pending !== undefined && !askCommand.busy ? (
                <div className="banner warn" style={{ marginTop: 10 }} role="status">
                  <Icon name="help" />
                  <div className="grow">
                    <b>{askCommand.pending.status === 'accepted' ? '问题已受理，等待结果' : '问答结果待核对'}</b>
                    <p className="hint">原问题与来源选择已保留；核对不会重新发送或调用模型。</p>
                    <code>{askCommand.pending.input.requestKey}</code>
                  </div>
                  <Button variant="secondary" size="sm" icon="refresh" disabled={askCommand.checking} disabledReason="正在核对原操作。" onClick={() => { void askCommand.reconcile(); }}>核对原操作</Button>
                </div>
              ) : null}
              {askCommand.error !== undefined ? (
                <div className={`banner ${askCommand.pending === undefined ? 'danger' : 'warn'}`} style={{ marginTop: 10 }} role="alert">
                  <Icon name={askCommand.pending === undefined ? 'alert' : 'help'} />
                  <div className="grow">
                    <b>{askCommand.pending === undefined ? '问答未完成' : '结果尚未确认'}</b>
                    <br />
                    {askCommand.error}
                  </div>
                </div>
              ) : null}

            </div>

            <div className="section">
              <div className="eyebrow" style={{ marginBottom: 10 }}>可以这样问（选择后直接提问）</div>
              <div className="col" style={{ gap: 8 }}>
                {[
                  '这个项目如何处理任务执行、资料读取和错误恢复？',
                  '任务从创建到交付要经过哪些阶段？',
                  '哪些操作需要单独的读取许可？',
                ].map((text) => (
                  <button
                    key={text}
                    type="button"
                    className="list-row"
                    style={{ border: '1px solid var(--line)', borderRadius: 12 }}
                    onClick={() => {
                      setQuestion(text);
                      if (askReason(text) === undefined) submitQuestion(text);
                    }}
                  >
                    <Icon name="arrowRight" size="sm" />
                    <span className="grow" style={{ textAlign: 'left', fontSize: 13.5 }}>{text}</span>
                    <Badge tone="idle">{askReason(text) === undefined ? '提问' : '填入'}</Badge>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="card" aria-label="问答历史" style={{ marginTop: 16 }}>
            <div className="card-head">
              <span className="tile"><Icon name="archive" /></span>
              <div className="grow">
                <span className="section-title">问答历史</span>
                <div className="hint" style={{ marginTop: 2 }}>只保存在本机；点击可重新查看已保留的问答。</div>
              </div>
              <LinkButton
                variant="ghost"
                size="sm"
                iconAfter="chevRight"
                to={`/knowledge/history${projectId === '' ? '' : `?project=${encodeURIComponent(projectId)}`}`}
              >
                查看全部
              </LinkButton>
              <Badge tone="neutral">本机</Badge>
            </div>
            <div className="card-body">
              {historyQuery.isError ? (
                <div>
                  <ServiceNotice error={historyQuery.error} title="问答历史读取失败" onRetry={() => { void historyQuery.refetch(); }} />
                </div>
              ) : projects.length === 0 ? (
                <p className="hint">还没有项目；问答历史按项目保存在本机。</p>
              ) : historyQuery.data === undefined ? <p className="hint">正在读取历史…</p>
                : historyQuery.data.entries.length === 0 ? <p className="hint">当前项目还没有问答记录。</p>
                  : (
                    <div className="list">
                      {historyQuery.data.entries.map((entry) => {
                        const forbidden = entry.readability === 'forbidden';
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className="list-row"
                            disabled={forbidden}
                            title={forbidden ? entry.unavailableReason ?? '原回答不可读' : undefined}
                            onClick={() => { openHistoryEntry(entry); }}
                          >
                            <span className="tile"><Icon name={forbidden ? 'lock' : 'sparkle'} size="sm" /></span>
                            <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                              <span style={{ display: 'block', fontSize: 13 }}>{entry.question}</span>
                              <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                                {forbidden ? entry.unavailableReason ?? '原资料许可已撤回，回答与引用已隐藏' : `${String(entry.citations.length)} 条引用 · ${new Date(entry.generatedAt).toLocaleString('zh-CN')} · ${entry.model}`}
                              </span>
                            </span>
                            <Icon name={forbidden ? 'lock' : 'chevRight'} size="sm" />
                          </button>
                        );
                      })}
                    </div>
                  )}
            </div>
          </section>
        </div>

        {sourcePath === null || narrow ? null : (
          <aside className="kb-cite-panel" aria-label="引用原文">
            <div className="kb-cite-head">
              <div className="row" style={{ gap: 8 }}>
                <span className="eyebrow grow">
                  引用来源
                  {citationIndex === null || citationTotal === 0 ? '' : ` · ${String(citationIndex + 1)} / ${String(citationTotal)}`}
                </span>
                <IconButton icon="x" label="关闭引用原文" onClick={closeReader} />
              </div>
              <h2 className="mono">{sourcePath}</h2>
              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                {activeCitation === undefined ? <Badge tone="idle">来源预览</Badge> : (
                  <Badge tone="accent" icon="target">第 {String(activeCitation.line)} 行</Badge>
                )}
                <span className="hint">只读；不会修改项目文件。</span>
              </div>
            </div>
            <CitationNav
              index={citationIndex === null ? undefined : citationIndex}
              total={askResult?.citations.length ?? 0}
              onPrev={citePrev}
              onNext={citeNext}
            />
            <div className="kb-cite-body">{reader}</div>
          </aside>
        )}
      </div>

      <Modal
        open={sourcePath !== null && narrow}
        title={sourcePath === null ? '来源正文' : sourcePath}
        onClose={closeReader}
        footer={
          <>
            {citationIndex === null || citationTotal === 0 ? null : (
              <>
                <Button variant="secondary" size="sm" icon="chevLeft" onClick={citePrev}>
                  上一处
                </Button>
                <span className="hint num">{String(citationIndex + 1)} / {String(citationTotal)}</span>
                <Button variant="secondary" size="sm" iconAfter="chevRight" onClick={citeNext}>
                  下一处
                </Button>
              </>
            )}
            <span className="spacer" />
            <Button variant="ghost" onClick={closeReader}>关闭</Button>
          </>
        }
      >
        {reader}
      </Modal>

      <Drawer open={sourcesOpen} title="资料来源" size="sm" onClose={() => { setSourcesOpen(false); }}>
            <section id="kb-sources">
              <div className="row" style={{ gap: 8 }}>
                <Icon name="book" size="sm" />
                <span className="section-title">资料来源</span>
                <Badge tone={sourcesQuery.isError ? 'warn' : allSourcesSelected ? 'ok' : 'idle'} icon={sourcesQuery.isError ? 'alert' : 'check'}>
                  {sourcesQuery.isLoading ? '读取中' : sourcesQuery.isError ? '读取失败' : `已选 ${String(selectedSources.size)} / ${String(sourceList.length)}`}
                </Badge>
              </div>
              <p className="hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
                服务端列出当前可读的代码、文档和获准数据库。数据库使用已有只读驱动读取有界结构/样本；引用回到本轮冻结内容。
              </p>
              {permissions?.projectId === projectId ? <KnowledgePermissions key={projectId} permissions={permissions} onLocked={setPermissionLocked} onChange={(next) => { setPermissions(next); closeReader(); if (!next.originalRead) setSelectedSources(new Set()); if (!next.originalRead || !next.publicSearch) { setAskResult(undefined); queryClient.setQueryData(['knowledge', 'history', projectId], { entries: [] }); } void sourcesQuery.refetch(); void historyQuery.refetch(); }} /> : null}
              <div className="row wrap" style={{ gap: 8, marginTop: 10 }}><input className="input" aria-label="筛选资料来源" placeholder="搜索来源名称或路径" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} /><select className="select" aria-label="来源类型" value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="">全部类型</option><option value="code">代码</option><option value="document">文档</option><option value="database">数据库</option></select></div>
              <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="folder" size="sm" />
                  <b>{projectName}</b>
                  {conversationLocked ? <Icon name="lock" size="sm" /> : null}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="refresh"
                  disabled={projectId === '' || sourcesQuery.isFetching}
                  disabledReason={projectId === '' ? '先选择项目。' : sourcesQuery.isFetching ? '正在读取资料来源…' : undefined}
                  onClick={() => { void sourcesQuery.refetch(); }}
                >
                  {sourcesQuery.isFetching ? '读取中…' : '读取来源'}
                </Button>
                <span className="hint">
                  {conversationLocked ? '当前对话固定项目（页头可查看锁图标）；来源调整在下一轮问答生效。' : '项目在页头选择；来源调整在下一轮问答生效。'}
                </span>
              </div>
              <div className="kb-source-tools">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="check"
                  disabled={sourceList.length === 0 || allSourcesSelected}
                  disabledReason={sourceList.length === 0 ? '没有可选来源。' : '已经全选。'}
                  onClick={() => { setSelectedSources(new Set(sourceList.map((source) => source.path))); }}
                >
                  全选
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="x"
                  disabled={selectedSources.size === 0}
                  disabledReason={selectedSources.size === 0 ? '当前没有已选来源。' : undefined}
                  onClick={() => { setSelectedSources(new Set()); }}
                >
                  全不选
                </Button>
                <span className="hint">请选择资料或独立开启网络检索；未勾选的原资料不会作为本轮输入。</span>
              </div>
              {sourcesQuery.isLoading ? <SkeletonText lines={4} /> : null}
              {sourcesQuery.isError ? (
                <div style={{ marginTop: 10 }}>
                  <ServiceNotice error={sourcesQuery.error} title="资料来源读取失败" onRetry={() => { void sourcesQuery.refetch(); }} />
                </div>
              ) : null}
              {sourceList.length > 0 && filteredSources.length === 0 ? <p className="hint">没有匹配当前名称和类型筛选的来源。</p> : null}
              {sourcesQuery.data === undefined ? null : sourceList.length === 0 ? (
                <p className="hint" style={{ marginTop: 10 }}>当前没有获准原资料。可以核对读取许可、数据库项目授权，或独立开启公共网络检索。</p>
              ) : (
                <div className="list" style={{ marginTop: 10, maxHeight: 280, overflow: 'auto' }}>
                  {filteredSources.map((source) => (
                    <div key={source.path} className="kb-source-row">
                      <input
                        type="checkbox"
                        checked={selectedSources.has(source.path)}
                        onChange={() => { toggleSource(source.path); }}
                        aria-label={`选择来源 ${source.path}`}
                      />
                      <button type="button" className="kb-source-open" onClick={() => { openSource(source.path); }}>
                        <Icon name="doc" size="sm" />
                        <span className="path grow">{source.label ?? source.path}<span className="hint"> · {source.kind === 'code' ? '代码' : source.kind === 'database' ? '数据库' : '文档'}</span></span>
                        <span className="hint">{source.kind === 'database' ? '只读有界样本' : `${Math.max(1, Math.round(source.bytes / 1024))} KB`}</span>
                        <Icon name="chevRight" size="sm" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 180 }}
                  placeholder="在代码/文档中搜索（至少 2 字）"
                  value={searchTerm}
                  onChange={(event) => { setSearchTerm(event.target.value); }}
                  onKeyDown={(event) => { if (event.key === 'Enter') setSubmittedTerm(searchTerm.trim()); }}
                  aria-label="搜索知识来源"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon="search"
                  disabled={projectId === '' || searchTerm.trim().length < 2 || permissions?.originalRead !== true}
                  disabledReason={permissions?.originalRead !== true ? '原资料读取许可关闭或尚未核对。' : projectId === '' ? '先选择项目。' : '搜索至少 2 个字。'}
                  onClick={() => { setSubmittedTerm(searchTerm.trim()); }}
                >
                  搜索
                </Button>
              </div>
              {searchQuery.isError ? (
                <div style={{ marginTop: 8 }}>
                  <ServiceNotice error={searchQuery.error} title="来源搜索失败" onRetry={() => { void searchQuery.refetch(); }} />
                </div>
              ) : null}
              {permissions?.originalRead !== true || searchQuery.isError || searchQuery.data === undefined ? null : searchQuery.data.matches.length === 0 ? (
                <p className="hint" style={{ marginTop: 8 }}>没有匹配的文档行。</p>
              ) : (
                <div className="list" style={{ marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
                  {searchQuery.data.matches.map((match) => (
                    <button
                      key={`${match.path}:${match.line}`}
                      type="button"
                      className="list-row"
                      style={{ alignItems: 'flex-start', textAlign: 'left' }}
                      onClick={() => { openSource(match.path); }}
                    >
                      <span className="tile"><Icon name="search" size="sm" /></span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{match.path}:{match.line}</div>
                        <div className="hint" style={{ marginTop: 3 }}>{match.text}</div>
                      </div>
                      <Icon name="chevRight" size="sm" />
                    </button>
                  ))}
                </div>
              )}
              <p className="hint" style={{ marginTop: 8 }}>
                搜索只读本地文档文本，返回文件与行号；点击结果可回到原文预览。它不是模型问答，也不会生成引用结论。
              </p>
            </section>

      </Drawer>

      <KnowledgeResearcherDrawer
        open={researcherOpen}
        result={askResult}
        progress={askCommand.progress && canPresent(askCommand.progress.sources) ? askCommand.progress : undefined}
        pending={askCommand.pending}
        draft={question}
        projectName={projectName}
        selectedSources={askResult?.sources?.selectedPaths ?? (askCommand.progress && canPresent(askCommand.progress.sources) ? askCommand.progress.sources.selectedPaths : [...selectedSources])}
        onClose={() => { setResearcherOpen(false); }}
        onOpenCitation={openCitation}
      />
    </div>
  );
}
