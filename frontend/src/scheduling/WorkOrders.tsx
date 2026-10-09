import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuthSummary, loginUrl, type Session } from '../api/client';
import { RetrievalError, retrieveWorkOrders, type WorkOrder, type WorkOrderFilter } from '../api/workOrders';
import styles from '../App.module.css';
import { DraftEditor, type EditorSelection } from './DraftEditor';
import { continueUpload, editableFields, getDetail, listPlannedWorkOrders, lookupUploadRequest, openDraft, reconcileUpload, type Baseline, type Detail, type DraftNotice,
  type Scope, type UploadRecoveryEntry, type UploadStatus, type UploadStatusItem, UploadRequestNotFoundError } from '../api/drafts';
import type { FinalizedUpload } from './UploadPreviewPanel';
import { startOfDay } from '../api/dates';
import { BatchPlanner, type BatchSelection } from './BatchPlanner';
import { displayDate, rowKey } from './presentation';
import { chosenPlan, effectiveOrder, updatePlans } from './planning';
import type { PlanningMarker } from '../api/workOrders';
import { activeGrant } from '../auth/activeGrant';
import { config } from '../config';
import { equalField } from './editing';
import { usePanelFocus } from './usePanelFocus';

type Source = 'maximo' | 'drafts';
type SourceSnapshot = {
  rows: WorkOrder[] | null;
  query: WorkOrderFilter | null;
  page: { scope: Scope; offset: number } | null;
  updatedAt: number | null;
  search: string;
  statusFilter: string;
  planningFilter: string;
  draftFilter: string;
  selectedKeys: string[];
  choices: Record<string, string>;
  offset: number;
  nextOffset: number | null;
};

function sameBaseline(left: Baseline, right: Baseline): boolean {
  return left.worktype === right.worktype && editableFields.every((field) =>
    equalField(field, left[field] ?? '', right[field]));
}

export function mergePmOrigin(current: Map<string, Baseline>, principal: string, connectionId: string, discipline: string,
  receipt: Pick<UploadStatusItem, 'site_id' | 'workorder_id' | 'restore_source'>, fresh: Baseline): Map<string, Baseline> {
  const next = new Map(current);
  const key = JSON.stringify([principal, connectionId, discipline, receipt.site_id, receipt.workorder_id]);
  const origin = next.get(key);
  if (origin && sameBaseline(origin, fresh)) next.delete(key);
  else if (!origin && receipt.restore_source?.before.worktype === 'PM') next.set(key, receipt.restore_source.before);
  return next;
}

export function WorkOrders({ active = true }: { active?: boolean }) {
  const sources = useRef<Partial<Record<Source, SourceSnapshot>>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [batchRefresh, setBatchRefresh] = useState(0);
  const markUpdated = useCallback(() => { setUpdatedAt(Date.now()); setStale(false); }, []);
  const scrollPosition = useRef(0);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rangeExpanded, setRangeExpanded] = useState(false);
  const [loadedRange, setLoadedRange] = useState<WorkOrderFilter | null>(null);
  const [rows, setRows] = useState<WorkOrder[] | null>(null);
  const [search, setSearch] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const tableFiltersId = useId();
  const [statusFilter, setStatusFilter] = useState('');
  const [planningFilter, setPlanningFilter] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [batch, setBatch] = useState<BatchSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadNotice, setUploadNotice] = useState('');
  const [uploadRecoveries, setUploadRecoveries] = useState<{ principal_id: string; entry: UploadRecoveryEntry }[]>([]);
  const [recoveryResult, setRecoveryResult] = useState<{ principal_id: string; entry: UploadRecoveryEntry; status: UploadStatus } | null>(null);
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [rechecked, setRechecked] = useState<Detail | null>(null);
  const [pmOrigins, setPmOrigins] = useState(() => new Map<string, Baseline>());
  const selected = useRef<{ selection: EditorSelection; scope: Scope } | null>(null);
  const [draftFilter, setDraftFilter] = useState('');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [chooser, setChooser] = useState<WorkOrder | null>(null);
  const [view, setView] = useState<Source>('maximo');
  const planningPage = useRef<{ scope: Scope; offset: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const dirty = useRef(false);
  const draftRevision = useRef(0);
  const knownDrafts = useRef(new Map<string, { version: number; members: string[] }>());
  const finalizationGuard = useRef({ panel: '', connection: '', discipline: '', visible: false });
  const denyRef = useRef<() => void>(() => {});
  const authIdentity = useRef('');
  const principalRef = useRef('');
  const grant = useMemo(() => activeGrant(session), [session]);
  const editorScope = useMemo(() => ({ connection_id: grant?.connection_id ?? '', discipline: grant?.discipline ?? '' }), [grant]);
  const panelGuardToken = JSON.stringify([selection, batch]);
  useEffect(() => { finalizationGuard.current = { panel: panelGuardToken,
    connection: editorScope.connection_id, discipline: editorScope.discipline, visible: active && !checking }; },
  [panelGuardToken, editorScope, active, checking]);
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const onUploadRequestCreated = useCallback((entry: UploadRecoveryEntry) => {
    const principal = session?.user.id;
    if (!principal) return;
    setUploadRecoveries((previous) => [...previous.filter((record) => record.entry.request_id !== entry.request_id),
      { principal_id: principal, entry }]);
  }, [session]);
  const onDraftReady = useCallback((draft: DraftNotice) => {
    draftRevision.current += 1;
    if (draft.items === null) knownDrafts.current.delete(draft.draft_id);
    else knownDrafts.current.set(draft.draft_id, { version: draft.version,
      members: draft.items.map((item) => JSON.stringify([item.item.siteid, item.item.workorderid])) });
    for (const source of ['maximo', 'drafts'] as const) {
      const snapshot = sources.current[source];
      if (!snapshot) continue;
      const next = snapshot.rows && updatePlans(snapshot.rows, draft);
      snapshot.rows = source === 'drafts' ? next?.filter((row) => row.drafts?.length) ?? null : next;
      snapshot.choices = Object.fromEntries([
        ...Object.entries(snapshot.choices).filter(([, id]) => id !== draft.draft_id),
        ...draft.items?.map((item) => [rowKey(item.item), draft.draft_id]) ?? [],
      ]);
      const keys = new Set(snapshot.rows?.map(rowKey));
      snapshot.selectedKeys = snapshot.selectedKeys.filter((key) => keys.has(key));
    }
    setRows((previous) => {
      const next = previous && updatePlans(previous, draft);
      return planningPage.current ? next?.filter((row) => row.drafts?.length) ?? null : next;
    });
    setChoices((previous) => Object.fromEntries([
      ...Object.entries(previous).filter(([, id]) => id !== draft.draft_id),
      ...draft.items?.map((item) => [rowKey(item.item), draft.draft_id]) ?? [],
    ]));
  }, []);
  const onUploadFinalized = useCallback(async (result: FinalizedUpload): Promise<boolean> => {
    const startedPanel = panelGuardToken;
    const startedConnection = editorScope.connection_id;
    const startedDiscipline = editorScope.discipline;
    const source = knownDrafts.current.get(result.draft_id);
    const stillCurrent = () => finalizationGuard.current.panel === startedPanel &&
      finalizationGuard.current.connection === startedConnection && finalizationGuard.current.discipline === startedDiscipline &&
      finalizationGuard.current.visible &&
      knownDrafts.current.get(result.draft_id)?.version === result.version;
    if (!grant || !result.items.length || (!selection && !batch) || !stillCurrent()) return false;
    const identity = (item: { site_id: string; workorder_id: string }) => JSON.stringify([item.site_id, item.workorder_id]);
    const returned = new Set(result.items.map(identity));
    if (returned.size !== result.items.length || !source || returned.size !== source.members.length ||
        source.members.some((key) => !returned.has(key))) return false;
    if (batch && 'draftId' in batch && batch.draftId !== result.draft_id) return false;
    if (selection && 'draftId' in selection && selection.draftId !== result.draft_id) return false;
    if (selection && 'key' in selection && (returned.size !== 1 || !returned.has(identity(selection.key)))) return false;
    const controller = new AbortController();
    try {
      const details: Detail[] = [];
      for (let start = 0; start < result.items.length; start += 10) {
        details.push(...await Promise.all(result.items.slice(start, start + 10).map(({ site_id, workorder_id }) =>
          getDetail({ connection_id: startedConnection, discipline: startedDiscipline, site_id, workorder_id }, controller.signal))));
        if (!stillCurrent()) { controller.abort(); return false; }
      }
      if (details.length !== result.items.length || details.some((detail) => !result.items.some((item) =>
        item.site_id === detail.item.siteid && item.workorder_id === detail.item.workorderid))) return false;
      if (!stillCurrent()) return false;
      const principal = session?.user.id;
      if (!principal) return false;
      setPmOrigins((current) => {
        const next = new Map(current);
        for (const receipt of result.items) {
          const fresh = details.find((detail) => detail.item.siteid === receipt.site_id && detail.item.workorderid === receipt.workorder_id);
          if (!fresh) continue;
          const merged = mergePmOrigin(next, principal, startedConnection, startedDiscipline, receipt, fresh.baseline);
          next.clear(); merged.forEach((value, key) => next.set(key, value));
        }
        return next;
      });
      const freshByKey = new Map(details.map((detail) => [rowKey(detail.item), detail.item]));
      const apply = (current: WorkOrder[] | null, draftsOnly: boolean) => current?.map((row) => {
        const fresh = freshByKey.get(rowKey(row));
        const markers = row.drafts ?? [];
        const matching = markers.find((marker) => marker.draft_id === result.draft_id);
        if (matching && matching.version !== result.version) return row;
        const drafts = markers.filter((marker) => !(marker.draft_id === result.draft_id && marker.version === result.version));
        return { ...(fresh ?? row), drafts };
      }).filter((row) => !draftsOnly || !!row.drafts?.length) ?? null;
      for (const source of ['maximo', 'drafts'] as const) {
        const snapshot = sources.current[source];
        if (snapshot) snapshot.rows = apply(snapshot.rows, source === 'drafts');
      }
      setRows((current) => apply(current, !!planningPage.current));
      setChoices((current) => Object.fromEntries(Object.entries(current).filter(([, id]) => id !== result.draft_id)));
      setUploadRecoveries((current) => current.filter((record) =>
        !(record.entry.draft_id === result.draft_id && record.entry.version === result.version)));
      setRecoveryResult((current) => current?.entry.draft_id === result.draft_id && current.entry.version === result.version
        ? null : current);
      setUploadNotice(`Đã xác nhận ${details.length} WO trong Maximo và cập nhật giá trị hiện tại.`);
      draftRevision.current += 1;
      setSelection(null); setBatch(null); setRechecked(null); selected.current = null;
      dirty.current = false;
      return true;
    } catch (cause) {
      if (!stillCurrent()) return false;
      if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) { denyRef.current(); return false; }
      setUploadNotice('Maximo đã xác nhận thay đổi, nhưng chưa làm mới được bảng. Kết quả upload vẫn được giữ để thử làm mới lại.');
      return false;
    }
  }, [grant, selection, batch, editorScope, panelGuardToken, session]);
  const pending = useRef<AbortController | null>(null);
  const retrieved = useRef<WorkOrderFilter | null>(null);
  const refreshSession = useRef<((refreshData?: boolean) => void) | null>(null);
  const recoveryScope = JSON.stringify([session?.user.id ?? '', grant?.connection_id ?? '', grant?.discipline ?? '']);
  const recoveryScopeRef = useRef(recoveryScope);
  const previousOriginScope = useRef(recoveryScope);
  useEffect(() => {
    recoveryScopeRef.current = recoveryScope;
    if (previousOriginScope.current !== recoveryScope) setPmOrigins(new Map());
    previousOriginScope.current = recoveryScope;
  }, [recoveryScope]);
  const visibleRecoveries = useMemo(() => uploadRecoveries.filter((record) => record.principal_id === session?.user.id &&
    record.entry.connection_id === grant?.connection_id && record.entry.discipline === grant?.discipline),
  [uploadRecoveries, session, grant]);
  async function applyRecoveryStatus(entry: UploadRecoveryEntry, status: UploadStatus, scopeAtStart: string) {
    if (recoveryScopeRef.current !== scopeAtStart || !session?.user.id) return;
    setRecoveryResult({ principal_id: session.user.id, entry, status }); setRecoveryError('');
    if (status.source_finalized) {
      const details: Detail[] = [];
      for (let start = 0; start < status.items.length; start += 10) {
        details.push(...await Promise.all(status.items.slice(start, start + 10).map((item) =>
          getDetail({ connection_id: entry.connection_id, discipline: entry.discipline, site_id: item.site_id,
            workorder_id: item.workorder_id }, new AbortController().signal))));
        if (recoveryScopeRef.current !== scopeAtStart) return;
      }
      if (details.length !== status.items.length) throw new Error('Không làm mới đủ dữ liệu Maximo sau khi tra cứu upload.');
      setPmOrigins((current) => {
        const next = new Map(current);
        for (const receipt of status.items) {
          const fresh = details.find((detail) => detail.item.siteid === receipt.site_id && detail.item.workorderid === receipt.workorder_id);
          if (!fresh) continue;
          const merged = mergePmOrigin(next, session.user.id, entry.connection_id, entry.discipline, receipt, fresh.baseline);
          next.clear(); merged.forEach((value, key) => next.set(key, value));
        }
        return next;
      });
      onDraftReady({ draft_id: entry.draft_id, version: entry.version, state: 'draft', items: null });
      setUploadRecoveries((current) => current.filter((record) => record.entry.request_id !== entry.request_id));
      setUploadNotice(`Đã xác nhận ${status.items.length} WO trong Maximo. Bấm Cập nhật để làm mới dữ liệu hiện tại.`);
      refreshSession.current?.(true);
    }
  }
  async function recoverUpload(entry: UploadRecoveryEntry, action: 'lookup' | 'continue' | 'reconcile' = 'lookup') {
    if (!grant || recoveryBusy || !active || entry.connection_id !== grant.connection_id || entry.discipline !== grant.discipline ||
        entry.items.length < 1) return;
    const scopeAtStart = recoveryScope;
    const controller = new AbortController(); setRecoveryBusy(true); setRecoveryError('');
    try {
      const saved = { draft_id: entry.draft_id, version: entry.version, state: 'draft' as const };
      const previous = recoveryResult?.entry.request_id === entry.request_id ? recoveryResult.status : null;
      if (action !== 'lookup' && !previous) return;
      const status = action === 'lookup' ? await lookupUploadRequest(entry, controller.signal)
        : action === 'continue' ? await continueUpload(previous!.batch_id, saved, entry.connection_id, entry.items, controller.signal)
          : await reconcileUpload(previous!.batch_id, saved, entry.connection_id, entry.items, controller.signal);
      if (!controller.signal.aborted) await applyRecoveryStatus(entry, status, scopeAtStart);
    } catch (cause) {
      if (!controller.signal.aborted && recoveryScopeRef.current === scopeAtStart) {
        if (cause instanceof UploadRequestNotFoundError) setRecoveryError(cause.message);
        else if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
        else setRecoveryError(cause instanceof Error ? cause.message : 'Không tra cứu được kết quả upload.');
      }
    } finally { if (!controller.signal.aborted) setRecoveryBusy(false); }
  }
  const scope = grant ? JSON.stringify([grant.connection_id, grant.discipline]) : '';
  const statuses = useMemo(() => [...new Set(rows?.map((row) => row.status) ?? [])].sort(), [rows]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    return rows?.map((row) => effectiveOrder(row, choices[rowKey(row)])).filter((row) => (!statusFilter || row.status === statusFilter) &&
      (view === 'drafts' || (draftFilter !== 'yes' || !!row.drafts?.length) && (draftFilter !== 'no' || !row.drafts?.length)) &&
      (planningFilter !== 'schedule' || !row.schedstart || !row.schedfinish) &&
      (planningFilter !== 'pic' || !row.assignedtechname) &&
      (!query || [row.wonum, row.description, row.location].some((value) => value?.toLocaleLowerCase('vi').includes(query)))) ?? [];
  }, [rows, search, statusFilter, planningFilter, draftFilter, choices, view]);

  const panelOpen = active && !checking && !!(selection || batch || chooser);
  const workspace = usePanelFocus(panelOpen, chooser ?? selection ?? batch);

  useEffect(() => {
    if (!panelOpen) return;
    const root = document.documentElement;
    root.setAttribute('data-wo-panel-open', '');
    return () => root.removeAttribute('data-wo-panel-open');
  }, [panelOpen]);

  useEffect(() => { selected.current = selection ? { selection, scope: editorScope } : null; }, [selection, editorScope]);

  const onDenied = useCallback(() => {
    sources.current = {};
    setPmOrigins(new Map());
    setUpdatedAt(null); setStale(false);
    retrieved.current = null; setLoadedRange(null);
    setBatch(null); setSelectedKeys([]);
    planningPage.current = null; setChooser(null); setChoices({});
    selected.current = null;
    pending.current?.abort(); setRows(null); setRechecked(null); setSelection(null);
    dirty.current = false; authIdentity.current = '';
    // A missing draft or revoked WO is not evidence that the login session ended.
    setChecking(true);
    refreshSession.current?.(true);
  }, []);
  useEffect(() => { denyRef.current = onDenied; }, [onDenied]);
  function discard() {
    return !dirty.current || window.confirm('Có thay đổi chưa lưu. Bỏ các thay đổi này?');
  }
  function choose(next: EditorSelection) {
    if (!discard()) return;
    dirty.current = false;
    setBatch(null);
    setChooser(null);
    setRechecked(null);
    selected.current = { selection: next, scope: editorScope };
    setSelection(next);
    setEditorGeneration((previous) => previous + 1);
  }
  function clearResults(clearSources = true) {
    if (clearSources) sources.current = {};
    setUpdatedAt(null); setStale(false);
    selected.current = null;
    retrieved.current = null; setLoadedRange(null);
    setBatch(null); setSelectedKeys([]); setPlanningFilter('');
    planningPage.current = null; setView('maximo'); setOffset(0); setDraftFilter(''); setChoices({}); setChooser(null);
    setSelection(null); setRechecked(null); setNextOffset(null); dirty.current = false;
    pending.current?.abort();
    pending.current = null;
    setRows(null);
    setSearch(''); setStatusFilter('');
    setBusy(false);
    setError('');
  }
  function rememberSource() {
    sources.current[view] = { rows, query: retrieved.current, page: planningPage.current,
      updatedAt, search, statusFilter, planningFilter, draftFilter, selectedKeys, choices, offset, nextOffset };
  }
  function switchSource(source: Source) {
    if (source === view || !discard()) return;
    rememberSource();
    clearResults(false); setView(source);
    const snapshot = sources.current[source];
    if (!snapshot) {
      if (source === 'drafts') void loadDraftPage(0);
      return;
    }
    retrieved.current = snapshot.query; setLoadedRange(snapshot.query); planningPage.current = snapshot.page;
    setRows(snapshot.rows); setUpdatedAt(snapshot.updatedAt);
    setSearch(snapshot.search); setStatusFilter(snapshot.statusFilter); setPlanningFilter(snapshot.planningFilter);
    setDraftFilter(snapshot.draftFilter); setSelectedKeys(snapshot.selectedKeys); setChoices(snapshot.choices);
    setOffset(snapshot.offset); setNextOffset(snapshot.nextOffset);
    if (source === 'drafts' && snapshot.rows === null) void loadDraftPage(snapshot.offset);
  }
  function changeDate(value: string, field: 'start' | 'end') {
    if (!discard()) return;
    delete sources.current.maximo;
    if (view === 'maximo') clearResults(false);
    if (field === 'start') setStart(value);
    else setEnd(value);
  }
  function closePanel() {
    if (!discard()) return;
    selected.current = null;
    setSelection(null); setBatch(null); setChooser(null); setRechecked(null); dirty.current = false;
  }
  function chooseBatch(next: BatchSelection) {
    if (!discard()) return;
    selected.current = null;
    setChooser(null); setSelection(null); setRechecked(null); setBatch(next); dirty.current = false;
    setEditorGeneration((previous) => previous + 1);
  }
  function filterChanged() { setSelectedKeys([]); }
  function openPlan(row: WorkOrder, plan: PlanningMarker) {
    if (!discard()) return;
    dirty.current = false;
    setChoices((previous) => ({ ...previous, [rowKey(row)]: plan.draft_id }));
    if (plan.is_batch) chooseBatch({ draftId: plan.draft_id });
    else choose({ draftId: plan.draft_id });
  }
  function openRow(row: WorkOrder) {
    if ((row.drafts?.length ?? 0) > 1) {
      if (!discard()) return;
      selected.current = null;
      setSelection(null); setBatch(null); setChooser(row); dirty.current = false;
    } else if (row.drafts?.length) openPlan(row, row.drafts[0]);
    else choose({ key: { ...editorScope, site_id: row.siteid, workorder_id: row.workorderid } });
  }
  useEffect(() => {
    if (!active) return;
    let authRequest: AbortController | null = null;
    function refresh(refreshData = false) {
      if (authRequest && !refreshData) return;
      authRequest?.abort();
      setVerifying(true); setError('');
      if (refreshData) setBusy(true);
      authRequest = new AbortController();
      const controller = authRequest;
      const signal = controller.signal;
      let authValidated = false;
      getAuthSummary(signal).then(async (auth) => {
        if (!signal.aborted) {
          authValidated = true;
          const assigned = activeGrant(auth.session);
          const identity = auth.session ? JSON.stringify([auth.session.user.id, auth.session.grants.map((item) =>
            [item.connection_id, item.discipline, item.capability, item.system, item.environment, item.timezone]).sort(), assigned?.connection_id, assigned?.discipline]) : '';
          if (!auth.session || (principalRef.current && principalRef.current !== auth.session.user.id)) {
            setUploadRecoveries([]); setRecoveryResult(null); setRecoveryError('');
          }
          principalRef.current = auth.session?.user.id ?? '';
          if (identity !== authIdentity.current || !auth.session) { clearResults(); }
          else if (refreshData && selected.current) {
            const active = selected.current;
            try {
              const verified = 'key' in active.selection ? await getDetail(active.selection.key, signal)
                : await openDraft(active.selection.draftId, active.scope, signal);
              if (signal.aborted) return;
              if (selected.current === active) setRechecked(verified);
            } catch (cause) {
              if (signal.aborted) return;
              // A closed/replaced panel cannot invalidate the current page.
              if (selected.current === active) {
                if (!(cause instanceof RetrievalError) || cause.status !== 404) throw cause;
                selected.current = null; setSelection(null); setRechecked(null); dirty.current = false;
                setError('WO hoặc nháp không còn tồn tại hoặc không còn trong quyền truy cập. Bảng đã được cập nhật lại.');
              }
            }
          }
          if (refreshData && identity === authIdentity.current && auth.session && planningPage.current) {
            const page = planningPage.current;
            const revision = draftRevision.current;
            const latest = await listPlannedWorkOrders(page.scope, page.offset, signal);
            if (signal.aborted) return;
            if (revision !== draftRevision.current) {
              setStale(true); setError('Nháp đã thay đổi trong lúc tải. Bảng giữ kế hoạch mới nhất; bấm Cập nhật để lấy lại dữ liệu.'); return;
            }
            setRows(latest.items); setNextOffset(latest.next_offset);
            const keys = new Set(latest.items.map(rowKey));
            setSelectedKeys((previous) => previous.filter((key) => keys.has(key)));
            setUpdatedAt(Date.now()); setStale(false); setBatchRefresh((value) => value + 1);
          } else if (refreshData && identity === authIdentity.current && auth.session && retrieved.current) {
            const revision = draftRevision.current;
            const latest = await retrieveWorkOrders(retrieved.current, signal);
            if (signal.aborted) return;
            if (revision !== draftRevision.current) {
              setStale(true); setError('Nháp đã thay đổi trong lúc tải. Bảng giữ kế hoạch mới nhất; bấm Cập nhật để lấy lại dữ liệu.'); return;
            }
            setRows(latest);
            const keys = new Set(latest.map(rowKey));
            setSelectedKeys((previous) => previous.filter((key) => keys.has(key)));
            setUpdatedAt(Date.now()); setStale(false); setBatchRefresh((value) => value + 1);
          }
          const unchanged = !!auth.session && identity === authIdentity.current;
          authIdentity.current = identity;
          setSession((previous) => unchanged ? previous : auth.session);
          setAvailable(auth.available); setChecking(false);
        }
      }).catch((cause: unknown) => { if (!signal.aborted) {
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) {
          onDenied();
        } else {
          // Auth failure hides retained data; a failed explicit data refresh keeps the verified snapshot.
          setChecking(!authValidated);
          setError(authValidated ? 'Không cập nhật được dữ liệu. Bảng và phần đang sửa được giữ nguyên; hãy thử Cập nhật lại.' :
            'Chưa xác minh được quyền và dữ liệu hiện tại. Nội dung sửa đang được giữ ẩn; kiểm tra lại phiên để tiếp tục.');
        }
      } }).finally(() => {
        if (!signal.aborted && authRequest === controller) { authRequest = null; setVerifying(false); if (refreshData) setBusy(false); }
      });
    }
    function visibility() {
      if (!document.hidden) refresh();
    }
    refreshSession.current = refresh;
    refresh();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      refreshSession.current = null;
      authRequest?.abort(); pending.current?.abort();
      setVerifying(false); setBusy(false);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, onDenied]);

  useEffect(() => {
    if (updatedAt === null) return;
    const timer = window.setTimeout(() => setStale(true), Math.max(0, updatedAt + config.workOrderFreshnessMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [updatedAt, view]);

  useEffect(() => {
    if (!active) return;
    if (scrollPosition.current) window.scrollTo(0, scrollPosition.current);
    function rememberScroll() { scrollPosition.current = window.scrollY; }
    window.addEventListener('scroll', rememberScroll, { passive: true });
    return () => window.removeEventListener('scroll', rememberScroll);
  }, [active]);

  useEffect(() => {
    function leaving(event: BeforeUnloadEvent) { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } }
    function navigating(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const destination = new URL(link.href);
      if (destination.origin === window.location.origin && !destination.pathname.startsWith('/api/')) {
        return;
      } else if (!discard()) { event.preventDefault(); event.stopPropagation(); }
    }
    function changingConnection(event: Event) { if (!discard()) event.preventDefault(); }
    window.addEventListener('beforeunload', leaving);
    document.addEventListener('click', navigating, true);
    window.addEventListener('wo-connection-change', changingConnection);
    return () => { window.removeEventListener('beforeunload', leaving); document.removeEventListener('click', navigating, true); window.removeEventListener('wo-connection-change', changingConnection); };
  }, []);

  async function browseDrafts(offset = 0) {
    if (!grant || !discard()) return;
    setSelectedKeys([]);
    await loadDraftPage(offset);
  }

  async function loadDraftPage(offset: number) {
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller;
    setBusy(true); setError('');
    try {
      const result = await listPlannedWorkOrders(editorScope, offset, controller.signal);
      if (!controller.signal.aborted) {
        planningPage.current = { scope: editorScope, offset }; setOffset(offset);
        setRows(result.items); setNextOffset(result.next_offset);
        markUpdated();
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
        setError(cause instanceof Error ? cause.message : 'Không lấy được danh sách nháp.');
      }
    } finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
  }

  async function retrieve() {
    if (!grant || !discard()) return;
    if (view === 'drafts') rememberSource();
    delete sources.current.maximo;
    clearResults(false);
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const filter = { connection_id: grant.connection_id, discipline: grant.discipline,
        target_from: startOfDay(start, grant.timezone), target_before: startOfDay(end, grant.timezone) };
      const items = await retrieveWorkOrders(filter, controller.signal);
      if (!controller.signal.aborted && pending.current === controller) { retrieved.current = filter; setLoadedRange(filter); setRows(items); setRangeExpanded(false); markUpdated(); }
    } catch (cause) {
      if (!controller.signal.aborted && pending.current === controller) {
        setError(cause instanceof Error ? cause.message : 'Không lấy được dữ liệu.');
        if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
      }
    } finally {
      if (!controller.signal.aborted && pending.current === controller) {
        pending.current = null; setBusy(false);
      }
    }
  }

  const activeFilterCount = [!!search.trim(), !!statusFilter, !!planningFilter, view === 'maximo' && !!draftFilter].filter(Boolean).length;
  const pickedRows = visibleRows.filter((row) => selectedKeys.includes(rowKey(row)));
  const firstPickedPlan = pickedRows.length ? chosenPlan(pickedRows[0], choices[rowKey(pickedRows[0])]) : undefined;
  const selectedBatchPlan = firstPickedPlan?.is_batch && pickedRows.every((row) =>
    chosenPlan(row, choices[rowKey(row)])?.draft_id === firstPickedPlan.draft_id) ? firstPickedPlan : undefined;
  const groupActionLabel = selectedBatchPlan ? `Mở nháp nhóm (${selectedKeys.length})`
    : view === 'drafts' ? 'Mở nháp nhóm' : `Lập lịch nhóm (${selectedKeys.length})`;

  return <div ref={workspace} tabIndex={-1}>
    <Link to="/" className={styles.back}>← Tổng quan</Link>
    <div className={styles.pageTitle}><h1>Work Orders</h1></div>
    {uploadNotice && <p role="status" className={styles.notice}>{uploadNotice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && <button className={styles.tertiary} onClick={() => refreshSession.current?.()}>Kiểm tra lại phiên</button>}
    {checking && <p role="status">Đang kiểm tra quyền truy cập…</p>}
    {verifying && !checking && <p role="status">Đang xác minh phiên…</p>}
    <div hidden={checking}>{!session ? <p>
      Cần đăng nhập để xem WO. {available && <a href={loginUrl}>Đăng nhập Microsoft</a>}
    </p> : session.grants.length === 0 ? <p>Chưa được cấp quyền WO. Vui lòng liên hệ quản trị viên.</p> : <>
      {active && !checking && !verifying && visibleRecoveries.map(({ entry }) => <div className={styles.batchToolbar} key={entry.request_id}>
        <span>Kết quả upload cần được kiểm tra cho nháp đã lưu.</span>
        <button className={styles.tertiary} disabled={recoveryBusy} onClick={() => void recoverUpload(entry)}>Kiểm tra kết quả upload trước</button>
      </div>)}
      {recoveryError && <p role="alert" className={styles.error}>{recoveryError}</p>}
      {recoveryResult && recoveryResult.principal_id === session?.user.id && recoveryResult.entry.connection_id === grant?.connection_id && recoveryResult.entry.discipline === grant?.discipline && <section className={styles.editorSection} aria-label="Kết quả upload đã tra cứu">
        <h3>Kết quả upload đã tra cứu</h3>
        <ul>{Object.entries(recoveryResult.status.counts).filter(([, count]) => (count ?? 0) > 0).map(([state, count]) =>
          <li key={state}>{({ pending: 'Chờ xử lý', sending: 'Đang gửi', confirmed: 'Đã xác nhận', failed: 'Thất bại', conflict: 'Xung đột', unknown: 'Chưa xác định' } as Record<string, string>)[state] ?? 'Trạng thái khác'}: {count}</li>)}</ul>
        {recoveryResult.status.source_finalized ? <p role="status">Các thay đổi đã được xác nhận trong Maximo. Bấm Cập nhật để làm mới dữ liệu hiện tại.</p>
          : <p role="status">Kết quả chưa hoàn tất. Kiểm tra trạng thái trước khi tiếp tục.</p>}
        {(recoveryResult.status.counts.pending ?? 0) > 0 && !(recoveryResult.status.counts.sending ?? 0) && !(recoveryResult.status.counts.unknown ?? 0) &&
          <button className={styles.primary} disabled={recoveryBusy} onClick={() => void recoverUpload(recoveryResult.entry, 'continue')}>Tiếp tục gửi tối đa 10 WO</button>}
        {(recoveryResult.status.counts.unknown ?? 0) > 0 && <button className={styles.tertiary} disabled={recoveryBusy} onClick={() => void recoverUpload(recoveryResult.entry, 'reconcile')}>Đối chiếu WO chưa xác định</button>}
        {((recoveryResult.status.counts.pending ?? 0) + (recoveryResult.status.counts.sending ?? 0) + (recoveryResult.status.counts.unknown ?? 0) > 0) &&
          <button className={styles.tertiary} disabled={recoveryBusy} onClick={() => void recoverUpload(recoveryResult.entry)}>Kiểm tra trạng thái</button>}
      </section>}
      {grant && <section className={styles.retrievePanel} aria-label="Lấy dữ liệu WO">
      {view === 'drafts' && <div className={`${styles.retrieveSummary} ${styles.draftSummary}`}>
        <strong>Nháp của tôi</strong>
        <span>Phạm vi {grant.discipline} · không phụ thuộc khoảng ngày Retrieve</span>
      </div>}
      {view === 'maximo' && rows !== null && loadedRange && !rangeExpanded && <div className={styles.retrieveSummary}>
        <span>Đã tải: {displayDate(loadedRange.target_from, grant.timezone, false)} → trước {displayDate(loadedRange.target_before, grant.timezone, false)}</span>
        <button className={styles.tertiary} onClick={() => setRangeExpanded(true)}>Đổi khoảng ngày</button>
      </div>}
      <div className={styles.retrieveHeading} hidden={view === 'drafts' || view === 'maximo' && rows !== null && !!loadedRange && !rangeExpanded}>
        <strong>Lấy dữ liệu WO</strong>
      </div>
      <form className={styles.retrieveDates} hidden={view === 'drafts' || view === 'maximo' && rows !== null && !!loadedRange && !rangeExpanded} onSubmit={(event) => { event.preventDefault(); void retrieve(); }}>
        <label>Target Finish từ<input type="date" required value={start}
          onChange={(event) => changeDate(event.target.value, 'start')} /></label>
        <label>Target Finish trước<input type="date" required value={end}
          onChange={(event) => changeDate(event.target.value, 'end')} /></label>
        <button className={styles.primary} disabled={!grant || busy}>{busy ? 'Đang lấy WO…' : 'Retrieve WO'}</button>
      </form>
      </section>}
      {grant && view === 'maximo' && rows === null && !busy && <p>Chưa Retrieve WO cho khoảng ngày này. Chọn ngày và bấm Retrieve WO để tải bảng.</p>}
      {chooser && grant && <section role="dialog" tabIndex={-1} aria-label="Chọn nháp của WO"
        onKeyDown={(event) => { if (event.key === 'Escape') closePanel(); }} className={`${styles.draftEditor} ${styles.sidePanel}`}>
        <div className={styles.panelHeading}><h2>{chooser.wonum} · chọn nháp</h2><button className={styles.ghost} onClick={closePanel}>Đóng</button></div>
        <p>WO này có nhiều kế hoạch đã lưu. Chọn kế hoạch để mở đúng phiên bản.</p>
        {chooser.drafts?.map((plan) => <p key={plan.draft_id}><button className={styles.ghost} onClick={() => openPlan(chooser, plan)}>
          {plan.is_batch ? 'Nháp nhóm' : 'Nháp'} · v{plan.version} · {displayDate(plan.updated_at, grant.timezone)}
          {plan.baseline_changed ? ' · Cần đối chiếu' : ''}</button></p>)}
        <button className={styles.tertiary} onClick={() => choose({ key: { ...editorScope, site_id: chooser.siteid, workorder_id: chooser.workorderid } })}>Xem Maximo / tạo nháp mới</button>
      </section>}
      {selection && grant && <DraftEditor key={editorGeneration} selection={selection} scope={editorScope}
        timezone={grant.timezone} active={active}
        pmRestoreOrigin={'key' in selection && session?.user.id ? pmOrigins.get(JSON.stringify([session.user.id, editorScope.connection_id,
          editorScope.discipline, selection.key.site_id, selection.key.workorder_id])) ?? null : null}
        connection={{ label: grant.label, system: grant.system, environment: grant.environment }}
        verifiedDetail={rechecked} writable={grant.capability === 'write'} suspended={checking} onDirty={onDirty} onDenied={onDenied}
        onDraftReady={onDraftReady} onUploadFinalized={onUploadFinalized} onUploadRequestCreated={onUploadRequestCreated} onClose={closePanel} />}
      {batch && grant && <BatchPlanner key={editorGeneration} selection={batch} scope={editorScope} timezone={grant.timezone} active={active}
        connection={{ label: grant.label, system: grant.system, environment: grant.environment }}
        writable={grant.capability === 'write'} suspended={checking} refreshVersion={batchRefresh} onDirty={onDirty} onDenied={onDenied} onDraftReady={onDraftReady} onUploadFinalized={onUploadFinalized} onUploadRequestCreated={onUploadRequestCreated} onClose={closePanel} />}
      {busy && <p role="status">Đang lấy và kiểm tra đầy đủ các trang dữ liệu…</p>}
      {grant && rows !== null && updatedAt !== null && <div className={styles.batchToolbar}>
          <span>Cập nhật lần cuối: {new Intl.DateTimeFormat('vi-VN', { timeZone: grant.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(updatedAt)}</span>
          {stale && <span role="status">Dữ liệu có thể đã thay đổi.</span>}
          <button className={styles.tertiary} disabled={busy || verifying || checking} onClick={() => refreshSession.current?.(true)}>Cập nhật</button>
          {!checking && rows.length > 0 && <button className={styles.tertiary}
            aria-expanded={filtersVisible} aria-controls={tableFiltersId} onClick={() => setFiltersVisible((previous) => !previous)}>
            {filtersVisible ? 'Ẩn bộ lọc' : 'Hiện bộ lọc'}
            {activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>}
      </div>}
      {rows !== null && rows.length === 0 && <p role="status">{view === 'drafts' ? 'Không có WO có nháp khả dụng trong trang này.' : 'Không có WO trong phạm vi và khoảng ngày đã chọn.'}</p>}
      {rows !== null && rows.length > 0 && <div id={tableFiltersId} hidden={!filtersVisible} className={`${styles.filters} ${styles.tableFilters}`} role="search" aria-label="Lọc WO đã tải">
            <label>Tìm WO, mô tả hoặc Tag Name<input type="search" value={search}
              onChange={(event) => { filterChanged(); setSearch(event.target.value); }} /></label>
            <label>Status<select value={statusFilter} onChange={(event) => { filterChanged(); setStatusFilter(event.target.value); }}>
              <option value="">Tất cả status đã tải</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select></label>
            <label>Lập lịch<select value={planningFilter} onChange={(e) => { filterChanged(); setPlanningFilter(e.target.value); }}><option value="">Tất cả WO</option><option value="schedule">Chưa lập lịch đầy đủ</option><option value="pic">Chưa có Assigned PIC</option></select></label>
            {view === 'drafts' ? <span className={styles.filterPlaceholder} aria-hidden="true" /> : <label>Nháp<select aria-label="Nháp" value={draftFilter} onChange={(e) => { filterChanged(); setDraftFilter(e.target.value); }}>
              <option value="">Tất cả ({rows.length})</option><option value="yes">Có nháp ({rows.filter((row) => row.drafts?.length).length})</option>
              <option value="no">Chưa có nháp ({rows.filter((row) => !row.drafts?.length).length})</option></select></label>}
            <button className={styles.ghost} disabled={!search && !statusFilter && !planningFilter && (view === 'drafts' || !draftFilter)} onClick={() => { filterChanged(); setSearch(''); setStatusFilter(''); setPlanningFilter(''); if (view === 'maximo') setDraftFilter(''); }}>Xóa bộ lọc bảng</button>
      </div>}
      {rows !== null && <>
        {rows.length > 0 && <>
          <div className={view === 'drafts' ? styles.draftCountRow : undefined}>
          <p role="status">{view === 'drafts' ? `Hiển thị ${visibleRows.length} / ${rows.length} WO · trang ${offset / 20 + 1}.` : `Hiển thị ${visibleRows.length} / ${rows.length} WO. Bộ lọc chỉ áp dụng cho dữ liệu đã tải.`}</p>
          {view === 'drafts' && (offset > 0 || nextOffset !== null) && <div className={styles.draftPagination} aria-label="Phân trang nháp">
            <button className={styles.tertiary} disabled={busy || offset === 0} onClick={() => void browseDrafts(Math.max(0, offset - 20))}>Trang trước</button>
            <button className={styles.tertiary} disabled={busy || nextOffset === null} onClick={() => void browseDrafts(nextOffset ?? 0)}>Trang tiếp</button>
          </div>}
          </div>
          {visibleRows.length === 0 && <p>Không có WO khớp bộ lọc bảng. Xóa bộ lọc để xem lại dữ liệu đã tải.</p>}
        </>}
        {view === 'drafts' && rows.length === 0 && <div className={styles.draftCountRow}>
          <p role="status">Trang {offset / 20 + 1} · 0 WO.</p>
          {(offset > 0 || nextOffset !== null) && <div className={styles.draftPagination} aria-label="Phân trang nháp">
            <button className={styles.tertiary} disabled={busy || offset === 0} onClick={() => void browseDrafts(Math.max(0, offset - 20))}>Trang trước</button>
            <button className={styles.tertiary} disabled={busy || nextOffset === null} onClick={() => void browseDrafts(nextOffset ?? 0)}>Trang tiếp</button>
          </div>}
        </div>}
      </>}
      {grant && <div className={styles.batchToolbar}>
            {visibleRows.length > 0 && grant.capability === 'write' && <span>{selectedKeys.length} WO đã chọn · đổi bộ lọc sẽ bỏ chọn</span>}
            <div className={styles.batchActions}>
            {visibleRows.length > 0 && grant.capability === 'write' &&
              <button className={styles.primary} disabled={!selectedKeys.length || busy || view === 'drafts' && !selectedBatchPlan} title={view === 'drafts' && selectedKeys.length > 0 && !selectedBatchPlan ? 'Chọn các WO thuộc cùng một nháp nhóm để mở nhóm; nháp đơn mở bằng cách bấm WO.' : undefined} onClick={() => {
                if (selectedBatchPlan && pickedRows.length) { openPlan(pickedRows[0], selectedBatchPlan); return; }
                if (view === 'drafts') return;
                const planned = pickedRows.filter((row) => row.drafts?.length);
                if (planned.length) {
                  setError('Có WO đã có nháp. Bấm WO để mở kế hoạch đã lưu, hoặc lọc Chưa có nháp để lập lịch nhóm mới.'); return;
                }
                const keys = pickedRows.map((row) => ({ site_id: row.siteid, workorder_id: row.workorderid }));
                if (keys.length > 200) { setError('Chọn tối đa 200 WO cho một nháp nhóm.'); return; }
                chooseBatch({ keys });
              }}>{groupActionLabel}</button>}
              <button className={styles.ghost} disabled={busy} onClick={() => switchSource(view === 'maximo' ? 'drafts' : 'maximo')}>
                {view === 'maximo' ? 'Nháp của tôi' : 'Quay lại WO đã tải'}
              </button>
            </div>
            {view === 'drafts' && selectedKeys.length > 0 && !selectedBatchPlan && <span className={styles.muted}>Chọn WO thuộc cùng một nháp nhóm hoặc mở nháp đơn bằng cách bấm WO.</span>}
      </div>}
      {rows !== null && <>
        {visibleRows.length > 0 && grant && <>
          <div className={`${styles.tableWrap} ${styles.compactTable}`} tabIndex={0} role="region" aria-label="WO từ Maximo">
          <table><thead><tr>{grant.capability === 'write' && <th scope="col"><input type="checkbox" aria-label={`Chọn tất cả ${visibleRows.length} WO trong kết quả lọc đã tải`} checked={!!visibleRows.length && visibleRows.every((row) => selectedKeys.includes(rowKey(row)))} onChange={(e) => setSelectedKeys(e.target.checked ? visibleRows.map(rowKey) : [])} /></th>}
            <th scope="col">Work Order / Type</th><th scope="col">Công việc / Tag Name</th><th scope="col">Status / Priority</th><th scope="col">Lịch dự kiến</th><th scope="col">Target Start / Finish</th><th scope="col">Assigned PIC</th><th scope="col">Duration (giờ)</th></tr></thead>
            <tbody>{visibleRows.map((row, index) => {
              const plan = chosenPlan(row, choices[rowKey(row)]);
              const changed = (fields: string[]) => !!plan && !plan.baseline_changed && fields.some((field) => field in plan.changes);
              return <tr key={JSON.stringify([scope, row.siteid, row.workorderid])}>
              {grant.capability === 'write' && <td><input type="checkbox" aria-label={`Chọn ${row.wonum} · dòng ${index + 1}`} checked={selectedKeys.includes(rowKey(row))} onChange={(e) => setSelectedKeys((previous) => e.target.checked ? [...previous, rowKey(row)] : previous.filter((key) => key !== rowKey(row)))} /></td>}
              <td><button className={styles.woLink} onClick={() => openRow(row)}>{row.wonum}</button><small>{row.worktype}</small>
                {!!row.drafts?.length && <small className={styles.draftMarker}>{row.drafts.length > 1 ? plan ? `${plan.is_batch ? 'Nháp nhóm' : 'Nháp'} · v${plan.version} · ${row.drafts.length} nháp` : `${row.drafts.length} nháp · chọn để mở` :
                  `${row.drafts[0].is_batch ? 'Nháp nhóm' : 'Nháp'} · v${row.drafts[0].version}`}
                  {plan?.baseline_changed && ' · Cần đối chiếu'}</small>}</td>
              <td className={styles.descriptionCell}>{row.description ?? '—'}<small>{row.location ?? 'Chưa có Tag Name'}</small></td>
              <td><span className={styles.statusBadge} data-status={row.status}>{row.status}</span><small>{row.wopriority_description ?? '—'} ({row.wopriority ?? '—'})</small></td>
              <td data-draft={changed(['schedstart', 'schedfinish'])}>{displayDate(row.schedstart, grant.timezone)}<small>→ {displayDate(row.schedfinish, grant.timezone)}</small>{changed(['schedstart', 'schedfinish']) && <small>Nháp</small>}</td>
              <td data-draft={changed(['targstartdate', 'targcompdate'])}>{displayDate(row.targstartdate, grant.timezone, false)}<small>→ {displayDate(row.targcompdate, grant.timezone, false)}</small>{changed(['targstartdate', 'targcompdate']) && <small>Nháp</small>}</td>
              <td data-draft={changed(['assignedtechname'])}>{row.assignedtechname ?? 'Chưa phân công'}{changed(['assignedtechname']) && <small>Nháp</small>}</td>
              <td data-draft={changed(['estdur'])}>{row.estdur ?? '—'}{changed(['estdur']) && <small>Nháp</small>}</td>
            </tr>; })}</tbody></table></div>
        </>}
      </>}
    </>}</div>
  </div>;
}
