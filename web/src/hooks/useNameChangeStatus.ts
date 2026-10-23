'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { NameChangeStatus, parseNameChangeStatus } from '@/lib/nameChangeRules';

/** How many display-name changes the signed-in account has left (my_name_change_status, migration 0075). `null` = unknown (not signed in,
 *  offline, or the migration is not applied yet): the screen then shows no counter and the database stays the only enforcement. */
export function useNameChangeStatus(enabled: boolean) {
  const [status, setStatus] = useState<NameChangeStatus | null>(null);
  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_name_change_status');
    setStatus(error ? null : parseNameChangeStatus(data));
  }, []);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);
  return { status, reload };
}
