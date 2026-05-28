import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// ── Generic hook factory ───────────────────────────────────────────────────────
function useTable(table, orderCol = 'created_at', orderAsc = false) {
  const { user } = useAuth()
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const fetch = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data: rows, error: err } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', user.id)
      .order(orderCol, { ascending: orderAsc })
    if (err) setError(err.message)
    else setData(rows || [])
    setLoading(false)
  }, [user, table, orderCol, orderAsc])

  useEffect(() => { fetch() }, [fetch])

  const insert = async (row) => {
    const { data: inserted, error: err } = await supabase
      .from(table)
      .insert({ ...row, user_id: user.id })
      .select()
      .single()
    if (err) throw err
    setData(prev => [inserted, ...prev])
    return inserted
  }

  const update = async (id, updates) => {
    const { data: updated, error: err } = await supabase
      .from(table)
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()
    if (err) throw err
    setData(prev => prev.map(r => r.id === id ? updated : r))
    return updated
  }

  const remove = async (id) => {
    const { error: err } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
    if (err) throw err
    setData(prev => prev.filter(r => r.id !== id))
  }

  return { data, loading, error, refetch: fetch, insert, update, remove }
}

// ── Table-specific hooks ───────────────────────────────────────────────────────
export const useMachines      = () => useTable('machines',    'created_at', false)
export const useHerds         = () => useTable('herds',       'created_at', false)
export const useGrazingPlans  = () => useTable('grazing_plans','created_at', false)
export const useSchedules     = () => useTable('schedules',   'date',       false)
export const useDailyRecs     = () => useTable('daily_recommendations', 'date', false)
export const useForageInventory = () => useTable('forage_inventory', 'created_at', false)
export const useCameraConnections = () => useTable('camera_connections', 'created_at', false)

// ── Field positions (one per machine, unique) ─────────────────────────────────
export function useFieldPositions() {
  const { user } = useAuth()
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase.from('field_positions').select('*').eq('user_id', user.id)
      .then(({ data: rows }) => { setData(rows || []); setLoading(false) })
  }, [user])

  const upsert = async (machineId, updates) => {
    const existing = data.find(p => p.machine_id === machineId)
    if (existing) {
      const { data: updated } = await supabase.from('field_positions')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('machine_id', machineId).select().single()
      setData(prev => prev.map(p => p.machine_id === machineId ? updated : p))
      return updated
    } else {
      const { data: inserted } = await supabase.from('field_positions')
        .insert({ ...updates, machine_id: machineId, user_id: user.id }).select().single()
      setData(prev => [...prev, inserted])
      return inserted
    }
  }

  return { data, loading, upsert }
}

// ── Passes (belong to a plan) ─────────────────────────────────────────────────
export function usePasses(planId) {
  const { user } = useAuth()
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !planId) return
    setLoading(true)
    supabase.from('passes').select('*').eq('plan_id', planId).eq('user_id', user.id)
      .order('pass_number', { ascending: true })
      .then(({ data: rows }) => { setData(rows || []); setLoading(false) })
  }, [user, planId])

  const insert = async (row) => {
    const { data: inserted, error } = await supabase.from('passes')
      .insert({ ...row, user_id: user.id, plan_id: planId }).select().single()
    if (error) throw error
    setData(prev => [...prev, inserted].sort((a,b) => a.pass_number - b.pass_number))
    return inserted
  }

  const update = async (id, updates) => {
    const { data: updated, error } = await supabase.from('passes')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    setData(prev => prev.map(p => p.id === id ? updated : p))
    return updated
  }

  const remove = async (id) => {
    const { error } = await supabase.from('passes').delete().eq('id', id)
    if (error) throw error
    setData(prev => prev.filter(p => p.id !== id))
  }

  return { data, loading, insert, update, remove }
}

// ── Observations ──────────────────────────────────────────────────────────────
export function useObservations(filters = {}) {
  const { user } = useAuth()
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    let query = supabase.from('observations').select('*').eq('user_id', user.id)
    if (filters.plan_id)     query = query.eq('plan_id', filters.plan_id)
    if (filters.pass_id)     query = query.eq('pass_id', filters.pass_id)
    if (filters.machine_id)  query = query.eq('machine_id', filters.machine_id)
    if (filters.photo_type)  query = query.eq('photo_type', filters.photo_type)
    query.order('created_at', { ascending: false })
      .then(({ data: rows }) => { setData(rows || []); setLoading(false) })
  }, [user, JSON.stringify(filters)])

  const insert = async (row) => {
    const { data: inserted, error } = await supabase.from('observations')
      .insert({ ...row, user_id: user.id }).select().single()
    if (error) throw error
    setData(prev => [inserted, ...prev])
    return inserted
  }

  const update = async (id, updates) => {
    const { data: updated, error } = await supabase.from('observations')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    setData(prev => prev.map(r => r.id === id ? updated : r))
    return updated
  }

  return { data, loading, insert, update }
}

// ── Photo upload to Supabase Storage ──────────────────────────────────────────
export async function uploadPhoto(userId, file) {
  const ext  = file.name.split('.').pop()
  const path = `${userId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('grazing-photos')
    .upload(path, file, { contentType: file.type })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('grazing-photos').getPublicUrl(path)
  return { path, url: publicUrl }
}

// ── App settings ──────────────────────────────────────────────────────────────
export function useAppSettings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!user) return
    supabase.from('app_settings').select('*').eq('user_id', user.id).single()
      .then(({ data }) => { setSettings(data); setLoading(false) })
  }, [user])

  const save = async (updates) => {
    const row = { ...updates, user_id: user.id, updated_at: new Date().toISOString() }
    const { data, error } = await supabase.from('app_settings')
      .upsert(row, { onConflict: 'user_id' }).select().single()
    if (error) throw error
    setSettings(data)
    return data
  }

  return { settings, loading, save }
}

// ── Weather data ──────────────────────────────────────────────────────────────
export function useWeatherData(machineId) {
  const { user } = useAuth()
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !machineId) return
    supabase.from('weather_data')
      .select('*')
      .eq('user_id', user.id)
      .eq('machine_id', machineId)
      .order('recorded_at', { ascending: false })
      .limit(48) // last 48 hours
      .then(({ data: rows }) => { setData(rows || []); setLoading(false) })
  }, [user, machineId])

  const insert = async (row) => {
    const { data: inserted, error } = await supabase.from('weather_data')
      .insert({ ...row, user_id: user.id }).select().single()
    if (error) throw error
    setData(prev => [inserted, ...prev])
    return inserted
  }

  const latest = data[0] || null
  return { data, latest, loading, insert }
}

// ── Field growth model ────────────────────────────────────────────────────────
export function useFieldGrowthModel(machineId) {
  const { user } = useAuth()
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !machineId) return
    supabase.from('field_growth_model')
      .select('*')
      .eq('user_id', user.id)
      .eq('machine_id', machineId)
      .order('grazed_date', { ascending: false })
      .then(({ data: rows }) => { setData(rows || []); setLoading(false) })
  }, [user, machineId])

  const insert = async (row) => {
    const { data: inserted, error } = await supabase.from('field_growth_model')
      .insert({ ...row, user_id: user.id }).select().single()
    if (error) throw error
    setData(prev => [inserted, ...prev])
    return inserted
  }

  const update = async (id, updates) => {
    const { data: updated, error } = await supabase.from('field_growth_model')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    setData(prev => prev.map(r => r.id === id ? updated : r))
    return updated
  }

  return { data, loading, insert, update }
}

// ── Camera events ─────────────────────────────────────────────────────────────
export function useCameraEvents(machineId, dateFilter) {
  const { user } = useAuth()
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !machineId) return
    let query = supabase.from('camera_events')
      .select('*')
      .eq('user_id', user.id)
      .eq('machine_id', machineId)
      .order('captured_at', { ascending: false })
    if (dateFilter) query = query.gte('captured_at', dateFilter + 'T00:00:00')
    query.then(({ data: rows }) => { setData(rows || []); setLoading(false) })
  }, [user, machineId, dateFilter])

  const insert = async (row) => {
    const { data: inserted, error } = await supabase.from('camera_events')
      .insert({ ...row, user_id: user.id }).select().single()
    if (error) throw error
    setData(prev => [inserted, ...prev])
    return inserted
  }

  return { data, loading, insert }
}

// ── Daily inventory ───────────────────────────────────────────────────────────
export function useDailyInventory(machineId) {
  const { user } = useAuth()
  const [data, setData]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !machineId) return
    supabase.from('daily_inventory')
      .select('*')
      .eq('user_id', user.id)
      .eq('machine_id', machineId)
      .order('date', { ascending: false })
      .limit(30)
      .then(({ data: rows }) => { setData(rows || []); setLoading(false) })
  }, [user, machineId])

  const upsertToday = async (machineId, planId, updates) => {
    const today = new Date().toISOString().slice(0, 10)
    const existing = data.find(d => d.date === today)
    if (existing) {
      const { data: updated } = await supabase.from('daily_inventory')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single()
      setData(prev => prev.map(d => d.id === existing.id ? updated : d))
      return updated
    } else {
      const { data: inserted } = await supabase.from('daily_inventory')
        .insert({ ...updates, machine_id: machineId, plan_id: planId, date: today, user_id: user.id })
        .select().single()
      setData(prev => [inserted, ...prev])
      return inserted
    }
  }

  const today = data.find(d => d.date === new Date().toISOString().slice(0, 10))
  return { data, today, loading, upsertToday }
}
