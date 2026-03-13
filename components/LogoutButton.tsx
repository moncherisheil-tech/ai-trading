'use client';

import { useState } from 'react';
import { LogOut, Loader2 } from 'lucide-react';
import { logout } from '@/app/actions';

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    try {
      await logout();
      window.location.href = '/login';
    } catch {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      aria-label="התנתק"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
      {loading ? 'מתנתק…' : 'התנתק'}
    </button>
  );
}
