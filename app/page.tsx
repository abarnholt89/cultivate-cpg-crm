import { supabase } from '../lib/supabaseClient'

export default async function Home() {
  const { data, error } = await supabase.from('brands').select('*')

  return (
    <div>
      <h1>Supabase Test</h1>
      <pre>{JSON.stringify({ data, error }, null, 2)}</pre>
    </div>
  )
}

