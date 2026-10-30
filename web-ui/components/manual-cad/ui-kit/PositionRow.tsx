import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { stepperStyle } from './styles';

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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
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
            onFocus={() => {
              focusX.current = true;
            }}
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
            onFocus={() => {
              focusY.current = true;
            }}
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

