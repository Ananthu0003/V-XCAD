"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

export function ThemeToggle({ className }: { className?: string } = {}) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const isDark = (theme === "system" ? resolvedTheme : theme) === "dark"

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`inline-flex items-center justify-center size-10 rounded-full bg-[var(--ui-panel)] border border-[var(--ui-border)] shadow-md text-[var(--ui-text-primary)] hover:border-[var(--ui-accent)] hover:scale-105 active:scale-95 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--ui-accent)] cursor-pointer ${className || ''}`}
      aria-label="Toggle theme"
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {isDark ? (
        <Sun className="size-4 text-[var(--ui-accent)]" />
      ) : (
        <Moon className="size-4 text-[var(--ui-accent)]" />
      )}
    </button>
  )
}
