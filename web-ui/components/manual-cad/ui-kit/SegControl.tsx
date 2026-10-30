import React from 'react';

export function SegControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--mcad-border-ctrl)',
        background: 'var(--mcad-input)',
        width: '100%',
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            flex: 1,
            height: 28,
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

