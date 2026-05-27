import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// ── Generic hook factory ───────────────────────────────────────────────────
function useTable(table, orderCol = 'created_at') {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetch = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data: rows, error: err } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', user.id)
      .order(orderCol, { ascending: false })
    if (err) setError(err.message)
    else setData(rows || [])
    setLoading(false)
  }, [user, table, orderCol])

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

// ── Table-specific hooks ───────────────────────────────────────────────────
export const useMachines    = () => useTable('machines',  'created_at')
export const useHerds       = () => useTable('herds',     'created_at')
export const useSchedules   = () => useTable('schedules', 'date')

export function useRotations() {
  const base = useTable('rotations', 'created_at')
  return base
}

export function useObservations(rotationId) {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !rotationId) return
    setLoading(true)
    supabase
      .from('observations')
      .select('*')
      .eq('rotation_id', rotationId)
      .order('created_at', { ascending: false })
      .then(({ data: rows }) => {
        setData(rows || [])
        setLoading(false)
      })
  }, [user, rotationId])

  const insert = async (row) => {
    const { data: inserted, error } = await supabase
      .from('observations')
      .insert({ ...row, user_id: user.id, rotation_id: rotationId })
      .select()
      .single()
    if (error) throw error
    setData(prev => [inserted, ...prev])
    return inserted
  }

  const update = async (id, updates) => {
    const { data: updated, error } = await supabase
      .from('observations')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setData(prev => prev.map(r => r.id === id ? updated : r))
    return updated
  }

  return { data, loading, insert, update }
}

// ── Photo upload to Supabase Storage ──────────────────────────────────────
export async function uploadPhoto(userId, file) {
  const ext = file.name.split('.').pop()
  const path = `${userId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('grazing-photos')
    .upload(path, file, { contentType: file.type })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage
    .from('grazing-photos')
    .getPublicUrl(path)
  return { path, url: publicUrl }
}
