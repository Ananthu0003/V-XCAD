import React from 'react';

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 11,
        fontFamily: 'var(--font-sans)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--mcad-text-muted)',
        fontWeight: 600,
        margin: 0,
        marginBottom: 6,
      }}
    >
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

