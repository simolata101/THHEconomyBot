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
    )
    // --- New Credit/Gem Management
    .addSubcommand(s =>
      s.setName('credit')
        .setDescription('Manage user credits or gems')
        .addUserOption(o =>
          o.setName('target').setDescription('Target user').setRequired(true)
        )
        .addStringOption(o =>
          o.setName('type')
            .setDescription('Credit or Gem')
            .setRequired(true)
            .addChoices(
              { name: 'Credits', value: 'balance' },
              { name: 'Gems', value: 'gems' }
            )
        )
        .addStringOption(o =>
          o.setName('action')
            .setDescription('Add or Remove')
            .setRequired(true)
            .addChoices(
              { name: 'Add', value: 'add' },
              { name: 'Remove', value: 'remove' }
            )
        )
        .addIntegerOption(o =>
          o.setName('amount').setDescription('Amount').setRequired(true)
        )
    )
    // --- Requests Group
    .addSubcommandGroup(g =>
      g.setName('request').setDescription('Manage currency exchange requests')
        .addSubcommand(s =>
          s.setName('curex')
            .setDescription('Request a currency exchange')
            .addStringOption(o =>
              o.setName('from')
                .setDescription('Currency to convert from')
                .setRequired(true)
                .addChoices(
                  { name: 'CC', value: 'CC' },
                  { name: 'FC', value: 'FC' },
                  { name: 'PT', value: 'PT' },
                  { name: 'Credits', value: 'Credits' }
                )
            )
            .addStringOption(o =>
              o.setName('to')
                .setDescription('Currency to convert to')
                .setRequired(true)
                .addChoices(
                  { name: 'CC', value: 'CC' },
                  { name: 'FC', value: 'FC' },
                  { name: 'PT', value: 'PT' },
                  { name: 'Credits', value: 'Credits' }
                )
            )
            .addIntegerOption(o =>
              o.setName('amount').setDescription('Amount to convert').setRequired(true)
            )
        )
        .addSubcommand(s =>
          s.setName('list').setDescription('List all requests')
        )
        .addSubcommand(s =>
          s.setName('done')
            .setDescription('Mark a request as done')
            .addIntegerOption(o =>
              o.setName('id').setDescription('Request ID').setRequired(true)
            )
        )
    ),

  execute: async (interaction, { supabase }) => {
    const sub = interaction.options.getSubcommand();
    const subGroup = interaction.options.getSubcommandGroup(false);
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

          const { data: items, error } = await supabase.from('shop_items').select('*').limit(20);
        
          if (error) {
            console.error(error);
            return interaction.reply({ 
              embeds: [makeEmbed('❌ Error', 'Could not load the shop items.', 0xff0000)] 
            });
          }
        
          if (!items || items.length === 0) {
            return interaction.reply({ 
              embeds: [makeEmbed('🏪 Shop', 'The shop is empty.', 0x999999)] 
            });
          }
        
          const { data: inv, error: invErr } = await supabase
            .from('inventory')
            .select('item_id, shop_items(effect)')
            .eq('user_id', uid)
            .eq('shop_items.effect', 'shop_discount:10')
            .innerJoin('shop_items', 'inventory.item_id', 'shop_items.id');
        
          if (invErr) {
            console.error(invErr);
          }
        
          const hasDiscount = inv && inv.length > 0;
          const discountRate = hasDiscount ? 0.9 : 1; // 10% off
        
          const fields = items.map(i => {
            const discountedPrice = Math.floor(i.price * discountRate);
            return {
              name: `🛒 ${i.name} — 💰 ${discountedPrice} credits${hasDiscount ? ' (-10%)' : ''}`,
              value: `📌 **ID:** \`${i.id}\`\n✨ **Effect:** ${i.effect || 'None'}`,
              inline: false
            };
          });
        
      return interaction.reply({ 
        embeds: [{
          title: "🏪 Shop Items",
          description: hasDiscount 
            ? "🎉 You own a discount item! All prices are **10% off**." 
            : "Browse items available for purchase below:",
          color: 0xffcc00,
          fields
        }] 
      });
    }



    if (sub === 'buy') {
      const id = interaction.options.getInteger('id');
      const { data: item, error } = await supabase
        .from('shop_items')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error || !item) {
        return interaction.reply({
          content: '⚠️ Could not fetch shop item.',
          flags: 64
        });
      }

      if (!item)
        return interaction.reply({ embeds: [makeEmbed('❌ Item Not Found', `Item ID \`${id}\` does not exist.`, 0xff0000)], ephemeral: true });

      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      if ((user.balance || 0) < item.price)
        return interaction.reply({ embeds: [makeEmbed('❌ Insufficient Funds', `You need **${item.price} credits** to buy this item.`, 0xff0000)], ephemeral: true });

      await supabase.from('users').update({ balance: user.balance - item.price }).eq('id', uid);
      await supabase.from('inventory').insert({ user_id: uid, item_id: item.id, quantity: 1 });

      return interaction.reply({ embeds: [makeEmbed('✅ Purchase Successful', `You bought **${item.name}** for ${item.price} credits.`, 0x00ff00)] });
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

    // ===== Credit Management =====
    if (sub === 'credit') {
      const target = interaction.options.getUser('target');
      const type = interaction.options.getString('type'); // balance or gems
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount');

      const { data: user } = await supabase.from('users').select('*').eq('id', target.id).single();
      if (!user)
        return interaction.reply({ embeds: [makeEmbed('❌ User Not Found', `User ${target.tag} not registered.`, 0xff0000)], ephemeral: true });

      let newVal = user[type];
      if (action === 'add') newVal += amount;
      if (action === 'remove') newVal = Math.max(0, newVal - amount);

      await supabase.from('users').update({ [type]: newVal }).eq('id', target.id);

      return interaction.reply({ embeds: [makeEmbed('✅ Updated', `${target.tag} now has **${newVal} ${type}**.`, 0x00ff00)] });
    }

    // ===== Requests =====
    if (subGroup === 'request') {
      if (sub === 'curex') {
        const from = interaction.options.getString('from');
        const to = interaction.options.getString('to');
        const amount = interaction.options.getInteger('amount');

        if (from === to)
          return interaction.reply({ embeds: [makeEmbed('❌ Invalid Request', `From and To currencies cannot be the same.`, 0xff0000)], ephemeral: true });

        await supabase.from('requests').insert({ user_id: uid, from_currency: from, to_currency: to, amount, status: 'pending' });

        return interaction.reply({ embeds: [makeEmbed('📤 Request Submitted', `You requested to exchange **${amount} ${from} → ${to}**.`, 0x00ccff)] });
      }

      if (sub === 'list') {
        const { data } = await supabase.from('requests').select('*').order('id', { ascending: false }).limit(15);
        if (!data || data.length === 0)
          return interaction.reply({ embeds: [makeEmbed('📋 Requests', 'No requests found.', 0x999999)] });

        const desc = data.map(r => `**ID:** ${r.id} | <@${r.user_id}> | ${r.amount} ${r.from_currency} → ${r.to_currency} | **${r.status.toUpperCase()}**`).join('\n');
        return interaction.reply({ embeds: [makeEmbed('📋 Requests', desc, 0x00ccff)] });
      }

      if (sub === 'done') {
        const id = interaction.options.getInteger('id');
        await supabase.from('requests').update({ status: 'done' }).eq('id', id);
        return interaction.reply({ embeds: [makeEmbed('✅ Request Updated', `Request **${id}** marked as done.`, 0x00ff00)] });
      }
    }
  }
};







