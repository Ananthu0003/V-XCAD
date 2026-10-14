import React from 'react';

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
  defaultVal = 0,
  unit = 'mm',
  params,
  onChange,
}: NumInputProps) {
  const val = params[paramKey] ?? defaultVal;
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
          onClick={() => onChange(paramKey, Math.max(min, parseFloat((val - step).toFixed(3))))}
          style={stepperStyle}
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <div style={{ position: 'relative', width: 84 }}>
          <input
            type="number"
            step={step}
            min={min}
            value={val}
            onChange={e => onChange(paramKey, parseFloat(e.target.value) || defaultVal)}
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
          onClick={() => onChange(paramKey, parseFloat((val + step).toFixed(3)))}
          style={stepperStyle}
          aria-label={`Increase ${label}`}
        >
          +
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
            onClick={() => onChange('pos_x', parseFloat((posX - 1).toFixed(1)))}
            style={{ ...stepperStyle, width: 18 }}
          >−</button>
          <input
            type="number"
            value={posX}
            onChange={e => onChange('pos_x', parseFloat(e.target.value) || 0)}
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
            onClick={() => onChange('pos_x', parseFloat((posX + 1).toFixed(1)))}
            style={{ ...stepperStyle, width: 18 }}
          >+</button>
        </div>
        {/* Y */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--mcad-text-muted)' }}>Y</span>
          <button
            type="button"
            onClick={() => onChange('pos_y', parseFloat((posY - 1).toFixed(1)))}
            style={{ ...stepperStyle, width: 18 }}
          >−</button>
          <input
            type="number"
            value={posY}
            onChange={e => onChange('pos_y', parseFloat(e.target.value) || 0)}
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
            onClick={() => onChange('pos_y', parseFloat((posY + 1).toFixed(1)))}
            style={{ ...stepperStyle, width: 18 }}
          >+</button>
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
