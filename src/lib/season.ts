import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from './firebase'

export type ResolvedSeason = {
  id: string
  name: string
  mode: 'active' | 'fallback'
}

function toMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const dateValue = value.toDate()
    if (dateValue instanceof Date) return dateValue.getTime()
  }
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

export async function resolveSeasonForClient(): Promise<ResolvedSeason> {
  const seasonsRef = collection(db, 'seasons')
  const activeSeasonQuery = query(seasonsRef, where('isActive', '==', true), limit(1))
  const activeSnapshot = await getDocs(activeSeasonQuery)

  if (!activeSnapshot.empty) {
    const activeDoc = activeSnapshot.docs[0]
    const activeData = activeDoc.data()
    return {
      id: activeDoc.id,
      name: (activeData.name as string | undefined) ?? activeDoc.id,
      mode: 'active',
    }
  }

  const allSnapshot = await getDocs(seasonsRef)
  if (allSnapshot.empty) {
    throw new Error('No season found. Create a seasons/{seasonId} document first.')
  }

  const ranked = allSnapshot.docs
    .map((seasonDoc) => {
      const data = seasonDoc.data()
      const yearRaw = data.year
      const year = typeof yearRaw === 'number' ? yearRaw : Number(yearRaw ?? 0)
      const createdAt = toMillis(data.createdAt)

      return {
        id: seasonDoc.id,
        name: (data.name as string | undefined) ?? seasonDoc.id,
        year: Number.isFinite(year) ? year : 0,
        createdAt,
      }
    })
    .sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
      return b.id.localeCompare(a.id)
    })

  return {
    id: ranked[0].id,
    name: ranked[0].name,
    mode: 'fallback',
  }
}
