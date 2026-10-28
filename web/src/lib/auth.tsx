import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppRole, Profile, RoleRow } from './types';
import { ROLE_ORDER } from './labels';

interface AuthValue {
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  roles: RoleRow[];
  active: RoleRow | null;
  setActive: (r: RoleRow) => void;
  has: (role: AppRole) => boolean;
  loading: boolean;
  recovery: boolean;
  clearRecovery: () => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const ACTIVE_KEY = 'simsa.activeRole';

const roleKey = (r: RoleRow) => `${r.role}:${r.prodi_id ?? ''}`;

function readStoredRole(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
function storeRole(key: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, key);
  } catch {
    /* penyimpanan tidak tersedia */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [active, setActiveState] = useState<RoleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setRoles([]);
      setActiveState(null);
      setLoading(false);
      return;
    }
    const uid = s.user.id;
    const [p, r] = await Promise.all([
      supabase.from('profiles').select('*, prodi:prodi_id(kode, nama, jenjang)').eq('id', uid).maybeSingle(),
      supabase.from('user_roles').select('role, prodi_id').eq('user_id', uid),
    ]);
    const list = ((r.data ?? []) as RoleRow[]).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    setProfile((p.data as Profile) ?? null);
    setRoles(list);
    const stored = readStoredRole();
    setActiveState(list.find((x) => roleKey(x) === stored) ?? list[0] ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      load(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // ditunda agar tidak memanggil Supabase di dalam callback auth
        setTimeout(() => load(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const setActive = useCallback((r: RoleRow) => {
    storeRole(roleKey(r));
    setActiveState(r);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      userId: session?.user.id ?? null,
      profile,
      roles,
      active,
      setActive,
      has: (role) => roles.some((r) => r.role === role),
      loading,
      recovery,
      clearRecovery: () => setRecovery(false),
      refresh: () => load(session),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, profile, roles, active, setActive, loading, recovery, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return v;
}

export { roleKey };
