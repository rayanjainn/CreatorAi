import {
  BarChart3,
  Bot,
  Clapperboard,
  FolderKanban,
  FolderOpen,
  Gauge,
  Home,
  KanbanSquare,
  Repeat2,
  Activity,
  Settings,
  Sparkles,
  SplitSquareHorizontal,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  label: string
  href: string
  Icon: LucideIcon
  /** "Soon" pill: the backend for this feature is not built yet. */
  soon?: boolean
}
export type NavGroup = { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: 'Create',
    items: [
      { label: 'Dashboard', href: '/dashboard', Icon: Home },
      { label: 'Projects', href: '/projects', Icon: FolderKanban },
      { label: 'Content Board', href: '/calendar', Icon: KanbanSquare },
      { label: 'Asset Library', href: '/assets', Icon: FolderOpen },
    ],
  },
  {
    label: 'AI tools',
    items: [
      { label: 'AI Studio', href: '/ai-studio', Icon: Sparkles },
      { label: 'Creative Director', href: '/creative-director', Icon: Bot },
      { label: 'Script Match', href: '/script-match', Icon: SplitSquareHorizontal },
      { label: 'Smart Clips', href: '/smart-clips', Icon: Clapperboard },
      { label: 'Repurpose', href: '/repurpose', Icon: Repeat2 },
    ],
  },
  {
    label: 'Grow',
    items: [
      { label: 'Insights', href: '/analytics', Icon: BarChart3 },
      { label: 'Creative Twin', href: '/creative-twin', Icon: Gauge },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Jobs & Activity', href: '/jobs', Icon: Activity },
      { label: 'Settings', href: '/settings', Icon: Settings },
    ],
  },
]

/** Breadcrumb titles for known routes (first path segment). */
export const ROUTE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  calendar: 'Content Board',
  assets: 'Asset Library',
  search: 'Search',
  'ai-studio': 'AI Studio',
  'creative-director': 'Creative Director',
  'script-match': 'Script Match',
  'smart-clips': 'Smart Clips',
  repurpose: 'Repurpose',
  analytics: 'Insights',
  'creative-twin': 'Creative Twin',
  jobs: 'Jobs & Activity',
  settings: 'Settings',
  editor: 'Editor',
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}
