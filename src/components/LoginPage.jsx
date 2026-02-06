import { useState } from 'react';
import { Link } from 'react-router-dom';
import SignInBlock from './ui/sign-in-block';
import SignUpBlock from './ui/sign-up-block';

export default function LoginPage() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="cybertect-logo flex items-baseline">
              <span className="cyber-text text-xl font-semibold">cyber</span>
              <span className="tect-text text-xl font-semibold">tect</span>
              <span className="com-text text-base">.com</span>
            </Link>
            <Link
              to="/"
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </header>

      {/* Tab toggle */}
      <div className="flex justify-center gap-4 pt-8">
        <button
          onClick={() => setMode('signin')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            mode === 'signin'
              ? 'bg-[#2563EB] text-white'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Sign In
        </button>
        <button
          onClick={() => setMode('signup')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            mode === 'signup'
              ? 'bg-[#2563EB] text-white'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Sign Up
        </button>
      </div>

      {/* Auth form - centered */}
      <main className="flex-1 flex items-center justify-center py-8 px-4">
        {mode === 'signin' ? (
          <SignInBlock onSwitchToSignUp={() => setMode('signup')} onSuccess={() => {}} />
        ) : (
          <SignUpBlock onSwitchToSignIn={() => setMode('signin')} />
        )}
      </main>
    </div>
  );
}
