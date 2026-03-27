import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()

  if (!authUser) {
    redirect('/login')
  }

  // Get user profile
  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single()

  // Get organization
  let organization = null
  if (userProfile?.org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', userProfile.org_id)
      .single()
    organization = org
  }

  // If user has no org, redirect to onboarding
  if (!userProfile || !organization) {
    redirect('/onboarding')
  }

  const sidebarUser = {
    id: authUser.id,
    email: authUser.email || '',
    name: userProfile?.name || authUser.user_metadata?.name || 'Usuário',
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar user={sidebarUser} organization={organization} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}
