import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

export function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      className={`rounded-full p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50 ${className}`}
    >
      {theme === 'light' ? (
        <Moon className="h-5 w-5 text-gray-600 dark:text-gray-400" strokeWidth={2} />
      ) : (
        <Sun className="h-5 w-5 text-amber-400" strokeWidth={2} />
      )}
    </button>
  );
}
