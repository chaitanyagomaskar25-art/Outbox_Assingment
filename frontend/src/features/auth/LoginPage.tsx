import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useAuth } from './AuthContext';

const GoogleMark = () => (
  <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

export const LoginPage: React.FC = () => {
  const { loginWithGoogle, loginWithEmail, signupWithEmail, googleConfigured, isLoading, user } =
    useAuth();
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      if (isSignup) {
        await signupWithEmail(name, email, password);
      } else {
        await loginWithEmail(email, password);
      }
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to authenticate. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = () => {
    setIsSignup((current) => !current);
    setErrorMessage('');
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 flex flex-col items-center justify-center">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">ReachInbox</h1>
          <p className="mt-2 text-sm text-slate-500">Email outreach, organized and on time.</p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-slate-900">
              {isSignup ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isSignup
                ? 'Sign up to start managing your email outreach.'
                : 'Sign in to manage your scheduled and sent emails.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {isSignup && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Full name</span>
                <input
                  autoComplete="name"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  required
                  value={name}
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Email address</span>
              <input
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
                type="email"
                value={email}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
              <input
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                minLength={isSignup ? 8 : 1}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'}
                required
                type="password"
                value={password}
              />
            </label>

            {errorMessage && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <Button type="submit" className="w-full py-2.5" isLoading={isSubmitting}>
              {isSignup ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-600">
            {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={switchMode}
              className="font-semibold text-indigo-600 hover:text-indigo-700"
            >
              {isSignup ? 'Sign in' : 'Create account'}
            </button>
          </p>

          {googleConfigured && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs text-slate-400">OR CONTINUE WITH</span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center gap-3 py-2.5 text-sm font-medium"
                onClick={loginWithGoogle}
                disabled={isLoading}
              >
                <GoogleMark />
                Google
              </Button>
            </>
          )}

          {!googleConfigured && (
            <p role="status" className="mt-5 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              Google sign-in is unavailable until the backend is configured with Google OAuth credentials.
            </p>
          )}

          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Your account is protected with secure authentication
          </p>
        </section>
      </div>
    </main>
  );
};
