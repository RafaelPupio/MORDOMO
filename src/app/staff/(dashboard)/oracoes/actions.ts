'use server';

import { revalidatePath } from 'next/cache';
import { isUuid } from '@/core/ids';
import { applyPrayerStatus } from '@/core/staff-operations';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import type { PrayerStatus } from '@/db/repo/prayer';

const VALID_STATUSES: readonly PrayerStatus[] = ['new', 'praying', 'done'];

function isPrayerStatus(value: string): value is PrayerStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

export type PrayerStatusState = { error?: string };

/**
 * Thin Server Action wrapper: `organizationId` comes ONLY from `requireStaffContext()` — never
 * from `formData` — so posting an `id` that belongs to another church cannot move that
 * church's request; `applyPrayerStatus` (src/core/staff-operations.ts) scopes the update to
 * this church and no-ops otherwise. `id` and `status` are both validated against their
 * expected shapes before anything is queried — a malformed (non-uuid) id would otherwise
 * make Postgres throw casting it to `uuid`, and the body is wrapped in try/catch for any
 * other unexpected DB failure — both return the Portuguese error shape instead of an
 * uncaught rejection reaching the client as a Next.js error digest (I1).
 */
export async function updatePrayerStatus(
  _prevState: PrayerStatusState,
  formData: FormData,
): Promise<PrayerStatusState> {
  const { organizationId } = await requireStaffContext();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!isUuid(id)) return { error: 'Pedido de oração inválido.' };
  if (!isPrayerStatus(status)) return { error: 'Status inválido.' };

  try {
    await applyPrayerStatus(getDb(), organizationId, id, status);
    revalidatePath('/staff/oracoes');
    return {};
  } catch (error) {
    console.error('updatePrayerStatus: unexpected failure', { organizationId, id, status, error });
    return { error: 'Não foi possível atualizar o pedido agora. Tente novamente.' };
  }
}
