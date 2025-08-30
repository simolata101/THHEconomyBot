const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const helpers = require('./helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('world')
    .setDescription('Quests, shop, guilds, crafting, collectibles')
    .addSubcommand(s =>
      s.setName('quests').setDescription('List active quests')
    )
    .addSubcommand(s =>
      s.setName('complete')
        .setDescription('Complete a quest by ID')
        .addIntegerOption(o =>
          o.setName('id').setDescription('The quest ID to complete').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('shop').setDescription('View shop')
    )
    .addSubcommand(s =>
      s.setName('buy')
        .setDescription('Buy item by ID')
        .addIntegerOption(o =>
          o.setName('id').setDescription('The item ID to purchase').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('trade')
        .setDescription('Propose a trade to another user')
        .addUserOption(o =>
          o.setName('target').setDescription('The user you want to trade with').setRequired(true)
        )
        .addStringOption(o =>
          o.setName('offer').setDescription('What you are offering in the trade').setRequired(true)
        )
        .addStringOption(o =>
          o.setName('request').setDescription('What you are requesting in the trade').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('craft')
        .setDescription('Craft an item using a recipe')
        .addStringOption(o =>
          o.setName('recipe').setDescription('The recipe name to craft').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('collectible')
        .setDescription('Mint a collectible')
        .addStringOption(o =>
          o.setName('name').setDescription('The collectible name to mint').setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('leaderboard').setDescription('Show leaderboard')
    ),

  execute: async (interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    await helpers.ensureUser(supabase, uid);

    // Embed helper
    const makeEmbed = (title, description, color = 0x2f3136) =>
      new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);

    if (sub === 'quests') {
      const { data } = await supabase.from('quests').select('*').eq('active', true).limit(10);
      if (!data || data.length === 0)
        return interaction.reply({ embeds: [makeEmbed('📜 Quests', 'No active quests right now.', 0x999999)] });

      const desc = data.map(q => `**ID:** \`${q.id}\` — ${q.title} (Reward: ${q.reward})`).join('\n');
      return interaction.reply({ embeds: [makeEmbed('📜 Active Quests', desc, 0x00ccff)] });
    }

    if (sub === 'complete') {
      const id = interaction.options.getInteger('id');
      const { data: q } = await supabase.from('quests').select('*').eq('id', id).single().catch(() => ({ data: null }));
      if (!q)
        return interaction.reply({ embeds: [makeEmbed('❌ Quest Not Found', `Quest ID \`${id}\` does not exist.`, 0xff0000)], ephemeral: true });

      await supabase.from('users').update({ balance: supabase.raw('balance + ?', [q.reward]) }).eq('id', uid).catch(() => { });
      await supabase.from('quests').update({ active: false }).eq('id', id);

      return interaction.reply({ embeds: [makeEmbed('✅ Quest Completed', `You received **${q.reward} credits**!`, 0x00ff00)] });
    }

    if (sub === 'shop') {
      const { data } = await supabase.from('shop_items').select('*').limit(20);
      if (!data || data.length === 0)
        return interaction.reply({ embeds: [makeEmbed('🏪 Shop', 'The shop is empty.', 0x999999)] });

      const desc = data.map(i => `**ID:** \`${i.id}\` — ${i.name} (${i.price} credits)`).join('\n');
      return interaction.reply({ embeds: [makeEmbed('🏪 Shop Items', desc, 0xffcc00)] });
    }

    if (sub === 'buy') {
      const id = interaction.options.getInteger('id');
      const { data: item } = await supabase.from('shop_items').select('*').eq('id', id).single().catch(() => ({ data: null }));
      if (!item)
        return interaction.reply({ embeds: [makeEmbed('❌ Item Not Found', `Item ID \`${id}\` does not exist.`, 0xff0000)], ephemeral: true });

      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if ((user.balance || 0) < item.price)
        return interaction.reply({ embeds: [makeEmbed('❌ Insufficient Funds', `You need **${item.price} credits** to buy this item.`, 0xff0000)], ephemeral: true });

      await supabase.from('users').update({ balance: user.balance - item.price }).eq('id', uid);
      await supabase.from('inventory').insert({ user_id: uid, item_id: item.id, quantity: 1 });

      return interaction.reply({ embeds: [makeEmbed('✅ Purchase Successful', `You bought **${item.name}** for ${item.price} credits.`, 0x00ff00)] });
    }

    if (sub === 'trade') {
      const target = interaction.options.getUser('target');
      const offer = interaction.options.getString('offer');
      const request = interaction.options.getString('request');
      await supabase.from('trades').insert({ from_user: uid, to_user: target.id, offered: { text: offer }, requested: { text: request } });

      return interaction.reply({ embeds: [makeEmbed('🤝 Trade Proposed', `You offered **${offer}** to ${target.tag} in exchange for **${request}**.`, 0x00ccff)] });
    }

    if (sub === 'craft') {
      const recipe = interaction.options.getString('recipe');
      await supabase.from('users').update({ gems: supabase.raw('gems + 1') }).eq('id', uid);

      return interaction.reply({ embeds: [makeEmbed('🛠️ Crafting Complete', `You crafted **${recipe}** and received **1 gem**.`, 0xff66cc)] });
    }

    if (sub === 'collectible') {
      const name = interaction.options.getString('name');
      const rarity = ['common', 'rare', 'epic'][helpers.randomBetween(0, 2)];
      await supabase.from('collectibles').insert({ owner: uid, name, rarity, metadata: {} });

      return interaction.reply({ embeds: [makeEmbed('🎨 Collectible Minted', `You minted collectible **${name}** (Rarity: **${rarity.toUpperCase()}**).`, 0x9966ff)] });
    }

    if (sub === 'leaderboard') {
      const { data } = await supabase.from('users').select('*').order('balance', { ascending: false }).limit(10);
      if (!data || data.length === 0)
        return interaction.reply({ embeds: [makeEmbed('🏆 Leaderboard', 'No players yet.', 0x999999)] });

      const desc = data.map((u, idx) => `**${idx + 1}.** <@${u.id}> — ${u.balance} credits`).join('\n');
      return interaction.reply({ embeds: [makeEmbed('🏆 Top 10 Players', desc, 0xffd700)] });
    }
  }
};
