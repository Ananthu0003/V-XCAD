'use client';

import React from 'react';
import { Ruler, Wrench, Settings } from 'lucide-react';

export type StageValue = 'cad' | 'manual_cad' | 'cam';

interface StageSwitcherProps {
  value: StageValue | string;
  onChange: (stage: StageValue) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function StageSwitcher({ value, onChange, className = '', style }: StageSwitcherProps) {
  // Normalize value: if 'blueprint', 'extraction', etc., map to 'cad'
  const currentStage: StageValue =
    value === 'manual_cad' ? 'manual_cad' : value === 'cam' || value === 'gcode' ? 'cam' : 'cad';

  return (
    <div
      className={`ui-seg ${className}`}
      style={{
        width: '100%',
        display: 'flex',
        gap: 2,
        padding: 3,
        borderRadius: 10,
        background: 'var(--ui-input)',
        ...style,
      }}
    >
      <button
        type="button"
        data-on={currentStage === 'cad'}
        onClick={() => onChange('cad')}
        title="Switch to AI CAD stage"
        className="flex-1"
      >
        <Ruler size={13} strokeWidth={1.8} />
        <span>AI CAD</span>
      </button>
      <button
        type="button"
        data-on={currentStage === 'manual_cad'}
        onClick={() => onChange('manual_cad')}
        title="Switch to Manual CAD stage"
        className="flex-1"
      >
        <Wrench size={13} strokeWidth={1.8} />
        <span>Manual CAD</span>
      </button>
      <button
        type="button"
        data-on={currentStage === 'cam'}
        onClick={() => onChange('cam')}
        title="Switch to CAM Setup stage"
        className="flex-1"
      >
        <Settings size={13} strokeWidth={1.8} />
        <span>CAM Setup</span>
      </button>
    </div>
  );
}
