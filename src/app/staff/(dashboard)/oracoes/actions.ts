'use server';

import { revalidatePath } from 'next/cache';
import { applyPrayerStatus } from '@/core/staff-operations';
import { requireStaffContext } from '@/core/staff-context';
import { getDb } from '@/db/client';
import type { PrayerStatus } from '@/db/repo/prayer';

const VALID_STATUSES: readonly PrayerStatus[] = ['new', 'praying', 'done'];

function isPrayerStatus(value: string): value is PrayerStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

/**
 * Thin Server Action wrapper: `churchId` comes ONLY from `requireStaffContext()` — never
 * from `formData` — so posting an `id` that belongs to another church cannot move that
 * church's request; `applyPrayerStatus` (src/core/staff-operations.ts) scopes the update to
 * this church and no-ops otherwise.
 */
export async function updatePrayerStatus(formData: FormData): Promise<void> {
  const { churchId } = await requireStaffContext();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !isPrayerStatus(status)) return;

  await applyPrayerStatus(getDb(), churchId, id, status);
  revalidatePath('/staff/oracoes');
}
