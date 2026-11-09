import React, { useState } from 'react';
import { X, Copy, Edit3, Check, Sliders } from 'lucide-react';
import {
  ArchEntity,
  ArchModel,
  DoorType,
  FloorType,
  UnitSystem,
  WallType,
  WindowType,
} from '../types/model';
import { formatLength, parseLengthInput } from '../engine/geometry';
import { getElementCategory, ParameterDef } from '../engine/elementRegistry';

interface EditTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  entity: ArchEntity;
  model: ArchModel;
  onUpdateModel: (nextModel: ArchModel, actionLabel: string) => void;
  units: UnitSystem;
  darkMode: boolean;
}

export const EditTypeModal: React.FC<EditTypeModalProps> = ({
  isOpen,
  onClose,
  entity,
  model,
  onUpdateModel,
  units,
  darkMode,
}) => {
  if (!isOpen) return null;

  const categoryId =
    entity.type === 'custom' ? (entity as any).customCategory : entity.type;
  const categoryDef = getElementCategory(categoryId);

  // Identify type object or virtual type parameters
  let typeId =
    (entity as any).wallTypeId ||
    (entity as any).doorTypeId ||
    (entity as any).windowTypeId ||
    (entity as any).floorTypeId ||
    (entity as any).columnTypeId ||
    'default-type';

  let currentTypeName = 'Standard Type';
  let allTypesList: Array<{ id: string; name: string }> = [];

  if (entity.type === 'wall' && model.wallTypes) {
    allTypesList = model.wallTypes;
    const wt = model.wallTypes.find((t) => t.id === typeId);
    if (wt) currentTypeName = wt.name;
  } else if (entity.type === 'window' && model.windowTypes) {
    allTypesList = model.windowTypes;
    const wt = model.windowTypes.find((t) => t.id === typeId);
    if (wt) currentTypeName = wt.name;
  } else if (entity.type === 'door' && model.doorTypes) {
    allTypesList = model.doorTypes;
    const dt = model.doorTypes.find((t) => t.id === typeId);
    if (dt) currentTypeName = dt.name;
  } else if (entity.type === 'floor' && model.floorTypes) {
    allTypesList = model.floorTypes;
    const ft = model.floorTypes.find((t) => t.id === typeId);
    if (ft) currentTypeName = ft.name;
  } else {
    currentTypeName = `${categoryDef?.displayName || 'Component'} Type 1`;
  }

  const [typeName, setTypeName] = useState(currentTypeName);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(currentTypeName);

  // Type parameters values draft
  const typeParams = categoryDef?.typeParameters || [];
  const [paramDrafts, setParamDrafts] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const p of typeParams) {
      initial[p.key] = (entity as any)[p.key] ?? p.defaultValue;
    }
    return initial;
  });

  // DUPLICATE TYPE ACTION
  const handleDuplicate = () => {
    const dupName = `${currentTypeName} (Copy)`;
    const newTypeId = `${categoryId}-type-${Date.now()}`;

    if (entity.type === 'window') {
      const existing = (model.windowTypes || []).find((t) => t.id === typeId);
      const newType: WindowType = {
        id: newTypeId,
        name: dupName,
        width: paramDrafts.width || existing?.width || 48,
        height: paramDrafts.height || existing?.height || 48,
        sillHeight: paramDrafts.sillHeight || existing?.sillHeight || 36,
      };
      const nextModel: ArchModel = {
        ...model,
        windowTypes: [...(model.windowTypes || []), newType],
        entities: model.entities.map((e) =>
          e.id === entity.id
            ? { ...e, windowTypeId: newTypeId, width: newType.width, height: newType.height }
            : e
        ),
      };
      onUpdateModel(nextModel, `Duplicate Window Type: ${dupName}`);
      onClose();
    } else if (entity.type === 'wall') {
      const existing = (model.wallTypes || []).find((t) => t.id === typeId);
      if (existing) {
        const newType: WallType = {
          ...existing,
          id: newTypeId,
          name: dupName,
        };
        const nextModel: ArchModel = {
          ...model,
          wallTypes: [...(model.wallTypes || []), newType],
          entities: model.entities.map((e) =>
            e.id === entity.id ? { ...e, wallTypeId: newTypeId } : e
          ),
        };
        onUpdateModel(nextModel, `Duplicate Wall Type: ${dupName}`);
        onClose();
      }
    } else {
      // Generic duplicate for custom / registered elements
      const nextEntities = model.entities.map((e) =>
        e.id === entity.id
          ? { ...e, typeName: dupName, typeId: newTypeId, ...paramDrafts }
          : e
      );
      onUpdateModel({ ...model, entities: nextEntities }, `Duplicate Type: ${dupName}`);
      onClose();
    }
  };

  // RENAME TYPE ACTION
  const handleRename = () => {
    if (!renameValue.trim()) return;
    if (entity.type === 'window' && model.windowTypes) {
      const nextTypes = model.windowTypes.map((t) =>
        t.id === typeId ? { ...t, name: renameValue } : t
      );
      onUpdateModel({ ...model, windowTypes: nextTypes }, `Rename Window Type: ${renameValue}`);
    } else if (entity.type === 'wall' && model.wallTypes) {
      const nextTypes = model.wallTypes.map((t) =>
        t.id === typeId ? { ...t, name: renameValue } : t
      );
      onUpdateModel({ ...model, wallTypes: nextTypes }, `Rename Wall Type: ${renameValue}`);
    }
    setTypeName(renameValue);
    setIsRenaming(false);
  };

  // COMMIT TYPE PARAMETERS EDIT TO ALL INSTANCES
  const handleSaveTypeParams = () => {
    // Update all entities that share this type
    const nextEntities = model.entities.map((e) => {
      const matchesType =
        (e as any).wallTypeId === typeId ||
        (e as any).windowTypeId === typeId ||
        (e as any).doorTypeId === typeId ||
        (e as any).floorTypeId === typeId ||
        (e.type === entity.type && (e as any).typeName === typeName);

      if (matchesType || e.id === entity.id) {
        return {
          ...e,
          ...paramDrafts,
        };
      }
      return e;
    });

    onUpdateModel(
      { ...model, entities: nextEntities },
      `Edit Type Parameters for "${currentTypeName}" (all instances updated)`
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div
        className={`w-full max-w-md rounded-xl shadow-2xl border overflow-hidden flex flex-col ${
          darkMode ? 'bg-stone-900 border-stone-800 text-stone-100' : 'bg-white border-stone-200 text-stone-900'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-600" />
            <div>
              <h2 className="text-sm font-bold">Type Properties</h2>
              <p className="text-[11px] text-stone-400">
                Category: {categoryDef?.displayName || entity.type}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-stone-500/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Type Actions: Rename & Duplicate */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="p-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-500/5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                Type Name
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsRenaming(true);
                    setRenameValue(typeName);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-stone-300 dark:border-stone-700 hover:bg-stone-500/10"
                  title="Rename this type"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>Rename…</span>
                </button>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium"
                  title="Duplicate type with a new name"
                >
                  <Copy className="w-3 h-3" />
                  <span>Duplicate…</span>
                </button>
              </div>
            </div>

            {isRenaming ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="flex-1 px-2.5 py-1 text-xs rounded border border-amber-500 bg-transparent font-medium"
                />
                <button
                  type="button"
                  onClick={handleRename}
                  className="p-1 rounded bg-amber-600 text-white hover:bg-amber-700"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsRenaming(false)}
                  className="p-1 rounded border border-stone-400 hover:bg-stone-500/10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                {typeName}
              </div>
            )}
          </div>

          {/* Type Parameters Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Type Parameters (Changes apply to all instances)
            </h3>

            {typeParams.length === 0 ? (
              <p className="text-xs text-stone-400 italic">
                No custom type parameters defined for this category.
              </p>
            ) : (
              <div className="space-y-2.5">
                {typeParams.map((param) => {
                  const val = paramDrafts[param.key];
                  return (
                    <div
                      key={param.key}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <label className="text-stone-500 dark:text-stone-400">
                        {param.label}
                      </label>
                      {param.type === 'length' ? (
                        <input
                          type="text"
                          value={
                            typeof val === 'number'
                              ? formatLength(val, units)
                              : val ?? ''
                          }
                          onChange={(e) => {
                            const parsed = parseLengthInput(e.target.value, units);
                            if (parsed !== null && parsed >= 0) {
                              setParamDrafts((prev) => ({
                                ...prev,
                                [param.key]: parsed,
                              }));
                            }
                          }}
                          className="w-32 px-2 py-1 text-xs font-mono rounded border border-stone-300 dark:border-stone-700 bg-transparent text-right"
                        />
                      ) : (
                        <input
                          type="text"
                          value={val ?? ''}
                          onChange={(e) =>
                            setParamDrafts((prev) => ({
                              ...prev,
                              [param.key]: e.target.value,
                            }))
                          }
                          className="w-32 px-2 py-1 text-xs rounded border border-stone-300 dark:border-stone-700 bg-transparent"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between text-xs bg-stone-50 dark:bg-stone-950">
          <span className="text-[11px] text-stone-400">
            All placed instances of this type will update automatically.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-500/10 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveTypeParams}
              className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
