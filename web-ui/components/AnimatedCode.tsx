'use client';

import { useEffect, useState } from 'react';

// Professional-looking generic Python mesh optimizer code
const CODE_LINES = [
  { text: 'import asyncio', color: 'text-blue-400', indent: 0 },
  { text: 'from typing import Dict, List, Optional', color: 'text-blue-400', indent: 0 },
  { text: 'import numpy as np', color: 'text-blue-400', indent: 0 },
  { text: '', color: 'text-foreground', indent: 0 },
  { text: 'class MeshOptimizer:', color: 'text-yellow-300', indent: 0 },
  { text: '"""Advanced 3D surface mesh refiner."""', color: 'text-gray-500', indent: 1 },
  { text: '', color: 'text-foreground', indent: 0 },
  { text: 'def __init__(self, lr: float = 1e-3) -> None:', color: 'text-purple-400', indent: 1 },
  { text: 'self.lr = lr', color: 'text-foreground', indent: 2 },
  { text: 'self.cache: Dict[str, np.ndarray] = {}', color: 'text-cyan-400', indent: 2 },
  { text: '', color: 'text-foreground', indent: 0 },
  { text: 'async def refine(self, iterations: int) -> float:', color: 'text-purple-400', indent: 1 },
  { text: 'score = 0.0', color: 'text-foreground', indent: 2 },
  { text: 'for i in range(iterations):', color: 'text-purple-400', indent: 2 },
  { text: 'await asyncio.sleep(0.01)', color: 'text-gray-400', indent: 3 },
  { text: 'delta = np.random.randn(3, 3)', color: 'text-cyan-400', indent: 3 },
  { text: 'score += float(np.sum(delta) * self.lr)', color: 'text-foreground', indent: 3 },
  { text: 'return score', color: 'text-green-400', indent: 2 },
];

const INDENT = '    ';
const CHAR_DELAY = 18;
const LINE_PAUSE = 250;
const RESTART_PAUSE = 3500;

export function AnimatedCode() {
  const [visibleLines, setVisibleLines] = useState<{ text: string; color: string; indent: number }[]>([]);
  const [currentLineText, setCurrentLineText] = useState('');
  const [lineIdx, setLineIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [showCursor, setShowCursor] = useState(true);

  // Cursor blink
  useEffect(() => {
    const id = setInterval(() => setShowCursor(v => !v), 530);
    return () => clearInterval(id);
  }, []);

  // Typewriter engine
  useEffect(() => {
    if (lineIdx >= CODE_LINES.length) {
      const id = setTimeout(() => {
        setVisibleLines([]);
        setCurrentLineText('');
        setLineIdx(0);
        setCharIdx(0);
      }, RESTART_PAUSE);
      return () => clearTimeout(id);
    }

    const line = CODE_LINES[lineIdx];
    const fullText = INDENT.repeat(line.indent) + line.text;

    if (charIdx < fullText.length) {
      const id = setTimeout(() => {
        setCurrentLineText(fullText.slice(0, charIdx + 1));
        setCharIdx(c => c + 1);
      }, CHAR_DELAY);
      return () => clearTimeout(id);
    } else {
      const pause = line.text === '' ? 80 : LINE_PAUSE;
      const id = setTimeout(() => {
        setVisibleLines(prev => [...prev, line]);
        setCurrentLineText('');
        setCharIdx(0);
        setLineIdx(i => i + 1);
      }, pause);
      return () => clearTimeout(id);
    }
  }, [lineIdx, charIdx]);

  const currentLine = lineIdx < CODE_LINES.length ? CODE_LINES[lineIdx] : null;
  const startIdx = Math.max(0, visibleLines.length - 22);

  return (
    <div className="flex gap-3 font-mono text-[9.5px] overflow-hidden h-full">
      {/* Line Numbers Gutter */}
      <div className="flex flex-col text-zinc-500 dark:text-zinc-600 select-none text-right min-w-[14px] border-r border-gray-200/10 dark:border-white/5 pr-2">
        {Array.from({ length: CODE_LINES.length }).map((_, idx) => (
          <div key={idx} className="leading-[1.7] opacity-50">
            {idx + 1}
          </div>
        ))}
      </div>

      {/* Code Panel */}
      <div className="flex-1 overflow-hidden">
        {visibleLines.slice(startIdx).map((line, i) => (
          <div
            key={startIdx + i}
            className={`${line.color} whitespace-pre leading-[1.7] opacity-85`}
          >
            {line.text === '' ? '\u00A0' : INDENT.repeat(line.indent) + line.text}
          </div>
        ))}
        {currentLine && (
          <div className={`${currentLine.color} whitespace-pre leading-[1.7]`}>
            {currentLineText}
            <span
              className={`inline-block w-[5px] h-[10px] bg-blue-400 ml-[1px] align-middle transition-opacity duration-75 ${showCursor ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
