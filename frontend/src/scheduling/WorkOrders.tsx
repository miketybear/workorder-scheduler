import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTimeInput } from '../components/DateTimeInput';
import { CalendarIcon, MaximizeIcon, MinimizeIcon } from '../components/RouteIcon';

import { getAuthSummary, loginUrl, type Session } from '../api/client';
import { RetrievalError, retrieveWorkOrders, type WorkOrder, type WorkOrderFilter } from '../api/workOrders';
import styles from '../App.module.css';
import { DraftEditor, type EditorSelection } from './DraftEditor';
import { continueUpload, deleteDraft, editableFields, getDetail, prepareBatch, lookupUploadRequest, openDraft, reconcileUpload, type Baseline, type Changes, type Detail, type DraftNotice,
  type Scope, type UploadRecoveryEntry, type UploadStatus, type UploadStatusItem, UploadRequestNotFoundError } from '../api/drafts';
import type { FinalizedUpload } from './UploadPreviewPanel';
import { currentMonthRange, startOfDay } from '../api/dates';
import { BatchPlanner } from './BatchPlanner';
import { consolidateDrafts } from './consolidateDrafts';
import { displayDate, rowKey } from './presentation';
import { chosenPlan, effectiveOrder, updatePlans } from './planning';
import type { PlanningMarker } from '../api/workOrders';
import { activeGrant } from '../auth/activeGrant';
import type { PicSuggestion } from '../picSuggestion';
import { config } from '../config';
import { equalField } from './editing';
import { DurationInput, PicSelect, StartInput } from './InlineCells';
import { deriveChanges, hasChanges, problemOf, shown, stage, type Staged, type StagedField } from './inlineEdit';
import { saveInlineEdits, type InlineRow } from './inlineSave';
import { moveBetweenRows } from './tableNav';
import { getRouteStatus, previewRoute, type RouteResultItem, type RouteStatus } from '../api/workflowRoute';
import { RouteAction, type RouteActionKind } from './RouteAction';
import { RoutePanel } from './RoutePanel';
import { ATTENTION_CODES, chipText, mergeFreshRows, routeCategory, routeChips, infoFromLocal, infoFromPreview, localRouteCode, MAX_ROUTE_BATCH, reasonText, routeFingerprint, type RouteInfo } from './routeRules';
import { outsideShift } from './ShiftNotice';
import { usePanelFocus } from './usePanelFocus';

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

export function WorkOrders({ active = true, autoRetrieve = false, picSuggestion = null, onPicSuggestionHandled, headerSlot = null }: { active?: boolean; autoRetrieve?: boolean; picSuggestion?: PicSuggestion | null; onPicSuggestionHandled?: () => void;
  /** Where the loaded range and its change button go in the app header; without it they stay in the toolbar. */
  headerSlot?: HTMLElement | null }) {
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
  const [fullScreen, setFullScreen] = useState(false);
  const [dense, setDense] = useState(() => { try { return localStorage.getItem('workorder-scheduler-density') === 'dense'; } catch { return false; } });
  const toggleDensity = () => {
    const next = !dense; setDense(next);
    try { localStorage.setItem('workorder-scheduler-density', next ? 'dense' : 'comfortable'); } catch { /* preference is optional */ }
  };
  const rangeTitleId = useId();
  const rangeBodyId = useId();
  const [statusFilter, setStatusFilter] = useState('');
  const [chipFilter, setChipFilter] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  // Cell edits typed straight into the table; they become drafts only when the user saves them.
  const [inline, setInline] = useState<Record<string, Staged>>({});
  const [inlineBusy, setInlineBusy] = useState(false);
  const [inlineErrors, setInlineErrors] = useState<Record<string, string>>({});
  const [inlineNotice, setInlineNotice] = useState('');
  const [crew, setCrew] = useState<{ scope: string; pics: string[]; names: Record<string, string> } | null>(null);
  // Route to PIC: server status of the feature, per-row readiness, outcomes of this session, and the open panel.
  const [routeStatus, setRouteStatus] = useState<{ scope: string; status: RouteStatus } | null>(null);
  const [routeInfo, setRouteInfo] = useState<Record<string, RouteInfo>>({});
  const [routeOutcome, setRouteOutcome] = useState<Record<string, RouteResultItem>>({});
  const [routeTargets, setRouteTargets] = useState<WorkOrder[] | null>(null);
  const [routeRecheck, setRouteRecheck] = useState(0);
  // The send panel always opens on the one draft that consolidateDrafts produced or reused.
  const [batch, setBatch] = useState<{ selection: { draftId: string }; notes: string[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  // Changing the date range while WOs still have drafts asks first; this holds the pending change.
  const [rangeChange, setRangeChange] = useState<{ value: string; field: 'start' | 'end' } | { open: true } | null>(null);
  const [rangeBusy, setRangeBusy] = useState(false);
  const [rangeError, setRangeError] = useState('');
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
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [chooser, setChooser] = useState<WorkOrder | null>(null);
  const dirty = useRef(false);
  const draftRevision = useRef(0);
  const knownDrafts = useRef(new Map<string, { version: number; members: string[] }>());
  const finalizationGuard = useRef({ panel: '', connection: '', discipline: '', visible: false });
  const denyRef = useRef<() => void>(() => {});
  const authIdentity = useRef('');
  const principalRef = useRef('');
  const grant = useMemo(() => activeGrant(session), [session]);
  // Planners almost always start from the current month, so prefill it once per page visit.
  const [datesDefaulted, setDatesDefaulted] = useState(false);
  if (grant && !datesDefaulted && !start && !end) {
    const range = currentMonthRange(grant.timezone);
    setDatesDefaulted(true); setStart(range.start); setEnd(range.end);
  }
  const autoRetrievedScope = useRef('');
  const [picPrefill, setPicPrefill] = useState<{ site_id: string; workorder_id: string; pic: string } | null>(null);
  const [editorSeed, setEditorSeed] = useState<{ site_id: string; workorder_id: string; changes: Changes } | null>(null);
  const handledSuggestion = useRef(0);
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
    setRows((previous) => previous && updatePlans(previous, draft));
    // A saved draft now carries these cell edits, so the table stops showing them as unsaved.
    if (draft.items) setInline((previous) => {
      let next = previous;
      for (const item of draft.items ?? []) {
        const key = rowKey(item.item); const staged = previous[key];
        if (!staged) continue;
        const kept = Object.fromEntries(Object.entries(staged).filter(([field, value]) =>
          item.changes[field as StagedField] === undefined || !equalField(field as StagedField, value, item.changes[field as StagedField] ?? null)));
        next = { ...next }; if (Object.keys(kept).length) next[key] = kept; else delete next[key];
      }
      return next;
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
    if (batch && batch.selection.draftId !== result.draft_id) return false;
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
      const apply = (current: WorkOrder[] | null) => current?.map((row) => {
        const fresh = freshByKey.get(rowKey(row));
        const markers = row.drafts ?? [];
        const matching = markers.find((marker) => marker.draft_id === result.draft_id);
        if (matching && matching.version !== result.version) return row;
        const drafts = markers.filter((marker) => !(marker.draft_id === result.draft_id && marker.version === result.version));
        return { ...(fresh ?? row), drafts };
      }) ?? null;
      setRows(apply);
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
  const routeScope = JSON.stringify(editorScope);
  const routeAvailable = grant?.capability === 'write' && routeStatus?.scope === routeScope && routeStatus.status.can_route;
  // What the table already rules out is answered here; the server's answer is used only while the row is unchanged.
  const routeFresh = useCallback((row: WorkOrder): RouteInfo | null => {
    const local = localRouteCode(row);
    if (local) return infoFromLocal(row, local);
    const known = routeInfo[rowKey(row)];
    return known && known.fingerprint === routeFingerprint(row) ? known : null;
  }, [routeInfo]);
  const facetRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    return rows?.map((row) => effectiveOrder(row, choices[rowKey(row)])).filter((row) => (!statusFilter || row.status === statusFilter) &&
      (!query || [row.wonum, row.description, row.location].some((value) => value?.toLocaleLowerCase('vi').includes(query)))) ?? [];
  }, [rows, search, statusFilter, choices]);
  const visibleRows = useMemo(() => facetRows.filter((row) =>
    !chipFilter || (chipFilter === 'no_draft' ? !row.drafts?.length :
      (routeAvailable ? routeCategory(routeOutcome[rowKey(row)], routeFresh(row)) : localRouteCode(row)) === chipFilter)),
  [facetRows, chipFilter, routeAvailable, routeFresh, routeOutcome]);

  // The PIC drop-down needs the crew of the scope; read it once, the first time the pointer or focus reaches the table.
  const crewScope = JSON.stringify(editorScope);
  const crewRequested = useRef('');
  const loadCrew = useCallback(() => {
    const first = rows?.[0];
    if (grant?.capability !== 'write' || !first || crewRequested.current === crewScope) return;
    crewRequested.current = crewScope;
    getDetail({ ...editorScope, site_id: first.siteid, workorder_id: first.workorderid }, new AbortController().signal)
      .then((detail) => setCrew({ scope: crewScope, pics: detail.allowed_pics, names: detail.pic_names ?? {} }))
      .catch(() => { crewRequested.current = ''; });
  }, [rows, grant?.capability, crewScope, editorScope]);
  // Touch screens never hover and a disabled drop-down cannot take focus, so load the crew as soon as rows are shown.
  useEffect(() => {
    if (active && window.matchMedia?.('(hover: none)').matches) loadCrew();
  }, [active, loadCrew]);
  const rawByKey = useMemo(() => new Map((rows ?? []).map((row) => [rowKey(row), row])), [rows]);
  useEffect(() => {
    if (!active || checking || grant?.capability !== 'write' || rows === null) return;
    const controller = new AbortController();
    getRouteStatus(editorScope, controller.signal)
      .then((status) => { if (!controller.signal.aborted) setRouteStatus({ scope: routeScope, status }); })
      .catch(() => { if (!controller.signal.aborted) setRouteStatus(null); });
    return () => controller.abort();
  }, [active, checking, grant?.capability, rows === null, routeScope, editorScope]);  // eslint-disable-line react-hooks/exhaustive-deps
  // After a route the WO has a new status and PIC in Maximo; read just those rows again instead of the whole list.
  function refreshRouted(keys: { site_id: string; workorder_id: string }[]) {
    if (!keys.length) return;
    prepareBatch(editorScope, keys, new AbortController().signal)
      .then((details) => setRows((previous) => previous && mergeFreshRows(previous, details.map((detail) => detail.item))))
      .catch(() => { /* the stale-data notice already invites a full refresh */ });
  }
  const routeInfoRef = useRef(routeInfo);
  useEffect(() => { routeInfoRef.current = routeInfo; });
  // Readiness: rows the table already rules out are answered locally; only the rest are asked, 20 at a time.
  useEffect(() => {
    if (!routeAvailable || !rows) return;
    const controller = new AbortController();
    const ask = rows.filter((row) => !localRouteCode(row) && routeInfoRef.current[rowKey(row)]?.fingerprint !== routeFingerprint(row));
    if (!ask.length) return;
    (async () => {
      for (let start = 0; start < ask.length; start += MAX_ROUTE_BATCH) {
        const chunk = ask.slice(start, start + MAX_ROUTE_BATCH);
        let found: Record<string, RouteInfo>;
        try {
          const preview = await previewRoute(editorScope, chunk.map((row) => ({ site_id: row.siteid, workorder_id: row.workorderid })), controller.signal);
          const byKey = new Map(preview.items.map((item) => [JSON.stringify([item.site_id, item.workorder_id]), item]));
          found = Object.fromEntries(chunk.map((row) => {
            const item = byKey.get(rowKey(row));
            return [rowKey(row), item ? infoFromPreview(row, item) : infoFromLocal(row, 'check_failed')];
          }));
        } catch {
          if (controller.signal.aborted) return;
          found = Object.fromEntries(chunk.map((row) => [rowKey(row), infoFromLocal(row, 'check_failed')]));
        }
        if (controller.signal.aborted) return;
        setRouteInfo((previous) => ({ ...previous, ...found }));
      }
    })();
    return () => controller.abort();
  }, [routeAvailable, rows, routeRecheck, editorScope]);
  const routeAsked = (rows ?? []).filter((row) => !localRouteCode(row));
  const routeProgress = routeAvailable && routeAsked.some((row) => !routeFresh(row))
    ? { done: routeAsked.filter((row) => routeFresh(row)).length, total: routeAsked.length } : null;
  const stagedKeys = Object.keys(inline).filter((key) => rawByKey.has(key));
  const stagedList = stagedKeys.join('|');
  const stagedProblems = useMemo(() => Object.fromEntries(stagedList.split('|').filter(Boolean).flatMap((key) => {
    const raw = rawByKey.get(key);
    if (!raw || !grant) return [];
    const marker = chosenPlan(raw, choices[key]);
    const problem = problemOf(raw, shown(raw, marker && !marker.baseline_changed ? marker.changes : {}, inline[key], grant.timezone).changes, crew?.scope === crewScope ? crew.pics : [inline[key].assignedto ?? '']);
    return problem ? [[key, problem]] : [];
  })), [stagedList, inline, rawByKey, choices, grant, crew, crewScope]);
  function stageCell(key: string, field: StagedField, value: string, current: string | null) {
    setInlineNotice(''); setInline((previous) => stage(previous, key, field, value, current));
  }
  async function saveInline() {
    if (!grant || inlineBusy) return;
    const controller = new AbortController();
    const list: InlineRow[] = stagedKeys.flatMap((key) => { const order = rawByKey.get(key); return order ? [{ order, marker: chosenPlan(order, choices[key]), staged: inline[key] }] : []; });
    setInlineBusy(true); setInlineErrors({}); setInlineNotice(''); setError('');
    try {
      const result = await saveInlineEdits(editorScope, grant.timezone, list, controller.signal);
      result.notices.forEach(onDraftReady);
      setInline((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => result.failed[key])));
      setInlineErrors(result.failed);
      const saved = list.length - Object.keys(result.failed).length;
      if (saved > 0) setInlineNotice(`Đã lưu nháp cho ${saved} WO. Maximo chưa thay đổi.`);
    } catch (cause) {
      if (cause instanceof RetrievalError && [401, 403, 404].includes(cause.status)) onDenied();
      else setError(cause instanceof Error ? cause.message : 'Không lưu được các thay đổi trong bảng.');
    } finally { setInlineBusy(false); }
  }
  function fillDown(field: StagedField, key: string) {
    if (!grant) return;
    const source = rawByKey.get(key); if (!source) return;
    const marker = chosenPlan(source, choices[key]);
    const value = shown(source, marker && !marker.baseline_changed ? marker.changes : {}, inline[key] ?? {}, grant.timezone)[field];
    if (!value) return;
    const visibleKeys = new Set(visibleRows.map(rowKey));
    setInlineNotice(''); setInline((previous) => selectedKeys.filter((target) => target !== key && visibleKeys.has(target) && rawByKey.has(target)).reduce((acc, target) => {
      const order = rawByKey.get(target)!; const plan = chosenPlan(order, choices[target]);
      return stage(acc, target, field, value, shown(order, plan && !plan.baseline_changed ? plan.changes : {}, {}, grant.timezone)[field]);
    }, previous));
  }

  const panelOpen = active && !checking && !!(selection || batch || chooser);
  const workspace = usePanelFocus(panelOpen, chooser ?? selection ?? batch);

  useEffect(() => {
    if (!panelOpen) return;
    const root = document.documentElement;
    root.setAttribute('data-wo-panel-open', '');
    return () => root.removeAttribute('data-wo-panel-open');
  }, [panelOpen]);

  useEffect(() => {
    const root = document.documentElement;
    if (fullScreen && active) root.setAttribute('data-wo-fullscreen', '');
    else root.removeAttribute('data-wo-fullscreen');
    return () => root.removeAttribute('data-wo-fullscreen');
  }, [fullScreen, active]);

  useEffect(() => {
    if (!fullScreen || !active) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || panelOpen || routeTargets || rangeChange ||
          (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]')) ||
          document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      setFullScreen(false);
    };
    document.addEventListener('keydown', exitOnEscape);
    return () => document.removeEventListener('keydown', exitOnEscape);
  }, [fullScreen, active, panelOpen, routeTargets, rangeChange]);

  useEffect(() => { selected.current = selection ? { selection, scope: editorScope } : null; }, [selection, editorScope]);

  const onDenied = useCallback(() => {
    setPmOrigins(new Map());
    setUpdatedAt(null); setStale(false);
    retrieved.current = null; setLoadedRange(null);
    setBatch(null); setSelectedKeys([]);
    setChooser(null); setChoices({}); setRangeChange(null); setSendError('');
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
  function clearResults() {
    setUpdatedAt(null); setStale(false);
    selected.current = null;
    retrieved.current = null; setLoadedRange(null);
    setBatch(null); setSelectedKeys([]); setChipFilter(''); setInline({}); setInlineErrors({}); setInlineNotice('');
    setChoices({}); setChooser(null); setSendError('');
    setRouteStatus(null); setRouteInfo({}); setRouteOutcome({}); setRouteTargets(null);
    setSelection(null); setRechecked(null); dirty.current = false;
    pending.current?.abort();
    pending.current = null;
    setRows(null);
    setSearch(''); setStatusFilter('');
    setBusy(false);
    setError('');
  }
  function applyDate(value: string, field: 'start' | 'end') {
    clearResults();
    if (field === 'start') setStart(value);
    else setEnd(value);
  }
  function changeDate(value: string, field: 'start' | 'end') {
    if (!discard()) return;
    // Drafts live on the server, so dropping the table would leave them unreachable: ask before discarding them.
    if (rows?.some((row) => row.drafts?.length)) { setRangeError(''); setRangeChange({ value, field }); return; }
    applyDate(value, field);
  }
  // Every distinct draft the loaded WOs point at; a group draft counts once.
  function loadedDrafts() {
    const found = new Map<string, number>();
    for (const row of rows ?? []) for (const marker of row.drafts ?? []) found.set(marker.draft_id, Math.max(found.get(marker.draft_id) ?? 0, marker.version));
    return found;
  }
  async function confirmRangeChange() {
    if (!rangeChange || rangeBusy) return;
    setRangeBusy(true); setRangeError('');
    const controller = new AbortController();
    try {
      for (const [draft_id, version] of loadedDrafts()) {
        await deleteDraft({ draft_id, version, state: 'draft' }, controller.signal);
        onDraftReady({ draft_id, version, state: 'draft', items: null });
      }
      if ('open' in rangeChange) setRangeExpanded(true); else applyDate(rangeChange.value, rangeChange.field);
      setRangeChange(null);
    } catch (cause) {
      if (cause instanceof RetrievalError && [401, 403].includes(cause.status)) { setRangeChange(null); onDenied(); }
      else setRangeError(`Chưa xóa được hết nháp: ${cause instanceof Error ? cause.message : 'lỗi không rõ'}. Khoảng ngày chưa đổi.`);
    } finally { setRangeBusy(false); }
  }
  // Gathers every draft of the table into one group (or reuses the one that already is) and opens it for upload.
  async function sendAll() {
    if (!grant || sending || !discard()) return;
    const controller = new AbortController();
    setSending(true); setSendError('');
    try {
      const result = await consolidateDrafts(editorScope, rows ?? [], controller.signal, onDraftReady);
      const notes = [...result.dropped.length ? [`Bỏ khỏi nhóm ${result.dropped.join(', ')} vì thay đổi đã trùng Maximo hoặc PIC không còn hợp lệ.`] : [], ...result.warnings];
      selected.current = null;
      setChooser(null); setSelection(null); setRechecked(null); dirty.current = false;
      setBatch({ selection: { draftId: result.draftId }, notes });
      setEditorGeneration((previous) => previous + 1);
    } catch (cause) {
      if (cause instanceof RetrievalError && [401, 403].includes(cause.status)) onDenied();
      else setSendError(cause instanceof Error ? cause.message : 'Không gom được nháp để gửi.');
    } finally { setSending(false); }
  }
  function closePanel() {
    if (!discard()) return;
    setPicPrefill(null);
    selected.current = null;
    setSelection(null); setBatch(null); setChooser(null); setRechecked(null); dirty.current = false;
  }
  // A selection must never include rows the planner can no longer see, so any filter change clears it.
  function filterChanged() { setSelectedKeys([]); }
  // What the table shows for this row (group draft changes plus unsaved cell edits), handed to the single-WO editor.
  function carryToEditor(row: WorkOrder, plan?: PlanningMarker) {
    const key = rowKey(row); const staged = inline[key];
    const groupChanges = plan?.is_batch && !plan.baseline_changed ? plan.changes : {};
    if (!grant || (!staged && !Object.keys(groupChanges).length)) { setEditorSeed(null); return; }
    const changes = deriveChanges(rawByKey.get(key) ?? row, groupChanges, staged ?? {}, grant.timezone);
    setEditorSeed(hasChanges(changes) ? { site_id: row.siteid, workorder_id: row.workorderid, changes } : null);
  }
  function openPlan(row: WorkOrder, plan: PlanningMarker) {
    if (!discard()) return;
    dirty.current = false;
    setChoices((previous) => ({ ...previous, [rowKey(row)]: plan.draft_id }));
    carryToEditor(row, plan);
    // A group draft has no single-WO editor; its rows are edited in the table and sent together.
    if (plan.is_batch) choose({ key: { ...editorScope, site_id: row.siteid, workorder_id: row.workorderid } });
    else choose({ draftId: plan.draft_id });
  }
  function openRow(row: WorkOrder) {
    if ((row.drafts?.length ?? 0) > 1) {
      if (!discard()) return;
      selected.current = null;
      setSelection(null); setBatch(null); setChooser(row); dirty.current = false;
    } else if (row.drafts?.length) openPlan(row, row.drafts[0]);
    else { carryToEditor(row); choose({ key: { ...editorScope, site_id: row.siteid, workorder_id: row.workorderid } }); }
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
          if (refreshData && identity === authIdentity.current && auth.session && retrieved.current) {
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
  }, [updatedAt]);

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

  async function retrieve() {
    if (!grant || !discard()) return;
    clearResults();
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

  // Load the default month once per account/connection/discipline so the page opens with data.
  // The key is set before the call: later date edits or failures need an explicit Retrieve.
  const retrieveRef = useRef(retrieve);
  useEffect(() => { retrieveRef.current = retrieve; });
  useEffect(() => {
    if (!autoRetrieve || !active || checking || verifying || busy || !grant || !session || rows !== null || !start || !end) return;
    const key = JSON.stringify([session.user.id, grant.connection_id, grant.discipline]);
    if (autoRetrievedScope.current === key) return;
    autoRetrievedScope.current = key;
    void retrieveRef.current();
  }, [autoRetrieve, active, checking, verifying, busy, grant, session, rows, start, end]);

  // A PIC suggestion from the timeline opens that WO's editor with the PIC filled in but unsaved.
  const applySuggestionRef = useRef<(suggestion: PicSuggestion) => void>(() => {});
  useEffect(() => {
    applySuggestionRef.current = (suggestion) => {
      if (!grant || grant.connection_id !== suggestion.connection_id || grant.discipline !== suggestion.discipline) {
        setError('PIC gợi ý thuộc kết nối hoặc discipline khác với phiên hiện tại.'); onPicSuggestionHandled?.(); return;
      }
      if (!discard()) { onPicSuggestionHandled?.(); return; }
      dirty.current = false;
      setPicPrefill({ site_id: suggestion.site_id, workorder_id: suggestion.workorder_id, pic: suggestion.pic });
      const row = rows?.find((candidate) => candidate.siteid === suggestion.site_id && candidate.workorderid === suggestion.workorder_id);
      if (row) openRow(row);
      else choose({ key: { ...editorScope, site_id: suggestion.site_id, workorder_id: suggestion.workorder_id } });
      onPicSuggestionHandled?.();
    };
  });
  useEffect(() => {
    if (!picSuggestion || !active || checking || verifying || !grant || handledSuggestion.current === picSuggestion.id) return;
    handledSuggestion.current = picSuggestion.id;
    applySuggestionRef.current(picSuggestion);
  }, [picSuggestion, active, checking, verifying, grant]);

  const draftedCount = rows?.filter((row) => row.drafts?.length).length ?? 0;
  // The range is loaded up to (not including) target_before, so its last shown day is the one before.
  const rangeControl = grant && rows !== null && loadedRange && !checking && <span className={styles.rangeControl}>
    <span>{displayDate(loadedRange.target_from, grant.timezone, false)} → {displayDate(new Date(Date.parse(loadedRange.target_before) - 1).toISOString(), grant.timezone, false)}</span>
    {!rangeExpanded && <button type="button" className={styles.iconButton} aria-label="Đổi khoảng ngày" title="Đổi khoảng ngày" onClick={() => {
      // Drafts are deleted with the old range, so say so before the date fields even open.
      if (!discard()) return;
      if (draftedCount > 0) { setRangeError(''); setRangeChange({ open: true }); } else setRangeExpanded(true);
    }}><CalendarIcon size={16} /></button>}
  </span>;
  const chipCounts = useMemo(() => {
    const counts = routeChips(facetRows.map((row) =>
    routeAvailable ? routeCategory(routeOutcome[rowKey(row)], routeFresh(row)) : localRouteCode(row))
      .filter((category): category is string => category !== null));
    if (chipFilter && chipFilter !== 'no_draft' && !counts.some(({ category }) => category === chipFilter)) counts.push({ category: chipFilter, count: 0 });
    return counts;
  }, [facetRows, routeAvailable, routeOutcome, routeFresh, chipFilter]);

  return <div ref={workspace} tabIndex={-1} className={fullScreen ? styles.workOrdersFullscreen : undefined}>
    <h1 className={styles.srOnly}>Work Orders</h1>
    {uploadNotice && <p role="status" className={styles.notice}>{uploadNotice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && <button className={styles.tertiary} onClick={() => refreshSession.current?.()}>Kiểm tra lại phiên</button>}
    {checking && <p role="status">Đang kiểm tra quyền truy cập…</p>}
    {verifying && !checking && <p role="status">Đang xác minh phiên…</p>}
    <div className={styles.workOrdersContent} hidden={checking}>{!session ? <p>
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
      {grant && <section className={styles.retrievePanel} aria-label="Lấy dữ liệu WO" hidden={rows !== null && !!loadedRange && !rangeExpanded}>
      <div className={styles.retrieveHeading} hidden={rows !== null && !!loadedRange && !rangeExpanded}>
        <strong>Lấy dữ liệu WO</strong>
      </div>
      <form className={styles.retrieveDates} hidden={rows !== null && !!loadedRange && !rangeExpanded} onSubmit={(event) => { event.preventDefault(); void retrieve(); }}>
        <div className={styles.dateRange}><span>Target Finish từ</span><DateTimeInput dateOnly label="Target Finish từ" value={start}
          onChange={(value) => changeDate(value, 'start')} /></div>
        <div className={styles.dateRange}><span>Target Finish trước</span><DateTimeInput dateOnly label="Target Finish trước" value={end}
          onChange={(value) => changeDate(value, 'end')} /></div>
        <button className={styles.primary} disabled={!grant || busy || !start || !end}>{busy ? 'Đang lấy WO…' : 'Retrieve WO'}</button>
        {rows !== null && loadedRange && <button type="button" className={`${styles.ghost} ${styles.cancelRange}`} onClick={() => setRangeExpanded(false)}>Hủy</button>}
      </form>
      </section>}
      {grant && rows === null && !busy && <p>Chưa Retrieve WO cho khoảng ngày này. Chọn ngày và bấm Retrieve WO để tải bảng.</p>}
      {chooser && grant && <section role="dialog" tabIndex={-1} aria-label="Chọn nháp của WO"
        onKeyDown={(event) => { if (event.key === 'Escape') closePanel(); }} className={`${styles.draftEditor} ${styles.sidePanel}`}>
        <div className={styles.panelHeading}><h2>{chooser.wonum} · chọn nháp</h2><button className={styles.ghost} onClick={closePanel}>Đóng</button></div>
        <p>WO này có nhiều kế hoạch đã lưu. Chọn nháp bạn muốn mở.</p>
        {chooser.drafts?.map((plan) => <p key={plan.draft_id}><button className={styles.ghost} onClick={() => openPlan(chooser, plan)}>
          {plan.is_batch ? 'Nháp nhóm' : 'Nháp'} · sửa lần cuối {displayDate(plan.updated_at, grant.timezone)}
          {plan.baseline_changed ? ' · Cần đối chiếu' : ''}</button></p>)}
        <button className={styles.tertiary} onClick={() => choose({ key: { ...editorScope, site_id: chooser.siteid, workorder_id: chooser.workorderid } })}>Xem Maximo / tạo nháp mới</button>
      </section>}
      {selection && grant && <DraftEditor key={editorGeneration} selection={selection} scope={editorScope} prefill={picPrefill} onPrefillConsumed={() => setPicPrefill(null)}
        seed={editorSeed} onSeedConsumed={() => setEditorSeed(null)}
        timezone={grant.timezone} active={active}
        pmRestoreOrigin={'key' in selection && session?.user.id ? pmOrigins.get(JSON.stringify([session.user.id, editorScope.connection_id,
          editorScope.discipline, selection.key.site_id, selection.key.workorder_id])) ?? null : null}
        connection={{ label: grant.label, system: grant.system, environment: grant.environment }}
        verifiedDetail={rechecked} writable={grant.capability === 'write'} suspended={checking} onDirty={onDirty} onDenied={onDenied}
        onDraftReady={onDraftReady} onUploadFinalized={onUploadFinalized} onUploadRequestCreated={onUploadRequestCreated} onClose={closePanel} />}
      {batch && grant && <BatchPlanner key={editorGeneration} sendOnly sendNotes={batch.notes} selection={batch.selection} scope={editorScope} timezone={grant.timezone} active={active}
        connection={{ label: grant.label, system: grant.system, environment: grant.environment }}
        writable={grant.capability === 'write'} suspended={checking} refreshVersion={batchRefresh} onDirty={onDirty} onDenied={onDenied} onDraftReady={onDraftReady} onUploadFinalized={onUploadFinalized} onUploadRequestCreated={onUploadRequestCreated} onClose={closePanel} />}
      {busy && <p role="status">Đang lấy và kiểm tra đầy đủ các trang dữ liệu…</p>}
      {busy && rows === null && <div className={styles.skeleton} aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((index) => <div key={index} />)}</div>}
      {grant && <div className={styles.woToolbar}>
        {fullScreen && <span className={styles.fullscreenEnvChip} data-env={grant.environment}>
          {grant.system === 'onshore' ? 'Onshore' : 'Offshore'} · {grant.environment === 'test' ? 'TEST' : 'PROD'}
        </span>}
        {rangeControl && (headerSlot && !fullScreen ? createPortal(rangeControl, headerSlot) : <span className={styles.fullscreenRange}>{rangeControl}</span>)}
        {rows !== null && rows.length > 0 && <label className={styles.toolbarStatus}>Status
          <select aria-label="WO Status" value={statusFilter} onChange={(event) => { filterChanged(); setStatusFilter(event.target.value); }}>
            <option value="">Tất cả status đã tải</option>
            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>}
        {rows !== null && rows.length > 0 && !checking && <label className={styles.toolbarSearch}>
          <input type="search" placeholder="Tìm WO, mô tả hoặc Tag Name" aria-label="Tìm WO, mô tả hoặc Tag Name" value={search}
            onChange={(event) => { filterChanged(); setSearch(event.target.value); }} /></label>}
        {updatedAt !== null && rows !== null && <div className={styles.toolbarActions}>
          <button className={styles.tertiary} disabled={busy || verifying || checking} onClick={() => refreshSession.current?.(true)}>Cập nhật</button>
          {rows.length > 0 && <button className={styles.ghost} aria-pressed={dense} onClick={toggleDensity}>{dense ? 'Bảng thoáng' : 'Bảng gọn'}</button>}
          {(search.trim() || statusFilter || chipFilter) && <button className={styles.ghost} onClick={() => {
            filterChanged(); setSearch(''); setStatusFilter(''); setChipFilter('');
          }}>Xóa bộ lọc</button>}
        </div>}
        <button type="button" className={`${styles.iconButton} ${styles.fullscreenToggle}`} aria-pressed={fullScreen}
          aria-label={fullScreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} title={fullScreen ? 'Thoát toàn màn hình (Esc)' : 'Toàn màn hình'}
          onClick={() => setFullScreen((value) => !value)}>{fullScreen ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}</button>
      </div>}
      {rows !== null && <p role="status" className={`${styles.statusLine}${stale ? ` ${styles.statusLineStale}` : ''}`}>
        {stale && <span className={styles.staleNotice}>Dữ liệu có thể đã thay đổi.</span>}
        {rows.length === 0 ? 'Không có WO trong phạm vi và khoảng ngày đã chọn.' : `Hiển thị ${visibleRows.length} / ${rows.length} WO.`}
        {updatedAt !== null && grant && <span className={styles.statusUpdated}>Cập nhật lần cuối: {new Intl.DateTimeFormat('vi-VN', { timeZone: grant.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(updatedAt)}</span>}
      </p>}
      {rows !== null && rows.length > 0 && <>
        <div className={styles.routeChips} role="group" aria-label="Lọc WO đã tải">
          {chipCounts.map(({ category, count }) => <button key={category} type="button" className={styles.routeChip} data-category={category}
            aria-pressed={chipFilter === category} onClick={() => { filterChanged(); setChipFilter(chipFilter === category ? '' : category); }}>
            {chipText(category)} <strong>{count}</strong>
          </button>)}
          <button type="button" className={styles.routeChip} data-category="no_draft" aria-pressed={chipFilter === 'no_draft'}
            onClick={() => { filterChanged(); setChipFilter(chipFilter === 'no_draft' ? '' : 'no_draft'); }}>
            Chưa có nháp <strong>{facetRows.filter((order) => !order.drafts?.length).length}</strong>
          </button>
        </div>
        {routeAvailable && routeProgress && <p className={styles.routeProgress} role="status">{`Đang kiểm tra khả năng route… ${routeProgress.done}/${routeProgress.total}`}</p>}
        {visibleRows.length === 0 && <p>Không có WO khớp bộ lọc bảng. Xóa bộ lọc để xem lại dữ liệu đã tải.</p>}
      </>}
      {grant && visibleRows.length > 0 && grant.capability === 'write' && selectedKeys.length > 0 && <div className={styles.bulkBar} role="region" aria-label="Thao tác với WO đã chọn">
        <span>{selectedKeys.length} WO đã chọn · nhập hoặc chọn giá trị ở một dòng rồi bấm Ctrl+D để điền xuống các dòng đã chọn</span>
        {routeAvailable && (() => {
          const pickable = visibleRows.filter((row) => selectedKeys.includes(rowKey(row)) && !row.drafts?.length && routeFresh(row)?.ready && !routeOutcome[rowKey(row)]);
          return pickable.length > 0 && <button className={styles.primary} disabled={pickable.length > MAX_ROUTE_BATCH}
            onClick={() => setRouteTargets(pickable)}>{pickable.length > MAX_ROUTE_BATCH ? `Chọn tối đa ${MAX_ROUTE_BATCH} WO để route` : `Route ${pickable.length} WO sẵn sàng`}</button>;
        })()}
        <button className={styles.ghost} onClick={() => setSelectedKeys([])}>Bỏ chọn</button>
      </div>}
      {grant?.capability === 'write' && draftedCount > 0 && <div className={styles.bulkBar} role="region" aria-label="Gửi WO có nháp lên Maximo">
        <span>{draftedCount} WO có nháp chưa gửi</span>
        <button className={styles.primary} disabled={busy || sending || inlineBusy || stagedKeys.length > 0} onClick={() => void sendAll()}>{sending ? 'Đang gom nháp…' : `Gửi ${draftedCount} WO lên Maximo`}</button>
        {stagedKeys.length > 0 && <span>Lưu các thay đổi trong bảng trước khi gửi</span>}
        {sendError && <span role="alert" className={styles.error}>{sendError}</span>}
      </div>}
      {grant?.capability === 'write' && (stagedKeys.length > 0 || inlineNotice || Object.keys(inlineErrors).length > 0) && <div className={styles.bulkBar} role="region" aria-label="Thay đổi trong bảng">
        {stagedKeys.length > 0 && <>
          <span>{stagedKeys.length} WO có thay đổi chưa lưu</span>
          <button className={styles.primary} disabled={inlineBusy || Object.keys(stagedProblems).length > 0} onClick={() => void saveInline()}>{inlineBusy ? 'Đang lưu…' : `Lưu ${stagedKeys.length} nháp`}</button>
          <button className={styles.ghost} disabled={inlineBusy} onClick={() => { setInline({}); setInlineErrors({}); }}>Hủy thay đổi</button>
          {Object.keys(stagedProblems).length > 0 && <span role="alert" className={styles.error}>{Object.keys(stagedProblems).length} dòng chưa hợp lệ; xem ghi chú đỏ trên dòng.</span>}
        </>}
        {inlineNotice && <span role="status">{inlineNotice}</span>}
        {Object.keys(inlineErrors).length > 0 && <span role="alert" className={styles.error}>{Object.keys(inlineErrors).length} dòng chưa lưu được; xem ghi chú đỏ trên dòng.</span>}
      </div>}
      {rows !== null && <>
        {visibleRows.length > 0 && grant && <>
          <div className={`${styles.tableWrap} ${styles.compactTable}${dense ? ` ${styles.denseTable}` : ''}`} tabIndex={0} role="region" aria-label="WO từ Maximo" onMouseEnter={loadCrew} onFocusCapture={loadCrew} onKeyDown={(event) => { moveBetweenRows(event); }}>
          <table><thead><tr>{grant.capability === 'write' && <th scope="col"><input type="checkbox" aria-label={`Chọn tất cả ${visibleRows.length} WO trong kết quả lọc đã tải`} checked={!!visibleRows.length && visibleRows.every((row) => selectedKeys.includes(rowKey(row)))} onChange={(e) => setSelectedKeys((previous) => {
            const visibleKeys = new Set(visibleRows.map(rowKey));
            const retained = previous.filter((key) => !visibleKeys.has(key));
            return e.target.checked ? [...retained, ...visibleKeys] : retained;
          })} /></th>}
            <th scope="col">Work Order / Type</th><th scope="col">Công việc / Tag Name</th><th scope="col">Status / Priority</th><th scope="col">Duration (giờ)</th><th scope="col">Lịch dự kiến</th><th scope="col">Target Start / Finish</th><th scope="col">Assigned PIC</th>{routeAvailable && <th scope="col">Action</th>}</tr></thead>
            <tbody>{visibleRows.map((row, index) => {
              const plan = chosenPlan(row, choices[rowKey(row)]);
              const changed = (fields: string[]) => !!plan && !plan.baseline_changed && fields.some((field) => field in plan.changes);
              return <tr key={JSON.stringify([scope, row.siteid, row.workorderid])} data-route={routeAvailable && !row.drafts?.length && routeFresh(row)?.ready && !routeOutcome[rowKey(row)] ? 'ready' : undefined}>
              {grant.capability === 'write' && <td><input type="checkbox" aria-label={`Chọn ${row.wonum} · dòng ${index + 1}`} checked={selectedKeys.includes(rowKey(row))} onChange={(e) => setSelectedKeys((previous) => e.target.checked ? [...previous, rowKey(row)] : previous.filter((key) => key !== rowKey(row)))} /></td>}
              <td data-label="Work Order"><button className={styles.woLink} onClick={() => openRow(row)}>{row.wonum}</button><small>{row.worktype}</small>
                {!!row.drafts?.length && <small className={styles.draftMarker}>{row.drafts.length > 1 ? plan ? `Nháp · ${row.drafts.length} nháp` : `${row.drafts.length} nháp · chọn để mở` :
                  'Nháp'}
                  {plan?.baseline_changed && ' · Cần đối chiếu'}</small>}
              </td>
              <td className={styles.descriptionCell} data-label="Công việc">{row.description ?? '—'}<small>{row.location ?? 'Chưa có Tag Name'}</small></td>
              <td data-label="Status"><span className={styles.statusBadge} data-status={row.status}>{row.status}</span><small>{row.wopriority_description ?? '—'} ({row.wopriority ?? '—'})</small></td>
              {(() => {
                const key = rowKey(row);
                const raw = rawByKey.get(key) ?? row;
                const writable = grant.capability === 'write';
                const editable = writable && (!row.drafts || row.drafts.length <= 1 || !!choices[key]);
                const stagedRow = inline[key] ?? {};
                const marker = chosenPlan(raw, choices[key]);
                const view = shown(raw, marker && !marker.baseline_changed ? marker.changes : {}, stagedRow, grant.timezone);
                const touched = (...fields: StagedField[]) => fields.some((field) => stagedRow[field] !== undefined);
                const problem = stagedProblems[key] ?? inlineErrors[key];
                if (!editable) return <>
                  <td data-label="Duration (giờ)" data-draft={changed(['estdur'])}>{row.estdur ?? '—'}{changed(['estdur']) && <small>Nháp</small>}</td>
                  <td data-label="Lịch dự kiến" data-draft={changed(['schedstart', 'schedfinish'])}>{displayDate(row.schedstart, grant.timezone)}<small>→ {displayDate(row.schedfinish, grant.timezone)}</small>{changed(['schedstart', 'schedfinish']) && <small>Nháp</small>}</td>
                  <td data-label="Target" data-draft={changed(['targstartdate', 'targcompdate'])}>{displayDate(row.targstartdate, grant.timezone, false)}<small>→ {displayDate(row.targcompdate, grant.timezone, false)}</small>{changed(['targstartdate', 'targcompdate']) && <small>Nháp</small>}</td>
                  <td data-label="Assigned PIC" data-draft={changed(['assignedto'])}>{row.assignedto ?? 'Chưa phân công'}{changed(['assignedto']) && <small>Nháp</small>}</td>
                </>;
                const pending = (field: StagedField) => touched(field) ? ' (chưa lưu)' : '';
                const onKey = (field: StagedField) => (event: React.KeyboardEvent) => {
                  if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyD' || event.key.toLowerCase() === 'd')) { event.preventDefault(); fillDown(field, key); }
                };
                return <>
                  <td data-nav="estdur" data-label="Duration (giờ)" data-draft={touched('estdur') || changed(['estdur'])} onKeyDown={onKey('estdur')}>
                    <DurationInput label={`Sửa nhanh ${row.wonum} Est. Duration${pending('estdur')}`} value={stagedRow.estdur ?? view.estdur ?? ''} disabled={inlineBusy}
                      onChange={(hours) => stageCell(key, 'estdur', hours, shown(raw, marker && !marker.baseline_changed ? marker.changes : {}, {}, grant.timezone).estdur)} />
                    {(touched('estdur') || changed(['estdur'])) && <small>Nháp</small>}
                  </td>
                  <td data-nav="schedstart" data-label="Lịch dự kiến" data-draft={touched('schedstart', 'estdur') || changed(['schedstart', 'schedfinish'])} data-invalid={!!problem || undefined} onKeyDown={onKey('schedstart')}>
                    <StartInput label={`Sửa nhanh ${row.wonum} Scheduled Start${pending('schedstart')}`} value={view.schedstart} timezone={grant.timezone} disabled={inlineBusy}
                      onChange={(aware) => stageCell(key, 'schedstart', aware, shown(raw, marker && !marker.baseline_changed ? marker.changes : {}, {}, grant.timezone).schedstart)} />
                    <small>→ {displayDate(view.schedfinish, grant.timezone)}</small>
                    {outsideShift(view.schedstart, grant.timezone) && touched('schedstart') && <small>Giờ bắt đầu ngoài ca 06:30–18:30</small>}
                    {(touched('schedstart', 'estdur') || changed(['schedstart', 'schedfinish'])) && !problem && <small>Nháp</small>}
                    {problem && <small role="alert" className={styles.error}>{problem}</small>}
                  </td>
                  <td data-label="Target" data-draft={changed(['targstartdate', 'targcompdate'])}>{displayDate(row.targstartdate, grant.timezone, false)}<small>→ {displayDate(row.targcompdate, grant.timezone, false)}</small>{changed(['targstartdate', 'targcompdate']) && <small>Nháp</small>}</td>
                  <td data-nav="pic" data-label="Assigned PIC" data-draft={touched('assignedto') || changed(['assignedto'])} onKeyDown={onKey('assignedto')}>
                    <PicSelect label={`Sửa nhanh ${row.wonum} Assigned PIC${pending('assignedto')}`} value={view.assignedto} pics={crew?.scope === crewScope ? crew.pics : []} names={crew?.names ?? {}} disabled={inlineBusy}
                      onChange={(pic) => stageCell(key, 'assignedto', pic, shown(raw, marker && !marker.baseline_changed ? marker.changes : {}, {}, grant.timezone).assignedto)} />
                    {(touched('assignedto') || changed(['assignedto'])) && <small>Nháp</small>}
                  </td>
                </>;
              })()}
              {routeAvailable && (() => {
                const outcome = routeOutcome[rowKey(row)]; const info = routeFresh(row);
                let kind: RouteActionKind; let text: string;
                if (outcome?.state === 'confirmed' || (!outcome && info?.code === 'already_routed')) {
                  kind = 'done'; const who = outcome?.assigned_to ?? info?.assigned_to; text = `Đã route${who ? ` · ${who}` : ''}`;
                } else if (outcome?.state === 'stranded') { kind = 'stranded'; text = 'Mất việc: cần admin Maximo khởi động lại workflow'; }
                else if (outcome?.state === 'unknown') { kind = 'unknown'; text = 'Chưa rõ kết quả: kiểm tra WO trong Maximo hoặc làm mới danh sách'; }
                else if (info?.ready) { kind = 'ready'; text = `Sẵn sàng route${info.assigned_to ? ` đến ${info.assigned_to}` : ''}`; }
                else { kind = info && ATTENTION_CODES.has(info.code) ? 'attention' : 'blocked'; text = info ? reasonText(info.code) : reasonText('checking'); }
                return <td data-label="Action"><RouteAction kind={kind} label={`Route ${row.wonum} đến PIC`} text={text} onRoute={() => setRouteTargets([row])} /></td>;
              })()}
            </tr>; })}</tbody></table></div>
        </>}
      </>}
      {routeTargets && grant && routeStatus && <RoutePanel scope={editorScope} status={routeStatus.status} rows={routeTargets}
        onSession={(session) => setRouteStatus((previous) => previous && { ...previous, status: { ...previous.status, session } })}
        onResult={(items) => {
          setRouteOutcome((previous) => ({ ...previous, ...Object.fromEntries(items.map((item) => [JSON.stringify([item.site_id, item.workorder_id]), item])) }));
          refreshRouted(items.filter((item) => item.state === 'confirmed').map(({ site_id, workorder_id }) => ({ site_id, workorder_id })));
        }}
        onDenied={onDenied}
        onClose={() => { setRouteTargets(null); setRouteInfo((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !routeTargets.some((row) => rowKey(row) === key)))); setRouteRecheck((n) => n + 1); }} />}
      {rangeChange && <div className={styles.confirmOverlay}><section role="alertdialog" aria-modal="true" aria-labelledby={rangeTitleId} aria-describedby={rangeBodyId} className={styles.confirmDialog}
        onKeyDown={(event) => { if (event.key === 'Escape' && !rangeBusy) setRangeChange(null); }}>
        <h2 id={rangeTitleId}>Bạn sẽ mất nháp nếu đổi khoảng ngày</h2>
        <p id={rangeBodyId}>Đổi khoảng ngày sẽ bỏ nháp của {draftedCount} WO chưa upload. Các nháp này bị xóa khỏi hệ thống và không khôi phục được; Maximo giữ nguyên.</p>
        {rangeError && <p role="alert" className={styles.error}>{rangeError}</p>}
        <div className={styles.confirmActions}>
          <button className={styles.ghost} autoFocus disabled={rangeBusy} onClick={() => setRangeChange(null)}>Bỏ thay đổi, giữ nháp</button>
          <button className={styles.danger} disabled={rangeBusy} onClick={() => void confirmRangeChange()}>{rangeBusy ? 'Đang xóa nháp…' : 'Xóa nháp và đổi ngày'}</button>
        </div>
      </section></div>}
    </>}</div>
  </div>;
}
