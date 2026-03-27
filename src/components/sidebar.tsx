'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  Package,
  Users,
  BarChart3,
  Upload,
  MessageSquare,
  Bell,
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Plus,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Organization, Product, Cohort } from '@/types/database'

interface SidebarProps {
  user: { id: string; email: string; name: string }
  organization: Organization | null
}

export function Sidebar({ user, organization }: SidebarProps) {
  const [products, setProducts] = useState<(Product & { cohorts: Cohort[] })[]>([])
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  useEffect(() => {
    if (!organization) return

    async function loadProducts() {
      const { data: prods } = await supabase
        .from('products')
        .select('*')
        .eq('org_id', organization!.id)
        .order('created_at', { ascending: false })

      if (!prods) return

      const productsWithCohorts = await Promise.all(
        prods.map(async (prod) => {
          const { data: cohorts } = await supabase
            .from('cohorts')
            .select('*')
            .eq('product_id', prod.id)
            .order('created_at', { ascending: false })
          return { ...prod, cohorts: cohorts || [] }
        })
      )

      setProducts(productsWithCohorts)
      // Auto-expand first product
      if (productsWithCohorts.length > 0) {
        setExpandedProducts(new Set([productsWithCohorts[0].id]))
      }
    }

    loadProducts()
  }, [organization])

  function toggleProduct(productId: string) {
    setExpandedProducts((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const statusColors: Record<string, string> = {
    planning: 'bg-gray-300',
    capturing: 'bg-blue-400',
    live: 'bg-emerald-400',
    selling: 'bg-amber-400',
    closed: 'bg-gray-400',
  }

  return (
    <aside className={cn(
      'flex flex-col h-screen bg-gray-900 text-gray-300 transition-all duration-200',
      collapsed ? 'w-16' : 'w-64'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-gray-800">
        {!collapsed && (
          <Link href="/" className="text-lg font-bold text-white tracking-tight">
            Pegasus
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-gray-800 text-gray-400"
        >
          <Layers className="w-4 h-4" />
        </button>
      </div>

      {/* Organization */}
      {!collapsed && organization && (
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Organização</p>
          <p className="text-sm font-medium text-white truncate">{organization.name}</p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        {!collapsed && (
          <>
            {/* Main nav */}
            <div className="px-3 mb-4">
              <NavItem href="/" icon={LayoutDashboard} label="Dashboard" active={pathname === '/'} />
              <NavItem href="/alerts" icon={Bell} label="Alertas" active={pathname === '/alerts'} />
              <NavItem href="/chat" icon={MessageSquare} label="Chat IA" active={pathname.startsWith('/chat')} />
            </div>

            {/* Products tree */}
            <div className="px-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Produtos</p>
                <Link
                  href="/onboarding?step=product"
                  className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Link>
              </div>

              {products.length === 0 && (
                <p className="text-xs text-gray-600 px-2 py-1">Nenhum produto ainda.</p>
              )}

              {products.map((product) => (
                <div key={product.id} className="mb-1">
                  <button
                    onClick={() => toggleProduct(product.id)}
                    className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-gray-800 transition-colors"
                  >
                    {expandedProducts.has(product.id) ? (
                      <ChevronDown className="w-3.5 h-3.5 mr-1.5 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 mr-1.5 text-gray-500" />
                    )}
                    <Package className="w-3.5 h-3.5 mr-2 text-emerald-400" />
                    <span className="truncate">{product.name}</span>
                  </button>

                  {expandedProducts.has(product.id) && (
                    <div className="ml-5 pl-2 border-l border-gray-800">
                      {product.cohorts.map((cohort) => {
                        const cohortPath = `/org/${organization?.slug}/product/${product.slug}/cohort/${cohort.slug}`
                        return (
                          <Link
                            key={cohort.id}
                            href={cohortPath}
                            className={cn(
                              'flex items-center px-2 py-1.5 text-xs rounded hover:bg-gray-800 transition-colors',
                              pathname === cohortPath && 'bg-gray-800 text-white'
                            )}
                          >
                            <span className={cn('w-2 h-2 rounded-full mr-2', statusColors[cohort.status] || 'bg-gray-500')} />
                            <span className="truncate">{cohort.name}</span>
                          </Link>
                        )
                      })}
                      <Link
                        href={`/onboarding?step=cohort&product=${product.id}`}
                        className="flex items-center px-2 py-1.5 text-xs text-gray-600 rounded hover:bg-gray-800 hover:text-gray-400 transition-colors"
                      >
                        <Plus className="w-3 h-3 mr-1.5" />
                        Nova turma
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-800 p-3">
        {!collapsed && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{user.name}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center px-2 py-2 text-sm rounded transition-colors mb-0.5',
        active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
      )}
    >
      <Icon className="w-4 h-4 mr-3" />
      {label}
    </Link>
  )
}
