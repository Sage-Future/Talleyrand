import { FC, useState } from 'react';
import { Link } from 'react-router';
import { AuthService } from '../services/authService';
import { BrandMark } from './BrandMark';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const LEGAL_LINK =
  'underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-600';

export const LoginPage: FC = () => {
  const [isLoading, setIsLoading] = useState(false);

  useDocumentTitle('Sign in');

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      await AuthService.initiateGoogleLogin();
    } catch (error) {
      console.error('Login error:', error);
      alert('Failed to initiate login. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-parchment px-4 font-serif text-stone-800">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-paper px-8 py-10 text-center shadow-[0_20px_60px_rgba(28,25,23,0.12)]">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight text-stone-900">
          <BrandMark className="text-[26px] text-orange-500" />
          Talleyrand
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-stone-500">
          Sign in to open your research workspace.
        </p>
        <button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="mt-8 flex w-full items-center justify-center gap-2.5 rounded-full bg-stone-900 px-6 py-3.5 text-[15px] font-medium text-stone-50 shadow-[0_4px_20px_rgba(28,25,23,0.2)] transition-all hover:-translate-y-0.5 hover:bg-stone-700 hover:shadow-[0_10px_30px_rgba(28,25,23,0.28)] disabled:cursor-not-allowed disabled:bg-stone-300 disabled:shadow-none disabled:hover:translate-y-0"
        >
          <svg className="icon-optical h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {isLoading ? 'Signing in…' : 'Continue with Google'}
        </button>
        <p className="mt-5 text-[12.5px] leading-relaxed text-stone-400">
          By continuing you agree to the{' '}
          <Link to="/terms" className={LEGAL_LINK}>
            terms of service
          </Link>{' '}
          and the{' '}
          <Link to="/privacy" className={LEGAL_LINK}>
            privacy policy
          </Link>
          .
        </p>
      </div>
      <p className="mt-6 text-[13px] text-stone-400">
        built by{' '}
        <a
          href="https://sage-future.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-600"
        >
          Sage
        </a>
      </p>
    </div>
  );
};
