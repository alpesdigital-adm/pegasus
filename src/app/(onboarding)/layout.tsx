import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // If user already completed onboarding, redirect to dashboard
  const { data: profile } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (profile?.org_id) {
    // Check if org exists
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', profile.org_id)
      .single()

    if (org) {
      redirect('/')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      {children}
    </div>
  )
}
