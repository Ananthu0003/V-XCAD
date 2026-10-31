import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { stepperStyle } from './styles';

export interface NumInputProps {
  label: string;
  paramKey: string;
  step?: number;
  min?: number;
  max?: number;
  defaultVal?: number;
  unit?: string;
  params: Record<string, any>;
  onChange: (k: string, v: number) => void;
}

export function NumInput({
  label,
  paramKey,
  step = 0.1,
  min = 0,
  max,
  defaultVal = 0,
  unit = 'mm',
  params,
  onChange,
}: NumInputProps) {
  const val = params[paramKey] ?? defaultVal;
  const [draft, setDraft] = React.useState<string>(val !== undefined && val !== null ? String(val) : '');
  const isFocusedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(val !== undefined && val !== null ? String(val) : '');
    }
  }, [val]);

  const commitValue = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      onChange(paramKey, defaultVal);
      setDraft(String(defaultVal));
      return;
    }
    const parsed = parseFloat(trimmed);
    if (isNaN(parsed)) {
      onChange(paramKey, defaultVal);
      setDraft(String(defaultVal));
      return;
    }
    let clamped = parsed;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    clamped = parseFloat(clamped.toFixed(3));
    onChange(paramKey, clamped);
    setDraft(String(clamped));
  };

  const handleStep = (delta: number) => {
    let next = parseFloat(((parseFloat(draft) || val || 0) + delta).toFixed(3));
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    onChange(paramKey, next);
    setDraft(String(next));
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        minHeight: 28,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontFamily: 'var(--font-sans)',
          color: 'var(--mcad-text-secondary)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => handleStep(-step)}
          style={stepperStyle}
          aria-label={`Decrease ${label}`}
        >
          <Minus size={11} strokeWidth={2.5} />
        </button>
        <div style={{ position: 'relative', width: 84 }}>
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onFocus={() => {
              isFocusedRef.current = true;
            }}
            onBlur={() => {
              isFocusedRef.current = false;
              commitValue(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                handleStep(e.shiftKey ? step * 10 : step);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                handleStep(e.shiftKey ? -step * 10 : -step);
              }
            }}
            onChange={(e) => {
              const text = e.target.value;
              setDraft(text);
              if (text !== '' && text !== '-' && text !== '.') {
                const parsed = parseFloat(text);
                if (!isNaN(parsed)) {
                  let clamped = parsed;
                  if (min !== undefined && clamped < min) clamped = min;
                  if (max !== undefined && clamped > max) clamped = max;
                  onChange(paramKey, clamped);
                }
              }
            }}
            style={{
              width: 84,
              height: 28,
              background: 'var(--mcad-input)',
              border: '1px solid var(--mcad-border-ctrl)',
              borderRadius: 8,
              color: 'var(--mcad-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              textAlign: 'right',
              paddingLeft: 6,
              paddingRight: unit ? 24 : 6,
              outline: 'none',
            }}
          />
          {unit && (
            <span
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 10,
                color: 'var(--mcad-text-muted)',
                fontFamily: 'var(--font-sans)',
                pointerEvents: 'none',
              }}
            >
              {unit}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleStep(step)}
          style={stepperStyle}
          aria-label={`Increase ${label}`}
        >
          <Plus size={11} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

