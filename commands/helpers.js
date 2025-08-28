
const { v4: uuidv4 } = require('uuid');

module.exports = {
  ensureUser: async (supabase, userId) => {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
    if (error && error.code === 'PGRST116') {
      // not found — insert
      await supabase.from('users').insert({ id: userId }).select();
      return { id: userId, balance: 0, gems: 0 };
    }
    if (error) throw error;
    return data;
  },
  credit: async (supabase, userId, amount) => {
    await supabase.rpc('increment_balance', { p_user_id: userId, p_amount: amount }).catch(async () => {
      // fallback naive update
      await supabase.from('users').upsert({ id: userId, balance: amount }, { onConflict: ['id'] });
    });
  },
  randomBetween: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  id: () => uuidv4(),
};