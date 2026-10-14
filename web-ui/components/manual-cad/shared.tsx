import React from 'react';
import { Minus, Plus } from 'lucide-react';

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 11,
      fontFamily: 'var(--font-sans)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--mcad-text-muted)',
      fontWeight: 600,
      margin: 0,
      marginBottom: 6,
    }}>
      {children}
    </p>
  );
}

export function Divider() {
  return <div style={{ height: 1, background: 'var(--mcad-border)', margin: '12px 0', flexShrink: 0 }} />;
}

export function MonoValue({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--mcad-text-primary)' }}>
      {children}
    </span>
  );
}

export function PropRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
      <span style={{ fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--mcad-text-secondary)' }}>{label}</span>
      <MonoValue>{value}</MonoValue>
    </div>
  );
}

export const stepperStyle: React.CSSProperties = {
  width: 22,
  height: 28,
  borderRadius: 8,
  background: 'var(--mcad-input)',
  border: '1px solid var(--mcad-border-ctrl)',
  color: 'var(--mcad-text-secondary)',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  userSelect: 'none',
};

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
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      minHeight: 28,
    }}>
      <span style={{
        fontSize: 12,
        fontFamily: 'var(--font-sans)',
        color: 'var(--mcad-text-secondary)',
        flexShrink: 0,
      }}>
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
            onFocus={() => { isFocusedRef.current = true; }}
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
            <span style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 10,
              color: 'var(--mcad-text-muted)',
              fontFamily: 'var(--font-sans)',
              pointerEvents: 'none',
            }}>
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

export function PositionRow({
  params,
  onChange,
}: {
  params: Record<string, any>;
  onChange: (k: string, v: number) => void;
}) {
  const posX = params.pos_x ?? 0;
  const posY = params.pos_y ?? 0;
  const [draftX, setDraftX] = React.useState<string>(String(posX));
  const [draftY, setDraftY] = React.useState<string>(String(posY));
  const focusX = React.useRef(false);
  const focusY = React.useRef(false);

  React.useEffect(() => {
    if (!focusX.current) setDraftX(String(posX));
  }, [posX]);

  React.useEffect(() => {
    if (!focusY.current) setDraftY(String(posY));
  }, [posY]);

  const commitX = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      onChange('pos_x', 0);
      setDraftX('0');
      return;
    }
    const parsed = parseFloat(trimmed);
    const val = isNaN(parsed) ? 0 : parseFloat(parsed.toFixed(2));
    onChange('pos_x', val);
    setDraftX(String(val));
  };

  const commitY = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      onChange('pos_y', 0);
      setDraftY('0');
      return;
    }
    const parsed = parseFloat(trimmed);
    const val = isNaN(parsed) ? 0 : parseFloat(parsed.toFixed(2));
    onChange('pos_y', val);
    setDraftY(String(val));
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
      minHeight: 28,
    }}>
      <span style={{
        fontSize: 12,
        fontFamily: 'var(--font-sans)',
        color: 'var(--mcad-text-secondary)',
        flexShrink: 0,
      }}>
        Position
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* X */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--mcad-text-muted)' }}>X</span>
          <button
            type="button"
            onClick={() => {
              const next = parseFloat((posX - 1).toFixed(1));
              onChange('pos_x', next);
              setDraftX(String(next));
            }}
            style={{ ...stepperStyle, width: 18 }}
            aria-label="Decrease X"
          >
            <Minus size={10} strokeWidth={2.5} />
          </button>
          <input
            type="text"
            inputMode="decimal"
            value={draftX}
            onFocus={() => { focusX.current = true; }}
            onBlur={() => {
              focusX.current = false;
              commitX(draftX);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const next = parseFloat((posX + (e.shiftKey ? 10 : 1)).toFixed(1));
                onChange('pos_x', next);
                setDraftX(String(next));
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = parseFloat((posX - (e.shiftKey ? 10 : 1)).toFixed(1));
                onChange('pos_x', next);
                setDraftX(String(next));
              }
            }}
            onChange={(e) => {
              setDraftX(e.target.value);
              const p = parseFloat(e.target.value);
              if (!isNaN(p)) onChange('pos_x', p);
            }}
            style={{
              width: 44,
              height: 28,
              background: 'var(--mcad-input)',
              border: '1px solid var(--mcad-border-ctrl)',
              borderRadius: 8,
              color: 'var(--mcad-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              textAlign: 'right',
              padding: '0 4px',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => {
              const next = parseFloat((posX + 1).toFixed(1));
              onChange('pos_x', next);
              setDraftX(String(next));
            }}
            style={{ ...stepperStyle, width: 18 }}
            aria-label="Increase X"
          >
            <Plus size={10} strokeWidth={2.5} />
          </button>
        </div>
        {/* Y */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--mcad-text-muted)' }}>Y</span>
          <button
            type="button"
            onClick={() => {
              const next = parseFloat((posY - 1).toFixed(1));
              onChange('pos_y', next);
              setDraftY(String(next));
            }}
            style={{ ...stepperStyle, width: 18 }}
            aria-label="Decrease Y"
          >
            <Minus size={10} strokeWidth={2.5} />
          </button>
          <input
            type="text"
            inputMode="decimal"
            value={draftY}
            onFocus={() => { focusY.current = true; }}
            onBlur={() => {
              focusY.current = false;
              commitY(draftY);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const next = parseFloat((posY + (e.shiftKey ? 10 : 1)).toFixed(1));
                onChange('pos_y', next);
                setDraftY(String(next));
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = parseFloat((posY - (e.shiftKey ? 10 : 1)).toFixed(1));
                onChange('pos_y', next);
                setDraftY(String(next));
              }
            }}
            onChange={(e) => {
              setDraftY(e.target.value);
              const p = parseFloat(e.target.value);
              if (!isNaN(p)) onChange('pos_y', p);
            }}
            style={{
              width: 44,
              height: 28,
              background: 'var(--mcad-input)',
              border: '1px solid var(--mcad-border-ctrl)',
              borderRadius: 8,
              color: 'var(--mcad-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              textAlign: 'right',
              padding: '0 4px',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => {
              const next = parseFloat((posY + 1).toFixed(1));
              onChange('pos_y', next);
              setDraftY(String(next));
            }}
            style={{ ...stepperStyle, width: 18 }}
            aria-label="Increase Y"
          >
            <Plus size={10} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function SegControl<T extends string>({
  options,
  value,
  onChange,
}: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{
      display: 'flex', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--mcad-border-ctrl)', background: 'var(--mcad-input)',
      width: '100%',
    }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            flex: 1, height: 28,
            background: value === o.value ? 'var(--mcad-segment-active)' : 'transparent',
            color: value === o.value ? '#ffffff' : 'var(--mcad-text-secondary)',
            border: 'none',
            borderRight: o === options[options.length - 1] ? 'none' : '1px solid var(--mcad-border-ctrl)',
            fontSize: 10.5,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
            fontWeight: value === o.value ? 600 : 400,
            padding: '0 2px',
            whiteSpace: 'nowrap',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const presetBtnStyle: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 6, fontSize: 10,
  fontFamily: 'var(--font-mono)', cursor: 'pointer', transition: 'all 0.12s',
};

export interface ApiErrorDiagnostic {
  code: string;
  message: string;
  hint?: string;
}

/**
 * Universal error parser handling FastAPI detail strings/lists, validation reports,
 * structured { error: { message } }, and network HTTP codes.
 */
export function parseApiError(res?: Response | null, body?: any): ApiErrorDiagnostic {
  if (!body && !res) {
    return { code: 'UNKNOWN_ERROR', message: 'An unknown error occurred.' };
  }

  if (typeof body === 'string') {
    return {
      code: res?.status ? `HTTP_${res.status}` : 'ERROR',
      message: body,
    };
  }

  // 1. Pydantic 422 list: { detail: [{ loc: [...], msg: "...", type: "..." }] }
  if (body?.detail && Array.isArray(body.detail)) {
    const msgs = body.detail.map((d: any) => {
      const loc = Array.isArray(d.loc) ? d.loc.filter((l: any) => l !== 'body').join('.') : '';
      return loc ? `${loc}: ${d.msg || 'invalid'}` : (d.msg || 'invalid');
    });
    return {
      code: 'VALIDATION_ERROR',
      message: msgs.join('; ') || 'Validation error',
      hint: 'Check operation parameters against schema constraints.',
    };
  }

  // 2. FastAPI detail string: { detail: "..." }
  if (typeof body?.detail === 'string') {
    return {
      code: res?.status ? `HTTP_${res.status}` : 'ERROR',
      message: body.detail,
    };
  }

  // 3. Structured error: { error: { message, code, hint } }
  if (body?.error && typeof body.error === 'object') {
    return {
      code: body.error.code || (res?.status ? `HTTP_${res.status}` : 'ERROR'),
      message: body.error.message || 'Operation failed',
      hint: body.error.hint,
    };
  }

  // 4. Validation error: { validation: { error_message, error_code, suggestions } }
  if (body?.validation && typeof body.validation === 'object') {
    return {
      code: body.validation.error_code || 'GEOMETRY_FAILURE',
      message: body.validation.error_message || 'B-Rep geometry validation failed',
      hint: Array.isArray(body.validation.suggestions) ? body.validation.suggestions[0] : undefined,
    };
  }

  // 5. Direct error_diagnostic: { error_diagnostic: { code, message } }
  if (body?.error_diagnostic && typeof body.error_diagnostic === 'object') {
    return {
      code: body.error_diagnostic.code || 'ERROR',
      message: body.error_diagnostic.message || 'Operation failed',
    };
  }

  // 6. Generic message field: { message: "..." }
  if (typeof body?.message === 'string') {
    return {
      code: res?.status ? `HTTP_${res.status}` : 'ERROR',
      message: body.message,
    };
  }

  return {
    code: res?.status ? `HTTP_${res.status}` : 'ERROR',
    message: res?.statusText || 'Request failed',
  };
}

