import { ViewerAppShell } from '@/components/ui/AppShell'

export default function SectionLayout({ children }: { children: React.ReactNode }) {
  return <ViewerAppShell>{children}</ViewerAppShell>
}
