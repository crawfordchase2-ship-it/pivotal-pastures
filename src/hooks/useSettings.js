import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useSettings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!user) return
    supabase.from('app_settings').select('*').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data) {
          setSettings({
            farmProfile:   data.farm_profile   ? JSON.parse(data.farm_profile)   : {},
            weatherlink:   data.weatherlink    ? JSON.parse(data.weatherlink)    : {},
            phytech:       data.phytech        ? JSON.parse(data.phytech)        : {},
            dropbox:       data.dropbox        ? JSON.parse(data.dropbox)        : {},
            notifications: data.notifications  ? JSON.parse(data.notifications)  : {},
          })
        }
        setLoading(false)
      })
  }, [user])

  return { settings, loading }
}

export function useWeatherData(machineId) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)
  const [lastFetch, setLastFetch] = useState(null)

  const fetch = async (apiKey, apiSecret, stationId) => {
    if (!apiKey || !apiSecret || !stationId) return
    setLoading(true)
    try {
      const res = await import('../lib/integrations').then(m => m.wlGetCurrent(apiKey, apiSecret, stationId))
      setData(res)
      setLastFetch(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return { data, loading, error, lastFetch, fetch }
}
