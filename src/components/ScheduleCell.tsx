import React, { useEffect, useRef, useState } from 'react';

interface ScheduleCellProps {
  /** Formatted value shown when the cell is not being edited. */
  value: string;
  /**
   * Called once when the user presses Enter or leaves the cell with a changed value.
   * Return an error message to reject the edit (the cell reverts and shows the message).
   */
  onCommit: (raw: string) => string | null | void;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  /** Optional hint shown as the tooltip, e.g. accepted formats. */
  hint?: string;
}

/**
 * Spreadsheet-style schedule cell: edits a local draft and writes to the model once
 * (Enter / Tab / blur), so each edit is a single undo step and partially-typed values
 * (e.g. "3" on the way to "36") never reach the model. Escape cancels.
 */
export const ScheduleCell: React.FC<ScheduleCellProps> = ({ value, onCommit, ariaLabel, placeholder, className, hint }) => {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    if (draft === value) return;
    const err = onCommit(draft);
    if (err) {
      setError(err);
      setDraft(value);
    } else {
      setError(null);
    }
  };

  return (
    <input
      type="text"
      aria-label={ariaLabel}
      aria-invalid={error ? true : undefined}
      placeholder={placeholder}
      title={error || hint}
      value={draft}
      onFocus={(e) => {
        setEditing(true);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={`${className || ''} ${error ? '!border-red-500 !ring-1 !ring-red-400' : ''}`}
    />
  );
};
