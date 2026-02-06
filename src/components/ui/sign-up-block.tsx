import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface SignUpFormData {
  email: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  general?: string;
}

export default function SignUpBlock({ onSuccess, onSwitchToSignIn }: { onSuccess?: () => void; onSwitchToSignIn?: () => void }) {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [formData, setFormData] = useState<SignUpFormData>({
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof SignUpFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);
    setErrors({});
    setSuccessMessage(null);

    try {
      const { data } = await signUp(formData.email, formData.password);
      if (data?.user?.identities?.length === 0) {
        setErrors({ general: 'An account with this email already exists. Try signing in.' });
        return;
      }
      if (data?.user?.confirmation_sent_at) {
        setSuccessMessage('Check your email to confirm your account. You can sign in after confirmation.');
      } else {
        setSuccessMessage('Account created! Redirecting...');
        onSuccess?.();
        setTimeout(() => navigate('/dashboard', { replace: true }), 500);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign up failed';
      setErrors({ general: message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto bg-white border border-gray-200 rounded-2xl shadow-lg p-6 sm:p-8">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Create Account</h2>
        <p className="text-sm text-gray-500 mt-1">Sign up to get started with Cybertect</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {errors.general && (
          <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
            {errors.general}
          </div>
        )}
        {successMessage && (
          <div className="p-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg">
            {successMessage}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="signup-email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="signup-email"
            type="email"
            placeholder="john.doe@example.com"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            disabled={isLoading}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent disabled:opacity-50"
          />
          {errors.email && <p className="text-sm text-red-600">{errors.email}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="signup-password" className="text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="signup-password"
            type="password"
            placeholder="At least 6 characters"
            value={formData.password}
            onChange={(e) => handleInputChange('password', e.target.value)}
            disabled={isLoading}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent disabled:opacity-50"
          />
          {errors.password && <p className="text-sm text-red-600">{errors.password}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="signup-confirm" className="text-sm font-medium text-gray-700">
            Confirm Password
          </label>
          <input
            id="signup-confirm"
            type="password"
            placeholder="Confirm your password"
            value={formData.confirmPassword}
            onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
            disabled={isLoading}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent disabled:opacity-50"
          />
          {errors.confirmPassword && <p className="text-sm text-red-600">{errors.confirmPassword}</p>}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 px-4 bg-[#2563EB] hover:bg-[#1d4ed8] text-white font-medium rounded-xl transition disabled:opacity-50"
        >
          {isLoading ? 'Creating account...' : 'Sign Up'}
        </button>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToSignIn}
            className="text-[#2563EB] font-medium hover:underline"
          >
            Sign In
          </button>
        </p>
      </form>
    </div>
  );
}
