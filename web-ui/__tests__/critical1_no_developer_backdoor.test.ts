/**
 * CRITICAL-1 Regression Test — Developer Backdoor Removal
 *
 * Verifies that the hardcoded admin/admin developer authentication
 * backdoor has been fully removed and cannot be accidentally
 * reintroduced. This is a source-level regression test because the
 * original backdoor was entirely client-side (no server-side auth
 * was involved).
 *
 * Invariants tested:
 * 1. HitlWorkspace does not contain handleDeveloperLogin or handleDeveloperLogout
 * 2. HitlWorkspace does not contain developerUsername / developerPassword state
 * 3. HitlWorkspace does not contain isDeveloper state
 * 4. AuthModal.tsx is deleted (file does not exist)
 * 5. CadViewport does not accept an isDeveloper prop
 * 6. ChatPanel does not accept an onOpenAuthModal prop
 * 7. The dead NEXT_PUBLIC_DEVELOPER_ACCESS_* env vars are not documented in
 *    .env.example, and no live source file references them (finding 3 of
 *    the 2026-09-22 remediation: the backdoor above was already removed,
 *    but the unused config that used to back it was left behind).
 */

import * as fs from 'fs';
import * as path from 'path';

const WEB_UI = path.resolve(__dirname, '..');

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(WEB_UI, relativePath), 'utf-8');
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(WEB_UI, relativePath));
}

describe('CRITICAL-1 — Developer backdoor removal', () => {
  let hitlSource: string;
  let cadViewportSource: string;
  let chatPanelSource: string;

  beforeAll(() => {
    hitlSource = readFile('components/workspace/HitlWorkspace.tsx');
    cadViewportSource = readFile('components/viewport/CadViewport.tsx');
    chatPanelSource = readFile('components/chat/ChatPanel.tsx');
  });

  // ── 1. AuthModal.tsx is deleted ─────────────────────────────────────────

  it('AuthModal.tsx does not exist on disk', () => {
    expect(fileExists('components/auth/AuthModal.tsx')).toBe(false);
  });

  // ── 2. HitlWorkspace invariants ──────────────────────────────────────────

  it('HitlWorkspace does not reference handleDeveloperLogin', () => {
    expect(hitlSource).not.toContain('handleDeveloperLogin');
  });

  it('HitlWorkspace does not reference handleDeveloperLogout', () => {
    expect(hitlSource).not.toContain('handleDeveloperLogout');
  });

  it('HitlWorkspace does not declare developerUsername state', () => {
    expect(hitlSource).not.toMatch(/useState.*developerUsername/);
    expect(hitlSource).not.toContain("''developerUsername'");
  });

  it('HitlWorkspace does not declare developerPassword state', () => {
    expect(hitlSource).not.toMatch(/useState.*developerPassword/);
  });

  it('HitlWorkspace does not declare isDeveloper state', () => {
    expect(hitlSource).not.toMatch(/useState.*isDeveloper/);
  });

  it('HitlWorkspace does not import AuthModal', () => {
    expect(hitlSource).not.toContain("import { AuthModal }");
    expect(hitlSource).not.toContain("from '@/components/auth/AuthModal'");
    expect(hitlSource).not.toContain('from "../auth/AuthModal"');
  });

  it('HitlWorkspace does not render AuthModal', () => {
    expect(hitlSource).not.toMatch(/<AuthModal[\s/>]/);
  });

  it('HitlWorkspace does not contain hardcoded admin/admin credential check', () => {
    expect(hitlSource).not.toContain("=== 'admin' && developerPassword === 'admin'");
  });

  // ── 3. CadViewport invariants ────────────────────────────────────────────

  it('CadViewport does not accept isDeveloper prop', () => {
    expect(cadViewportSource).not.toContain('isDeveloper');
  });

  // ── 4. ChatPanel invariants ──────────────────────────────────────────────

  it('ChatPanel does not accept onOpenAuthModal prop', () => {
    expect(chatPanelSource).not.toContain('onOpenAuthModal');
  });

  // ── 5. Dead NEXT_PUBLIC_DEVELOPER_ACCESS_* config ────────────────────────

  it('.env.example does not document NEXT_PUBLIC_DEVELOPER_ACCESS_* vars', () => {
    const envExample = readFile('.env.example');
    expect(envExample).not.toContain('NEXT_PUBLIC_DEVELOPER_ACCESS_USERNAME');
    expect(envExample).not.toContain('NEXT_PUBLIC_DEVELOPER_ACCESS_PASSWORD');
  });

  it('no source file references NEXT_PUBLIC_DEVELOPER_ACCESS_*', () => {
    const roots = ['app', 'components', 'lib'];
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const contents = fs.readFileSync(full, 'utf-8');
          if (contents.includes('DEVELOPER_ACCESS')) offenders.push(full);
        }
      }
    }

    for (const root of roots) {
      const full = path.join(WEB_UI, root);
      if (fs.existsSync(full)) walk(full);
    }

    expect(offenders).toEqual([]);
  });
});
