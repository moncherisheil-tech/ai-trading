'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { logout } from '@/app/actions';

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 transition-colors"
      aria-label="Log out"
    >
      <LogOut className="w-4 h-4" />
      Logout
    </button>
  );
}
