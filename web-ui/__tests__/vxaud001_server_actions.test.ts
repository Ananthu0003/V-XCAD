/**
 * VXAUD-001 Regression Tests — Unauthenticated Server Actions
 *
 * Verifies that all 6 server actions in app/tools/actions.ts and
 * app/holders/actions.ts require admin authentication before performing
 * any Prisma mutation.
 */

// ── Mock next/cache ────────────────────────────────────────────────────────
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

// ── Mock auth ──────────────────────────────────────────────────────────────
const mockRequireAdmin = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── Mock prisma ────────────────────────────────────────────────────────────
const mockToolUpdate = jest.fn();
const mockToolDelete = jest.fn();
const mockHolderUpdate = jest.fn();
const mockHolderCreate = jest.fn();
const mockHolderDelete = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    tool: {
      update: (...args: unknown[]) => mockToolUpdate(...args),
      delete: (...args: unknown[]) => mockToolDelete(...args),
    },
    holder: {
      update: (...args: unknown[]) => mockHolderUpdate(...args),
      create: (...args: unknown[]) => mockHolderCreate(...args),
      delete: (...args: unknown[]) => mockHolderDelete(...args),
    },
  },
}));

// ── Import server actions ──────────────────────────────────────────────────
import {
  toggleToolStatus,
  deleteTool,
} from '@/app/tools/actions';
import {
  toggleHolderStatus,
  createHolder,
  updateHolder,
  deleteHolder,
} from '@/app/holders/actions';
import { revalidatePath } from 'next/cache';

// ── Reset ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1-6. Unauthenticated calls → rejected, NO Prisma mutation
// ═══════════════════════════════════════════════════════════════════════════

describe('VXAUD-001 — Unauthenticated server actions rejected', () => {
  it('1. toggleToolStatus unauthenticated → rejected', async () => {
    await expect(toggleToolStatus('tool-1', false)).rejects.toThrow('Unauthorized');
    expect(mockToolUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('2. deleteTool unauthenticated → rejected', async () => {
    const result = await deleteTool('tool-1');
    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockToolDelete).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('3. toggleHolderStatus unauthenticated → rejected', async () => {
    await expect(toggleHolderStatus('holder-1', false)).rejects.toThrow('Unauthorized');
    expect(mockHolderUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('4. createHolder unauthenticated → rejected', async () => {
    const result = await createHolder({ name: 'Test' });
    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockHolderCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('5. updateHolder unauthenticated → rejected', async () => {
    const result = await updateHolder('holder-1', { name: 'Updated' });
    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockHolderUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('6. deleteHolder unauthenticated → rejected', async () => {
    const result = await deleteHolder('holder-1');
    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockHolderDelete).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7-10. Authenticated non-admin → rejected, NO Prisma mutation
// ═══════════════════════════════════════════════════════════════════════════

describe('VXAUD-001 — Authenticated non-admin rejected', () => {
  beforeEach(() => {
    mockRequireAdmin.mockResolvedValue(null);
  });

  it('7. toggleToolStatus non-admin → rejected', async () => {
    await expect(toggleToolStatus('tool-1', false)).rejects.toThrow('Unauthorized');
    expect(mockToolUpdate).not.toHaveBeenCalled();
  });

  it('8. deleteTool non-admin → rejected', async () => {
    const result = await deleteTool('tool-1');
    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockToolDelete).not.toHaveBeenCalled();
  });

  it('9. toggleHolderStatus non-admin → rejected', async () => {
    await expect(toggleHolderStatus('holder-1', false)).rejects.toThrow('Unauthorized');
    expect(mockHolderUpdate).not.toHaveBeenCalled();
  });

  it('10. createHolder non-admin → rejected', async () => {
    const result = await createHolder({ name: 'Test' });
    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockHolderCreate).not.toHaveBeenCalled();
  });

  it('10b. updateHolder non-admin → rejected', async () => {
    const result = await updateHolder('holder-1', { name: 'Updated' });
    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockHolderUpdate).not.toHaveBeenCalled();
  });

  it('10c. deleteHolder non-admin → rejected', async () => {
    const result = await deleteHolder('holder-1');
    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockHolderDelete).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11-15. Authorized admin → succeeds, Prisma mutation IS reached
// ═══════════════════════════════════════════════════════════════════════════

describe('VXAUD-001 — Authorized admin succeeds', () => {
  beforeEach(() => {
    mockRequireAdmin.mockResolvedValue('admin-user-id');
    mockToolUpdate.mockResolvedValue({ id: 'tool-1', isActive: true });
    mockToolDelete.mockResolvedValue({ id: 'tool-1' });
    mockHolderUpdate.mockResolvedValue({ id: 'holder-1', isActive: true });
    mockHolderCreate.mockResolvedValue({ id: 'new-holder', name: 'Test Holder' });
    mockHolderDelete.mockResolvedValue({ id: 'holder-1' });
  });

  it('11. admin toggleToolStatus → succeeds', async () => {
    await toggleToolStatus('tool-1', false);
    expect(mockToolUpdate).toHaveBeenCalledWith({
      where: { id: 'tool-1' },
      data: { isActive: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/tools/tool-1');
    expect(revalidatePath).toHaveBeenCalledWith('/tools');
  });

  it('12. admin deleteTool → succeeds', async () => {
    const result = await deleteTool('tool-1');
    expect(result).toEqual({ success: true });
    expect(mockToolDelete).toHaveBeenCalledWith({ where: { id: 'tool-1' } });
    expect(revalidatePath).toHaveBeenCalledWith('/tools');
  });

  it('13. admin createHolder → succeeds', async () => {
    const holderData = { name: 'New Holder', type: 'ER_COLLET' };
    const result = await createHolder(holderData);
    expect(result).toEqual({ success: true, id: 'new-holder' });
    expect(mockHolderCreate).toHaveBeenCalledWith({ data: holderData });
    expect(revalidatePath).toHaveBeenCalledWith('/holders');
  });

  it('14. admin updateHolder → succeeds', async () => {
    const updateData = { name: 'Updated Holder' };
    const result = await updateHolder('holder-1', updateData);
    expect(result).toEqual({ success: true });
    expect(mockHolderUpdate).toHaveBeenCalledWith({
      where: { id: 'holder-1' },
      data: updateData,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/holders');
    expect(revalidatePath).toHaveBeenCalledWith('/holders/holder-1');
  });

  it('15. admin deleteHolder → succeeds', async () => {
    const result = await deleteHolder('holder-1');
    expect(result).toEqual({ success: true });
    expect(mockHolderDelete).toHaveBeenCalledWith({ where: { id: 'holder-1' } });
    expect(revalidatePath).toHaveBeenCalledWith('/holders');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases — rejected auth does NOT reach Prisma
// ═══════════════════════════════════════════════════════════════════════════

describe('VXAUD-001 — Rejected requests never reach database', () => {
  it('unauthenticated toggleToolStatus does not call prisma.tool.update', async () => {
    await expect(toggleToolStatus('any-id', true)).rejects.toThrow();
    expect(mockToolUpdate).toHaveBeenCalledTimes(0);
  });

  it('non-admin deleteTool does not call prisma.tool.delete', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    await deleteTool('any-id');
    expect(mockToolDelete).toHaveBeenCalledTimes(0);
  });

  it('unauthenticated createHolder does not call prisma.holder.create', async () => {
    await createHolder({ name: 'x' });
    expect(mockHolderCreate).toHaveBeenCalledTimes(0);
  });

  it('non-admin updateHolder does not call prisma.holder.update', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    await updateHolder('any-id', { name: 'x' });
    expect(mockHolderUpdate).toHaveBeenCalledTimes(0);
  });

  it('unauthenticated deleteHolder does not call prisma.holder.delete', async () => {
    await deleteHolder('any-id');
    expect(mockHolderDelete).toHaveBeenCalledTimes(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Existing behavior preserved — errors still returned to client
// ═══════════════════════════════════════════════════════════════════════════

describe('VXAUD-001 — Existing error handling preserved for admin callers', () => {
  beforeEach(() => {
    mockRequireAdmin.mockResolvedValue('admin-user-id');
  });

  it('deleteTool handles DB constraint error gracefully', async () => {
    mockToolDelete.mockRejectedValue(new Error('Foreign key constraint failed'));
    const result = await deleteTool('tool-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot delete this tool');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('createHolder handles non-P2002 error gracefully', async () => {
    mockHolderCreate.mockRejectedValue(new Error('Connection timeout'));
    const result = await createHolder({ name: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to create holder');
  });

  it('updateHolder handles non-P2002 error gracefully', async () => {
    mockHolderUpdate.mockRejectedValue(new Error('Connection timeout'));
    const result = await updateHolder('holder-1', { name: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to update holder');
  });

  it('deleteHolder handles DB constraint error gracefully', async () => {
    mockHolderDelete.mockRejectedValue(new Error('Foreign key constraint failed'));
    const result = await deleteHolder('holder-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot delete this holder');
  });
});
