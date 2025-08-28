const { SlashCommandBuilder } = require('discord.js');
const helpers = require('./helpers');

module.exports = {
data: new SlashCommandBuilder()
  .setName('world')
  .setDescription('Quests, shop, guilds, crafting, collectibles')
  .addSubcommand(s => 
    s.setName('quests')
     .setDescription('List active quests')
  )
  .addSubcommand(s => 
    s.setName('complete')
     .setDescription('Complete a quest by ID')
     .addIntegerOption(o => 
       o.setName('id')
        .setDescription('The quest ID to complete') // ✅ fixed
        .setRequired(true)
     )
  )
  .addSubcommand(s => 
    s.setName('shop')
     .setDescription('View shop')
  )
  .addSubcommand(s => 
    s.setName('buy')
     .setDescription('Buy item by ID')
     .addIntegerOption(o => 
       o.setName('id')
        .setDescription('The item ID to purchase') // ✅ fixed
        .setRequired(true)
     )
  )
  .addSubcommand(s => 
    s.setName('trade')
     .setDescription('Propose a trade to another user')
     .addUserOption(o => 
       o.setName('target')
        .setDescription('The user you want to trade with') // ✅ fixed
        .setRequired(true)
     )
     .addStringOption(o => 
       o.setName('offer')
        .setDescription('What you are offering in the trade') // ✅ fixed
        .setRequired(true)
     )
     .addStringOption(o => 
       o.setName('request')
        .setDescription('What you are requesting in the trade') // ✅ fixed
        .setRequired(true)
     )
  )
  .addSubcommand(s => 
    s.setName('craft')
     .setDescription('Craft an item using a recipe')
     .addStringOption(o => 
       o.setName('recipe')
        .setDescription('The recipe name to craft') // ✅ fixed
        .setRequired(true)
     )
  )
  .addSubcommand(s => 
    s.setName('collectible')
     .setDescription('Mint a collectible')
     .addStringOption(o => 
       o.setName('name')
        .setDescription('The collectible name to mint') // ✅ fixed
        .setRequired(true)
     )
  )
  .addSubcommand(s => 
    s.setName('leaderboard')
     .setDescription('Show leaderboard')
  ),


  execute: async(interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    await helpers.ensureUser(supabase, uid);

    if (sub === 'quests') {
      const { data } = await supabase.from('quests').select('*').eq('active', true).limit(10);
      if (!data || data.length === 0) return interaction.reply('No active quests right now.');
      return interaction.reply(data.map(q=>`ID:${q.id} - ${q.title} (Reward: ${q.reward})`).join('\n'));
    }

    if (sub === 'complete') {
      const id = interaction.options.getInteger('id');
      // naive: just give reward and mark inactive
      const { data: q } = await supabase.from('quests').select('*').eq('id', id).single().catch(()=>({data:null}));
      if (!q) return interaction.reply({ content: 'Quest not found', ephemeral: true });
      await supabase.from('users').update({ balance: supabase.raw('balance + ?', [q.reward]) }).eq('id', uid).catch(()=>{});
      await supabase.from('quests').update({ active: false }).eq('id', id);
      return interaction.reply(`Quest completed. You received ${q.reward} credits.`);
    }

    if (sub === 'shop') {
      const { data } = await supabase.from('shop_items').select('*').limit(20);
      if (!data || data.length === 0) return interaction.reply('Shop is empty.');
      return interaction.reply(data.map(i=>`ID:${i.id} - ${i.name} — ${i.price}`).join('\n'));
    }

    if (sub === 'buy') {
      const id = interaction.options.getInteger('id');
      const { data: item } = await supabase.from('shop_items').select('*').eq('id', id).single().catch(()=>({data:null}));
      if (!item) return interaction.reply({ content: 'Item not found', ephemeral: true });
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if ((user.balance || 0) < item.price) return interaction.reply({ content: 'Insufficient funds', ephemeral: true });
      await supabase.from('users').update({ balance: user.balance - item.price }).eq('id', uid);
      await supabase.from('inventory').insert({ user_id: uid, item_id: item.id, quantity: 1 });
      return interaction.reply(`Purchased ${item.name} for ${item.price}.`);
    }

    if (sub === 'trade') {
      const target = interaction.options.getUser('target');
      const offer = interaction.options.getString('offer');
      const request = interaction.options.getString('request');
      await supabase.from('trades').insert({ from_user: uid, to_user: target.id, offered: { text: offer }, requested: { text: request } });
      return interaction.reply(`Trade proposed to ${target.tag}.`);
    }

    if (sub === 'craft') {
      const recipe = interaction.options.getString('recipe');
      // naive craft: always succeed and give a gem
      await supabase.from('users').update({ gems: supabase.raw('gems + 1') }).eq('id', uid);
      return interaction.reply(`Crafted ${recipe}. You received 1 gem.`);
    }

    if (sub === 'collectible') {
      const name = interaction.options.getString('name');
      const rarity = ['common','rare','epic'][helpers.randomBetween(0,2)];
      await supabase.from('collectibles').insert({ owner: uid, name, rarity, metadata: {} });
      return interaction.reply(`Minted collectible **${name}** (${rarity}).`);
    }

    if (sub === 'leaderboard') {
      const { data } = await supabase.from('users').select('*').order('balance', { ascending: false }).limit(10);
      if (!data || data.length === 0) return interaction.reply('No players yet.');
      return interaction.reply(data.map((u, idx)=>`${idx+1}. <@${u.id}> — ${u.balance}`).join('\n'));
    }
  }

};
