import { FC } from 'react';
import { useSearchParams, useNavigate } from 'react-router';

export const AuthFailurePage: FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const errorMessage = searchParams.get('error_message') || 'Authentication failed';

  const handleRetry = () => {
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-parchment px-4 font-serif text-stone-800">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-paper px-8 py-10 text-center shadow-[0_20px_60px_rgba(28,25,23,0.12)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v3m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-stone-900">
          Sign-in failed
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-stone-500">{errorMessage}</p>
        <button
          onClick={handleRetry}
          className="mt-8 w-full rounded-full bg-stone-900 px-6 py-3.5 text-[15px] font-medium text-stone-50 shadow-[0_4px_20px_rgba(28,25,23,0.2)] transition-all hover:-translate-y-0.5 hover:bg-stone-700 hover:shadow-[0_10px_30px_rgba(28,25,23,0.28)]"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
};
