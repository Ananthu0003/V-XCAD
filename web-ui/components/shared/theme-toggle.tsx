"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

export function ThemeToggle({ className }: { className?: string } = {}) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <button
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className={`inline-flex items-center justify-center size-11 rounded-full bg-slate-50/90 dark:bg-[#0b1220]/90 border border-slate-200/80 dark:border-white/10 shadow-md text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-[#111c33] hover:border-cyan-500/50 transition-all focus:outline-none cursor-pointer ${className || ''}`}
      aria-label="Toggle theme"
    >
      {theme === "light" ? (
        <Moon className="size-5" />
      ) : (
        <Sun className="size-5" />
      )}
    </button>
  )
}
