import { ScheduleCell } from './ScheduleCell';
import { STRUCTURAL_DISCLAIMER } from '../engine/structure';
import React, { useState } from 'react';
import {
  Download,
  DoorOpen,
  Grid,
  Home,
  ArrowUpRight,
  CheckCircle2,
} from 'lucide-react';
import {
  ArchEntity,
  ArchModel,
  DoorSwing,
} from '../types/model';
import {
  exportScheduleToCSV,
  getDoorScheduleRows,
  getRoomScheduleRows,
  getWindowScheduleRows,
  scaleRoomToTargetArea,
  getScheduleTable,
  ScheduleKind,
} from '../engine/documentation';
import {
  createStarterLevels,
  formatArea,
  formatLength,
  parseLengthInput,
  syncHostedBimEntities,
} from '../engine/geometry';

import {
  getAllElementCategories,
  getElementCategory,
  ScheduleColumnDef,
} from '../engine/elementRegistry';

/** Tooltip / error text describing accepted length input for the project's units. */
const LENGTH_HINT = (units: 'imperial' | 'metric') =>
  units === 'metric' ? 'Enter a length in mm, e.g. 900' : `Enter a length, e.g. 3'-0" or 36"`;

interface SchedulesViewProps {
  model: ArchModel;
  onUpdateModel: (nextModel: ArchModel, actionLabel: string) => void;
  onLocateEntity: (entityId: string, levelId?: string) => void;
  onLog: (text: string, kind?: 'input' | 'info' | 'error' | 'result') => void;
  darkMode: boolean;
}

const STRUCT_TABS: Array<{ key: ScheduleKind; label: string }> = [
  { key: 'footings', label: 'Footing' },
  { key: 'columns', label: 'Column' },
  { key: 'beams', label: 'Beam' },
  { key: 'rebar', label: 'Rebar' },
];

export const SchedulesView: React.FC<SchedulesViewProps> = ({
  model,
  onUpdateModel,
  onLocateEntity,
  onLog,
  darkMode,
}) => {
  const [activeTab, setActiveTab] = useState<string>('rooms');
  const [exportedBanner, setExportedBanner] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const units = model.settings.units;
  const levels = model.levels ?? createStarterLevels();
  const doorTypes = model.doorTypes ?? [];
  const windowTypes = model.windowTypes ?? [];

  const doorRows = getDoorScheduleRows(model);
  const windowRows = getWindowScheduleRows(model);
  const roomRows = getRoomScheduleRows(model);

  const registeredCategories = getAllElementCategories();

  const updateEntityAndTags = (
    entityId: string,
    updater: (ent: ArchEntity) => ArchEntity,
    newTagNumber?: string,
    newTagLabel?: string,
    actionLabel = 'Edit Schedule Cell'
  ) => {
    const nextEntities = model.entities.map((ent) => {
      if (ent.id === entityId) {
        return updater(ent);
      }
      if (ent.type === 'tag' && ent.targetId === entityId) {
        return {
          ...ent,
          tagNumber: newTagNumber !== undefined ? newTagNumber : ent.tagNumber,
          label: newTagLabel !== undefined ? newTagLabel : ent.label,
        };
      }
      return ent;
    });
    const synced = syncHostedBimEntities(nextEntities);
    onUpdateModel({ ...model, entities: synced }, actionLabel);
  };

  const handleDownloadCSV = (tabKey: string) => {
    let csv = '';
    const safeProj =
      model.projectName.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() ||
      'archiforma';
    const filename = `${safeProj}_${tabKey}_schedule.csv`;

    if (tabKey === 'doors' || tabKey === 'windows' || tabKey === 'rooms' || STRUCT_TABS.some((t) => t.key === tabKey)) {
      csv = exportScheduleToCSV(model, tabKey as ScheduleKind);
    } else {
      const cat = getElementCategory(tabKey);
      if (cat) {
        const matchingEntities = model.entities.filter(
          (e) =>
            e.type === cat.categoryId ||
            (e.type === 'custom' && (e as any).customCategory === cat.categoryId)
        );
        const headers = cat.scheduleColumns.map((c) => `"${c.header}"`).join(',');
        const rows = matchingEntities.map((ent) =>
          cat.scheduleColumns
            .map((c) => `"${String(c.getValue(ent, model)).replace(/"/g, '""')}"`)
            .join(',')
        );
        csv = [headers, ...rows].join('\r\n');
      }
    }

    // UTF-8 BOM so Excel shows ², ×, Ø etc. correctly
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportedBanner(`Exported ${filename}`);
    setTimeout(() => setExportedBanner(null), 2400);
    onLog(`Exported ${tabKey.toUpperCase()} schedule as CSV (${filename}).`, 'result');
  };

  const totalRoomAreaSqIn = roomRows.reduce((acc, r) => acc + r.areaSqIn, 0);
  const totalRoomPerimeterIn = roomRows.reduce((acc, r) => acc + r.perimeterIn, 0);

  return (
    <div
      className={`flex-1 h-full flex flex-col overflow-hidden select-none ${
        darkMode ? 'bg-stone-950 text-stone-100' : 'bg-stone-50 text-stone-900'
      }`}
    >
      {/* Top Sub-Header */}
      <div
        className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 shrink-0 ${
          darkMode
            ? 'bg-stone-900/90 border-stone-800'
            : 'bg-white border-stone-200'
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">
              BIM Quantification
            </span>
            <h1 className="text-base font-bold tracking-tight">
              Interactive Project Schedules
            </h1>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            Bi-directional BIM tables — editing any cell immediately updates the 2D plan &amp; 3D model with full Undo support.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {exportedBanner && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{exportedBanner}</span>
            </div>
          )}

          {/* Schedule Category Switcher */}
          <div
            className={`flex items-center p-1 rounded-lg border ${
              darkMode
                ? 'bg-stone-950 border-stone-800'
                : 'bg-stone-100 border-stone-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveTab('rooms')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'rooms'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : darkMode
                  ? 'text-stone-400 hover:text-stone-100'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span>Room Schedule ({roomRows.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('doors')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'doors'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : darkMode
                  ? 'text-stone-400 hover:text-stone-100'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <DoorOpen className="w-3.5 h-3.5" />
              <span>Door Schedule ({doorRows.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('windows')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'windows'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : darkMode
                  ? 'text-stone-400 hover:text-stone-100'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Window Schedule ({windowRows.length})</span>
            </button>
            {STRUCT_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                aria-label={`${t.label} Schedule`}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  activeTab === t.key ? 'bg-blue-700 text-white shadow-xs' : darkMode ? 'text-stone-400 hover:text-stone-100' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <span>
                  {t.label} ({getScheduleTable(model, t.key).rows.filter((r) => r[0] !== '').length})
                </span>
              </button>
            ))}

            {registeredCategories
              .filter((c) => c.categoryId !== 'window')
              .map((cat) => {
                const count = model.entities.filter(
                  (e) =>
                    e.type === cat.categoryId ||
                    (e.type === 'custom' &&
                      (e as any).customCategory === cat.categoryId)
                ).length;
                return (
                  <button
                    key={cat.categoryId}
                    type="button"
                    onClick={() => setActiveTab(cat.categoryId)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeTab === cat.categoryId
                        ? 'bg-amber-600 text-white shadow-xs'
                        : darkMode
                        ? 'text-stone-400 hover:text-stone-100'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    <span>{cat.displayName} ({count})</span>
                  </button>
                );
              })}
          </div>

          <button
            type="button"
            onClick={() => handleDownloadCSV(activeTab)}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Schedule Table Content */}
      <div className="flex-1 overflow-auto p-6">
        {STRUCT_TABS.some((t) => t.key === activeTab) &&
          (() => {
            const table = getScheduleTable(model, activeTab as ScheduleKind);
            return (
              <div className={`rounded-xl border overflow-hidden ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
                <div className={`px-4 py-2.5 text-sm font-bold flex items-center justify-between ${darkMode ? 'bg-stone-900' : 'bg-blue-50 text-blue-900'}`}>
                  <span>{table.title}</span>
                  <span className="text-[11px] font-normal text-stone-500">Live from the model · updates when hosts or bars change</span>
                </div>
                <table className="w-full text-xs" aria-label={table.title}>
                  <thead>
                    <tr className={darkMode ? 'bg-stone-900 text-stone-300' : 'bg-stone-50 text-stone-600'}>
                      {table.headers.map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold border-b border-stone-200 dark:border-stone-800">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.length === 0 && (
                      <tr>
                        <td colSpan={table.headers.length} className="px-3 py-6 text-center text-stone-500">
                          No items yet — use the Structure tools (FT, BM, RB…).
                        </td>
                      </tr>
                    )}
                    {table.rows.map((r, i) => (
                      <tr key={i} className={`${r[0] === '' ? 'font-bold' : ''} ${darkMode ? 'border-stone-800' : 'border-stone-100'} border-b`}>
                        {r.map((c, j) => (
                          <td key={j} className="px-3 py-1.5 font-mono">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 text-[11px] text-red-700 dark:text-red-400 font-semibold border-t border-stone-200 dark:border-stone-800" role="note">
                  NOTE: {STRUCTURAL_DISCLAIMER}
                </div>
              </div>
            );
          })()}

        {activeTab === 'rooms' && (
          <div
            className={`rounded-xl border overflow-hidden shadow-xs ${
              darkMode
                ? 'bg-stone-900 border-stone-800'
                : 'bg-white border-stone-200'
            }`}
          >
            <div
              className={`px-4 py-3 border-b flex items-center justify-between ${
                darkMode
                  ? 'bg-stone-900 border-stone-800'
                  : 'bg-stone-50/80 border-stone-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Home className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Room Finish &amp; Area Schedule
                </span>
              </div>
              <span className="text-xs font-mono text-stone-500">
                Total Net Area: {formatArea(totalRoomAreaSqIn, units)} | Total Perimeter:{' '}
                {formatLength(totalRoomPerimeterIn, units)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr
                    className={`border-b font-mono text-[11px] uppercase ${
                      darkMode
                        ? 'bg-stone-950/60 border-stone-800 text-stone-400'
                        : 'bg-stone-100/80 border-stone-200 text-stone-600'
                    }`}
                  >
                    <th className="py-2.5 px-3 w-24">Number</th>
                    <th className="py-2.5 px-3">Room Name</th>
                    <th className="py-2.5 px-3 w-36">Level</th>
                    <th className="py-2.5 px-3 w-40">
                      Area ({units === 'metric' ? 'm²' : 'sq ft'})
                    </th>
                    <th className="py-2.5 px-3 w-36">
                      Perimeter ({units === 'metric' ? 'mm' : 'ft-in'})
                    </th>
                    <th className="py-2.5 px-3 w-36">Floor Finish</th>
                    <th className="py-2.5 px-3">Comments</th>
                    <th className="py-2.5 px-3 w-20 text-right">Locate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                  {roomRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-stone-400 italic"
                      >
                        No rooms placed yet. Use the RM (Room) tool inside enclosed walls on the 2D Plan.
                      </td>
                    </tr>
                  ) : (
                    roomRows.map((row) => {
                      const displayAreaNum =
                        units === 'metric'
                          ? Number((row.areaSqIn * 0.00064516).toFixed(2))
                          : Number((row.areaSqIn / 144).toFixed(1));
                      return (
                        <tr
                          key={row.id}
                          className={
                            darkMode
                              ? 'hover:bg-stone-800/50'
                              : 'hover:bg-amber-50/40'
                          }
                        >
                          {/* Room Number / Mark */}
                          <td className="py-2 px-3">
                            <ScheduleCell
                              ariaLabel={`Room Number for ${row.name}`}
                              value={row.mark}
                              onCommit={(raw) => {
                                const nextMark = raw;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'room'
                                      ? { ...ent, mark: nextMark }
                                      : ent,
                                  nextMark,
                                  undefined,
                                  `Update Room Number to ${nextMark}`
                                );
                              }}
                              className={`w-full px-2 py-1 rounded border font-mono text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-amber-400'
                                  : 'bg-stone-50 border-stone-200 text-amber-800'
                              }`}
                            />
                          </td>

                          {/* Room Name */}
                          <td className="py-2 px-3">
                            <ScheduleCell
                              ariaLabel={`Room Name for ${row.mark}`}
                              value={row.name}
                              onCommit={(raw) => {
                                const nextName = raw;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'room'
                                      ? { ...ent, name: nextName }
                                      : ent,
                                  undefined,
                                  nextName,
                                  `Rename Room to "${nextName}"`
                                );
                              }}
                              className={`w-full px-2 py-1 rounded border font-medium text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                                  : 'bg-white border-stone-200 text-stone-900'
                              }`}
                            />
                          </td>

                          {/* Level */}
                          <td className="py-2 px-3">
                            <select
                              aria-label={`Level for ${row.name}`}
                              value={row.levelId}
                              onChange={(e) => {
                                const nextLvl = e.target.value;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'room'
                                      ? { ...ent, levelId: nextLvl }
                                      : ent,
                                  undefined,
                                  undefined,
                                  `Move Room "${row.name}" to Level`
                                );
                              }}
                              className={`w-full px-2 py-1 rounded border text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                                  : 'bg-white border-stone-200 text-stone-900'
                              }`}
                            >
                              {levels.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Editable Area */}
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1.5">
                              <ScheduleCell
                                hint={`Area in ${units === 'metric' ? 'm²' : 'sq ft'}`}
                                ariaLabel={`Area for ${row.name}`}
                                value={String(displayAreaNum)}
                                onCommit={(raw) => {
                                  const val = parseFloat(raw.replace(/[^0-9.]/g, ''));
                                  if (!Number.isFinite(val) || val <= 0) return 'Enter an area greater than 0';
                                  const targetSqIn =
                                    units === 'metric'
                                      ? val / 0.00064516
                                      : val * 144;
                                  updateEntityAndTags(
                                    row.id,
                                    (ent) =>
                                      ent.type === 'room'
                                        ? scaleRoomToTargetArea(ent, targetSqIn)
                                        : ent,
                                    undefined,
                                    undefined,
                                    `Update Room "${row.name}" Area`
                                  );
                                }}
                                className={`w-24 px-2 py-1 rounded border font-mono text-xs ${
                                  darkMode
                                    ? 'bg-stone-950 border-stone-700 text-stone-100'
                                    : 'bg-white border-stone-200 text-stone-900'
                                }`}
                              />
                              <span className="text-[11px] font-mono text-stone-400">
                                {units === 'metric' ? 'm²' : 'sq ft'}
                              </span>
                            </div>
                          </td>

                          {/* Perimeter */}
                          <td className="py-2 px-3 font-mono text-xs text-stone-600 dark:text-stone-300">
                            {row.perimeterFormatted}
                          </td>

                          {/* Floor Material */}
                          <td className="py-2 px-3">
                            <select
                              aria-label={`Floor Finish for ${row.name}`}
                              value={row.floorMaterial}
                              onChange={(e) => {
                                const mat = e.target.value as
                                  | 'wood'
                                  | 'tile'
                                  | 'concrete'
                                  | 'stone';
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'room'
                                      ? { ...ent, floorMaterial: mat }
                                      : ent,
                                  undefined,
                                  undefined,
                                  `Change "${row.name}" Floor Finish to ${mat}`
                                );
                              }}
                              className={`w-full px-2 py-1 rounded border text-xs capitalize ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                                  : 'bg-white border-stone-200 text-stone-900'
                              }`}
                            >
                              <option value="wood">Hardwood</option>
                              <option value="tile">Ceramic Tile</option>
                              <option value="concrete">Polished Concrete</option>
                              <option value="stone">Natural Stone</option>
                            </select>
                          </td>

                          {/* Comments */}
                          <td className="py-2 px-3">
                            <ScheduleCell
                              placeholder="Add finish note…"
                              value={row.comments}
                              onCommit={(raw) => {
                                const c = raw;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'room'
                                      ? { ...ent, comments: c }
                                      : ent,
                                  undefined,
                                  undefined,
                                  `Update Room Comment`
                                );
                              }}
                              className={`w-full px-2 py-1 rounded border text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-200'
                                  : 'bg-white border-stone-200 text-stone-700'
                              }`}
                            />
                          </td>

                          {/* Locate in Plan */}
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => onLocateEntity(row.id, row.levelId)}
                              title="Highlight Room in 2D Plan"
                              className={`px-2 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                                darkMode
                                  ? 'bg-stone-800 hover:bg-stone-700 text-amber-400'
                                  : 'bg-stone-100 hover:bg-stone-200 text-amber-700'
                              }`}
                            >
                              <span>Show</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'doors' && (
          <div
            className={`rounded-xl border overflow-hidden shadow-xs ${
              darkMode
                ? 'bg-stone-900 border-stone-800'
                : 'bg-white border-stone-200'
            }`}
          >
            <div
              className={`px-4 py-3 border-b flex items-center justify-between ${
                darkMode
                  ? 'bg-stone-900 border-stone-800'
                  : 'bg-stone-50/80 border-stone-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <DoorOpen className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Door Schedule ({doorRows.length} Doors)
                </span>
              </div>
              <span className="text-xs text-stone-500">
                Editing Width, Height, Swing, or Type updates the 2D swing symbol &amp; 3D opening live
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr
                    className={`border-b font-mono text-[11px] uppercase ${
                      darkMode
                        ? 'bg-stone-950/60 border-stone-800 text-stone-400'
                        : 'bg-stone-100/80 border-stone-200 text-stone-600'
                    }`}
                  >
                    <th className="py-2.5 px-3 w-24">Mark</th>
                    <th className="py-2.5 px-3 w-52">Family / Type</th>
                    <th className="py-2.5 px-3 w-36">Level</th>
                    <th className="py-2.5 px-3 w-32">Width (in)</th>
                    <th className="py-2.5 px-3 w-32">Height (in)</th>
                    <th className="py-2.5 px-3 w-36">Swing</th>
                    <th className="py-2.5 px-3 w-40">Host Wall</th>
                    <th className="py-2.5 px-3">Comments</th>
                    <th className="py-2.5 px-3 w-20 text-right">Locate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                  {doorRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-stone-400 italic"
                      >
                        No doors in model. Use DR (Door) to place doors inside walls.
                      </td>
                    </tr>
                  ) : (
                    doorRows.map((row) => (
                      <tr
                        key={row.id}
                        className={
                          darkMode
                            ? 'hover:bg-stone-800/50'
                            : 'hover:bg-amber-50/40'
                        }
                      >
                        {/* Mark */}
                        <td className="py-2 px-3">
                          <ScheduleCell
                            ariaLabel={`Door Mark ${row.mark}`}
                            value={row.mark}
                            onCommit={(raw) => {
                              const nextMark = raw;
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'door'
                                    ? { ...ent, mark: nextMark }
                                    : ent,
                                nextMark,
                                undefined,
                                `Update Door Mark to ${nextMark}`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border font-mono text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-amber-400'
                                : 'bg-stone-50 border-stone-200 text-amber-800'
                            }`}
                          />
                        </td>

                        {/* Door Type */}
                        <td className="py-2 px-3">
                          <select
                            aria-label={`Door Type for ${row.mark}`}
                            value={row.doorTypeId}
                            onChange={(e) => {
                              const dtId = e.target.value;
                              const dt = doorTypes.find((t) => t.id === dtId);
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'door'
                                    ? {
                                        ...ent,
                                        doorTypeId: dtId || undefined,
                                        width: dt ? dt.width : ent.width,
                                        height: dt ? dt.height : ent.height,
                                      }
                                    : ent,
                                undefined,
                                undefined,
                                `Change Door ${row.mark} Type`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-stone-100'
                                : 'bg-white border-stone-200 text-stone-900'
                            }`}
                          >
                            <option value="">Custom Size</option>
                            {doorTypes.map((dt) => (
                              <option key={dt.id} value={dt.id}>
                                {dt.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Level */}
                        <td className="py-2 px-3">
                          <select
                            aria-label={`Level for Door ${row.mark}`}
                            value={row.levelId}
                            onChange={(e) => {
                              const nextLvl = e.target.value;
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'door'
                                    ? { ...ent, levelId: nextLvl }
                                    : ent,
                                undefined,
                                undefined,
                                `Change Door ${row.mark} Level`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-stone-100'
                                : 'bg-white border-stone-200 text-stone-900'
                            }`}
                          >
                            {levels.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Width */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <ScheduleCell
                              hint={LENGTH_HINT(units)}
                              ariaLabel={`Width for Door ${row.mark}`}
                              value={formatLength(row.width, units)}
                              onCommit={(raw) => {
                                const w = parseLengthInput(raw, units);
                                if (w === null || !Number.isFinite(w)) return LENGTH_HINT(units);
                                if (w < 18 || w > 120) return `Must be between ${formatLength(18, units)} and ${formatLength(120, units)}`;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'door' ? { ...ent, width: w } : ent,
                                  undefined,
                                  undefined,
                                  `Resize Door ${row.mark} Width to ${formatLength(w, units)}`
                                );
                              }}
                              className={`w-16 px-2 py-1 rounded border font-mono text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                                  : 'bg-white border-stone-200 text-stone-900'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Height */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <ScheduleCell
                              hint={LENGTH_HINT(units)}
                              ariaLabel={`Height for Door ${row.mark}`}
                              value={formatLength(row.height, units)}
                              onCommit={(raw) => {
                                const h = parseLengthInput(raw, units);
                                if (h === null || !Number.isFinite(h)) return LENGTH_HINT(units);
                                if (h < 48 || h > 120) return `Must be between ${formatLength(48, units)} and ${formatLength(120, units)}`;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'door' ? { ...ent, height: h } : ent,
                                  undefined,
                                  undefined,
                                  `Resize Door ${row.mark} Height to ${formatLength(h, units)}`
                                );
                              }}
                              className={`w-16 px-2 py-1 rounded border font-mono text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                                  : 'bg-white border-stone-200 text-stone-900'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Swing */}
                        <td className="py-2 px-3">
                          <select
                            aria-label={`Swing for Door ${row.mark}`}
                            value={row.swing}
                            onChange={(e) => {
                              const sw = e.target.value as DoorSwing;
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'door' ? { ...ent, swing: sw } : ent,
                                undefined,
                                undefined,
                                `Change Door ${row.mark} Swing to ${sw}`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-stone-100'
                                : 'bg-white border-stone-200 text-stone-900'
                            }`}
                          >
                            <option value="left-in">Left In</option>
                            <option value="right-in">Right In</option>
                            <option value="left-out">Left Out</option>
                            <option value="right-out">Right Out</option>
                          </select>
                        </td>

                        {/* Host Wall */}
                        <td className="py-2 px-3 text-stone-500 dark:text-stone-400">
                          {row.wallName}
                        </td>

                        {/* Comments */}
                        <td className="py-2 px-3">
                          <ScheduleCell
                            placeholder="Hardware / fire rating…"
                            value={row.comments}
                            onCommit={(raw) => {
                              const c = raw;
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'door' ? { ...ent, comments: c } : ent,
                                undefined,
                                undefined,
                                `Update Door ${row.mark} Comment`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-stone-200'
                                : 'bg-white border-stone-200 text-stone-700'
                            }`}
                          />
                        </td>

                        {/* Locate */}
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onLocateEntity(row.id, row.levelId)}
                            className={`px-2 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                              darkMode
                                ? 'bg-stone-800 hover:bg-stone-700 text-amber-400'
                                : 'bg-stone-100 hover:bg-stone-200 text-amber-700'
                            }`}
                          >
                            <span>Show</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'windows' && (
          <div
            className={`rounded-xl border overflow-hidden shadow-xs ${
              darkMode
                ? 'bg-stone-900 border-stone-800'
                : 'bg-white border-stone-200'
            }`}
          >
            <div
              className={`px-4 py-3 border-b flex items-center justify-between ${
                darkMode
                  ? 'bg-stone-900 border-stone-800'
                  : 'bg-stone-50/80 border-stone-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Grid className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Window Schedule ({windowRows.length} Windows)
                </span>
              </div>
              <span className="text-xs text-stone-500">
                Editing Width, Height, or Sill Height updates the 2D glazing &amp; 3D window cutout live
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr
                    className={`border-b font-mono text-[11px] uppercase ${
                      darkMode
                        ? 'bg-stone-950/60 border-stone-800 text-stone-400'
                        : 'bg-stone-100/80 border-stone-200 text-stone-600'
                    }`}
                  >
                    <th className="py-2.5 px-3 w-24">Mark</th>
                    <th className="py-2.5 px-3 w-52">Family / Type</th>
                    <th className="py-2.5 px-3 w-36">Level</th>
                    <th className="py-2.5 px-3 w-32">Width (in)</th>
                    <th className="py-2.5 px-3 w-32">Height (in)</th>
                    <th className="py-2.5 px-3 w-32">Sill Height (in)</th>
                    <th className="py-2.5 px-3 w-40">Host Wall</th>
                    <th className="py-2.5 px-3">Comments</th>
                    <th className="py-2.5 px-3 w-20 text-right">Locate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                  {windowRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-stone-400 italic"
                      >
                        No windows in model. Use WN (Window) to place windows inside walls.
                      </td>
                    </tr>
                  ) : (
                    windowRows.map((row) => (
                      <tr
                        key={row.id}
                        className={
                          darkMode
                            ? 'hover:bg-stone-800/50'
                            : 'hover:bg-amber-50/40'
                        }
                      >
                        {/* Mark */}
                        <td className="py-2 px-3">
                          <ScheduleCell
                            ariaLabel={`Window Mark ${row.mark}`}
                            value={row.mark}
                            onCommit={(raw) => {
                              const nextMark = raw;
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'window'
                                    ? { ...ent, mark: nextMark }
                                    : ent,
                                nextMark,
                                undefined,
                                `Update Window Mark to ${nextMark}`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border font-mono text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-amber-400'
                                : 'bg-stone-50 border-stone-200 text-amber-800'
                            }`}
                          />
                        </td>

                        {/* Window Type */}
                        <td className="py-2 px-3">
                          <select
                            aria-label={`Window Type for ${row.mark}`}
                            value={row.windowTypeId}
                            onChange={(e) => {
                              const wtId = e.target.value;
                              const wt = windowTypes.find((t) => t.id === wtId);
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'window'
                                    ? {
                                        ...ent,
                                        windowTypeId: wtId || undefined,
                                        width: wt ? wt.width : ent.width,
                                        height: wt ? wt.height : ent.height,
                                        sillHeight: wt ? wt.sillHeight : ent.sillHeight,
                                      }
                                    : ent,
                                undefined,
                                undefined,
                                `Change Window ${row.mark} Type`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-stone-100'
                                : 'bg-white border-stone-200 text-stone-900'
                            }`}
                          >
                            <option value="">Custom Size</option>
                            {windowTypes.map((wt) => (
                              <option key={wt.id} value={wt.id}>
                                {wt.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Level */}
                        <td className="py-2 px-3">
                          <select
                            aria-label={`Level for Window ${row.mark}`}
                            value={row.levelId}
                            onChange={(e) => {
                              const nextLvl = e.target.value;
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'window'
                                    ? { ...ent, levelId: nextLvl }
                                    : ent,
                                undefined,
                                undefined,
                                `Change Window ${row.mark} Level`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-stone-100'
                                : 'bg-white border-stone-200 text-stone-900'
                            }`}
                          >
                            {levels.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Width */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <ScheduleCell
                              hint={LENGTH_HINT(units)}
                              ariaLabel={`Width for Window ${row.mark}`}
                              value={formatLength(row.width, units)}
                              onCommit={(raw) => {
                                const w = parseLengthInput(raw, units);
                                if (w === null || !Number.isFinite(w)) return LENGTH_HINT(units);
                                if (w < 12 || w > 144) return `Must be between ${formatLength(12, units)} and ${formatLength(144, units)}`;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'window' ? { ...ent, width: w } : ent,
                                  undefined,
                                  undefined,
                                  `Resize Window ${row.mark} Width to ${formatLength(w, units)}`
                                );
                              }}
                              className={`w-16 px-2 py-1 rounded border font-mono text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                                  : 'bg-white border-stone-200 text-stone-900'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Height */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <ScheduleCell
                              hint={LENGTH_HINT(units)}
                              ariaLabel={`Height for Window ${row.mark}`}
                              value={formatLength(row.height, units)}
                              onCommit={(raw) => {
                                const h = parseLengthInput(raw, units);
                                if (h === null || !Number.isFinite(h)) return LENGTH_HINT(units);
                                if (h < 12 || h > 120) return `Must be between ${formatLength(12, units)} and ${formatLength(120, units)}`;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'window' ? { ...ent, height: h } : ent,
                                  undefined,
                                  undefined,
                                  `Resize Window ${row.mark} Height to ${formatLength(h, units)}`
                                );
                              }}
                              className={`w-16 px-2 py-1 rounded border font-mono text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                                  : 'bg-white border-stone-200 text-stone-900'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Sill Height */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <ScheduleCell
                              hint={LENGTH_HINT(units)}
                              ariaLabel={`Sill Height for Window ${row.mark}`}
                              value={formatLength(row.sillHeight, units)}
                              onCommit={(raw) => {
                                const s = parseLengthInput(raw, units);
                                if (s === null || !Number.isFinite(s)) return LENGTH_HINT(units);
                                if (s < 0 || s > 96) return `Must be between ${formatLength(0, units)} and ${formatLength(96, units)}`;
                                updateEntityAndTags(
                                  row.id,
                                  (ent) =>
                                    ent.type === 'window'
                                      ? { ...ent, sillHeight: s }
                                      : ent,
                                  undefined,
                                  undefined,
                                  `Change Window ${row.mark} Sill Height to ${formatLength(s, units)}`
                                );
                              }}
                              className={`w-16 px-2 py-1 rounded border font-mono text-xs ${
                                darkMode
                                  ? 'bg-stone-950 border-stone-700 text-stone-100'
                                  : 'bg-white border-stone-200 text-stone-900'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Host Wall */}
                        <td className="py-2 px-3 text-stone-500 dark:text-stone-400">
                          {row.wallName}
                        </td>

                        {/* Comments */}
                        <td className="py-2 px-3">
                          <ScheduleCell
                            placeholder="Glazing / U-value note…"
                            value={row.comments}
                            onCommit={(raw) => {
                              const c = raw;
                              updateEntityAndTags(
                                row.id,
                                (ent) =>
                                  ent.type === 'window'
                                    ? { ...ent, comments: c }
                                    : ent,
                                undefined,
                                undefined,
                                `Update Window ${row.mark} Comment`
                              );
                            }}
                            className={`w-full px-2 py-1 rounded border text-xs ${
                              darkMode
                                ? 'bg-stone-950 border-stone-700 text-stone-200'
                                : 'bg-white border-stone-200 text-stone-700'
                            }`}
                          />
                        </td>

                        {/* Locate */}
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onLocateEntity(row.id, row.levelId)}
                            className={`px-2 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                              darkMode
                                ? 'bg-stone-800 hover:bg-stone-700 text-amber-400'
                                : 'bg-stone-100 hover:bg-stone-200 text-amber-700'
                            }`}
                          >
                            <span>Show</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Dynamic Registered Category Schedule (e.g. TestBox, Stairs, etc.) */}
        {activeTab !== 'rooms' && activeTab !== 'doors' && activeTab !== 'windows' && !STRUCT_TABS.some((t) => t.key === activeTab) && (() => {
          const cat = getElementCategory(activeTab);
          if (!cat) return null;

          let matching = model.entities.filter(
            (e) =>
              e.type === cat.categoryId ||
              (e.type === 'custom' && (e as any).customCategory === cat.categoryId)
          );

          if (sortCol) {
            matching = [...matching].sort((a, b) => {
              const colDef = cat.scheduleColumns.find((c) => c.key === sortCol);
              if (!colDef) return 0;
              const va = String(colDef.getValue(a, model));
              const vb = String(colDef.getValue(b, model));
              return sortAsc ? va.localeCompare(vb, undefined, { numeric: true }) : vb.localeCompare(va, undefined, { numeric: true });
            });
          }

          return (
            <div
              className={`rounded-xl border overflow-hidden shadow-xs ${
                darkMode
                  ? 'bg-stone-900 border-stone-800'
                  : 'bg-white border-stone-200'
              }`}
            >
              <div
                className={`px-4 py-3 border-b flex items-center justify-between ${
                  darkMode
                    ? 'bg-stone-900 border-stone-800'
                    : 'bg-stone-50/80 border-stone-200'
                }`}
              >
                <span className="text-xs font-bold uppercase tracking-wider">
                  {cat.displayName} Schedule ({matching.length} items)
                </span>
                <span className="text-xs text-stone-400">
                  Click column headers to sort • Edit cells to update elements live
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr
                      className={`border-b font-mono text-[11px] uppercase ${
                        darkMode
                          ? 'bg-stone-950/60 border-stone-800 text-stone-400'
                          : 'bg-stone-100/80 border-stone-200 text-stone-600'
                      }`}
                    >
                      {cat.scheduleColumns.map((col) => (
                        <th
                          key={col.key}
                          onClick={() => {
                            if (sortCol === col.key) {
                              setSortAsc(!sortAsc);
                            } else {
                              setSortCol(col.key);
                              setSortAsc(true);
                            }
                          }}
                          className={`py-2.5 px-3 cursor-pointer hover:text-amber-500 transition-colors ${
                            col.width || ''
                          }`}
                        >
                          <div className="flex items-center gap-1">
                            <span>{col.header}</span>
                            {sortCol === col.key && (
                              <span>{sortAsc ? '▲' : '▼'}</span>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="py-2.5 px-3 text-right w-20">Locate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matching.length === 0 ? (
                      <tr>
                        <td
                          colSpan={cat.scheduleColumns.length + 1}
                          className="py-8 text-center text-stone-400"
                        >
                          No {cat.displayName} elements placed yet.
                        </td>
                      </tr>
                    ) : (
                      matching.map((ent) => (
                        <tr
                          key={ent.id}
                          className={`border-b transition-colors ${
                            darkMode
                              ? 'border-stone-800/60 hover:bg-stone-800/40'
                              : 'border-stone-200/60 hover:bg-stone-50'
                          }`}
                        >
                          {cat.scheduleColumns.map((col) => {
                            const val = col.getValue(ent, model);
                            if (col.isEditable && col.setValue) {
                              return (
                                <td key={col.key} className="py-2 px-3">
                                  <ScheduleCell
                                    value={String(val)}
                                    onCommit={(raw) => {
                                      const updated = col.setValue!(
                                        ent,
                                        raw,
                                        model
                                      );
                                      const nextEntities = model.entities.map(
                                        (item) =>
                                          item.id === ent.id ? updated : item
                                      );
                                      onUpdateModel(
                                        { ...model, entities: nextEntities },
                                        `Edit ${col.header} for ${ent.id.slice(0, 8)}`
                                      );
                                    }}
                                    className={`w-full px-2 py-1 rounded border text-xs ${
                                      darkMode
                                        ? 'bg-stone-950 border-stone-700 text-stone-200'
                                        : 'bg-white border-stone-200 text-stone-800'
                                    }`}
                                  />
                                </td>
                              );
                            }
                            return (
                              <td
                                key={col.key}
                                className="py-2.5 px-3 font-mono text-[11px]"
                              >
                                {val}
                              </td>
                            );
                          })}
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => onLocateEntity(ent.id, ent.levelId)}
                              className={`px-2 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                                darkMode
                                  ? 'bg-stone-800 hover:bg-stone-700 text-amber-400'
                                  : 'bg-stone-100 hover:bg-stone-200 text-amber-700'
                              }`}
                            >
                              <span>Show</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
