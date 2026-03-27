'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type SecureSecretInputProps = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  dir?: 'ltr' | 'rtl';
  className?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  inputClassName?: string;
};

const defaultInputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 tabular-nums focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 pe-11 font-mono';

export default function SecureSecretInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  dir = 'ltr',
  className = '',
  inputMode,
  inputClassName = defaultInputClass,
}: SecureSecretInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete="off"
        disabled={disabled}
        dir={dir}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-y-0 end-0 flex items-center justify-center px-2 text-slate-400 transition hover:text-cyan-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 rounded-e-xl"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'הסתר ערך' : 'חשוף ערך'}
      >
        {show ? <EyeOff className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
      </button>
    </div>
  );
}
