import { ArchModel } from '../types/model';

export interface HistoryEntry {
  model: ArchModel;
  actionLabel: string;
}

export interface HistoryState {
  past: HistoryEntry[];
  present: ArchModel;
  future: HistoryEntry[];
  lastActionLabel: string;
  /** time of the last push (ms) — live edits whose label ends with "…" coalesce into one step */
  lastPushAt?: number;
}

export const MAX_HISTORY_STEPS = 120; // Exceeds 100 steps requirement

export function cloneModel(model: ArchModel): ArchModel {
  return JSON.parse(JSON.stringify(model)) as ArchModel;
}

export function createHistoryState(initialModel: ArchModel): HistoryState {
  return {
    past: [],
    present: cloneModel(initialModel),
    future: [],
    lastActionLabel: 'Initial State',
  };
}

export function pushHistory(
  state: HistoryState,
  nextModel: ArchModel,
  actionLabel: string
): HistoryState {
  const now = Date.now();
  // Live drags (slider / spinner edits labelled "…") repeated within 2 s are one undo step
  if (actionLabel.endsWith('…') && state.lastActionLabel === actionLabel && state.past.length > 0 && now - (state.lastPushAt ?? 0) < 2000) {
    return { ...state, present: cloneModel(nextModel), future: [], lastPushAt: now };
  }
  const newPast = [
    ...state.past,
    { model: cloneModel(state.present), actionLabel },
  ];
  if (newPast.length > MAX_HISTORY_STEPS) {
    newPast.shift();
  }
  return {
    past: newPast,
    present: cloneModel(nextModel),
    future: [],
    lastActionLabel: actionLabel,
    lastPushAt: now,
  };
}

export function undoHistory(state: HistoryState): {
  nextState: HistoryState;
  undoneLabel: string | null;
} {
  if (state.past.length === 0) {
    return { nextState: state, undoneLabel: null };
  }
  const previous = state.past[state.past.length - 1];
  const newPast = state.past.slice(0, -1);
  const newFuture: HistoryEntry[] = [
    { model: cloneModel(state.present), actionLabel: previous.actionLabel },
    ...state.future,
  ];
  return {
    nextState: {
      past: newPast,
      present: cloneModel(previous.model),
      future: newFuture,
      lastActionLabel: `Undo ${previous.actionLabel}`,
    },
    undoneLabel: previous.actionLabel,
  };
}

export function redoHistory(state: HistoryState): {
  nextState: HistoryState;
  redoneLabel: string | null;
} {
  if (state.future.length === 0) {
    return { nextState: state, redoneLabel: null };
  }
  const next = state.future[0];
  const newFuture = state.future.slice(1);
  const newPast = [
    ...state.past,
    { model: cloneModel(state.present), actionLabel: next.actionLabel },
  ];
  return {
    nextState: {
      past: newPast,
      present: cloneModel(next.model),
      future: newFuture,
      lastActionLabel: `Redo ${next.actionLabel}`,
    },
    redoneLabel: next.actionLabel,
  };
}
