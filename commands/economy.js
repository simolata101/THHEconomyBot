const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const helpers = require('./helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Economy commands (work, daily, idle, bank, balance)')
    .addSubcommand(s => s.setName('work').setDescription('Do a job to earn money'))
    .addSubcommand(s => s.setName('daily').setDescription('Claim daily reward'))
    .addSubcommand(s => s.setName('hourly').setDescription('Claim hourly reward'))
    .addSubcommand(s => s.setName('idle').setDescription('Toggle idle earnings'))
    .addSubcommand(s => s.setName('balance').setDescription('Show your balances'))
    .addSubcommand(s => s.setName('bank')
      .setDescription('deposit/withdraw')
      .addStringOption(o => o.setName('action').setDescription('deposit or withdraw').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('amount'))),

  async execute(interaction, { supabase }) {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    await helpers.ensureUser(supabase, uid);

    // Helper embed function
    const makeEmbed = (title, description, color = 0x2f3136) =>
      new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);

    if (sub === 'work') {
      const pay = helpers.randomBetween(20, 150);
      await supabase.from('users').upsert(
        { id: uid, balance: pay },
        { onConflict: ['id'], returning: 'minimal' }
      );
      return interaction.reply({
        embeds: [makeEmbed('💼 Work Complete', `You worked and earned **${pay} credits**!`, 0x00ff00)]
      });
    }

    if (sub === 'daily') {
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      const now = new Date();
      const last = user?.last_daily ? new Date(user.last_daily) : null;
      const dayMs = 24 * 60 * 60 * 1000;
      let streak = user?.streak || 0;
    
      if (!last || (now - last) > dayMs) {
        const reward = 100 + streak * 10;
        streak = last && (now - last) < (2 * dayMs) ? streak + 1 : 1;
    
        let totalCredits = reward;
        let totalGems = 0;
        let breakdown = [`Base reward: **${reward} credits**`];
    
        // 🏢 Building bonuses
        const { data: inv } = await supabase
          .from('inventory')
          .select('quantity, shop_items(name, effect)')
          .eq('user_id', uid)
          .eq('shop_items.type', 'building');
    
        if (inv && inv.length > 0) {
          for (const row of inv) {
            const qty = row.quantity || 1;
            const effect = row.shop_items.effect || '';
            effect.split(',').forEach(e => {
              const [k, v] = e.split(':');
              const amount = parseInt(v) * qty;
              if (k === 'credits_per_day') {
                totalCredits += amount;
                breakdown.push(`${row.shop_items.name}: **+${amount} credits**`);
              }
              if (k === 'gems_per_day') {
                totalGems += amount;
                breakdown.push(`${row.shop_items.name}: **+${amount} gems**`);
              }
            });
          }
        }
    
        await supabase.from('users')
          .update({
            balance: (user.balance || 0) + totalCredits,
            gems: (user.gems || 0) + totalGems,
            streak,
            last_daily: now.toISOString()
          })
          .eq('id', uid);
    
        return interaction.reply({
          embeds: [makeEmbed('📅 Daily Reward',
            breakdown.join('\n') + `\n\n**Final Total:** ${totalCredits} credits, ${totalGems} gems\nStreak: **${streak}**`, 0x00ffcc)]
        });
      } else {
        return interaction.reply({
          embeds: [makeEmbed('⚠️ Already Claimed', 'You already claimed your daily today. Come back tomorrow.', 0xff0000)],
          ephemeral: true
        });
      }
    }


    if (sub === 'hourly') {
        const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
        const now = new Date();
        const last = user?.last_hourly ? new Date(user.last_hourly) : null;
        const hourMs = 60 * 60 * 1000;
      
        if (!last || (now - last) > hourMs) {
          // 🏆 Base reward (fixed, no streak)
          const reward = 10; 
          let totalCredits = reward;
          let totalGems = 0;
          let breakdown = [`Base reward: **${reward} credits**`];
      
          // 🏢 Building bonuses (per-hour effects)
          const { data: inv } = await supabase
            .from('inventory')
            .select('quantity, shop_items(name, effect)')
            .eq('user_id', uid)
            .eq('shop_items.type', 'building');
      
          if (inv && inv.length > 0) {
            for (const row of inv) {
              const qty = row.quantity || 1;
              const effect = row.shop_items.effect || '';
              effect.split(',').forEach(e => {
                const [k, v] = e.split(':');
                const amount = parseInt(v) * qty;
      
                if (k === 'credits_per_hour') {
                  totalCredits += amount;
                  breakdown.push(`${row.shop_items.name}: **+${amount} credits**`);
                }
                if (k === 'gems_per_hour') {
                  totalGems += amount;
                  breakdown.push(`${row.shop_items.name}: **+${amount} gems**`);
                }
              });
            }
          }
      
          await supabase.from('users')
            .update({
              balance: (user.balance || 0) + totalCredits,
              gems: (user.gems || 0) + totalGems,
              last_hourly: now.toISOString()
            })
            .eq('id', uid);
      
          return interaction.reply({
            embeds: [makeEmbed('⏰ Hourly Reward',
              breakdown.join('\n') + `\n\n**Final Total:** ${totalCredits} credits, ${totalGems} gems`, 0x00ccff)]
          });
        } else {
          return interaction.reply({
            embeds: [makeEmbed('⚠️ Already Claimed', 'You already claimed your hourly reward. Come back next hour.', 0xff0000)],
            ephemeral: true
          });
        }
      }


    if (sub === 'idle') {
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      const newState = !user?.idle;
      await supabase.from('users').update({ idle: newState }).eq('id', uid);

      return interaction.reply({
        embeds: [makeEmbed('🛌 Idle Mode', `Idle earnings are now **${newState ? 'ENABLED' : 'DISABLED'}**.`, 0xffff00)]
      });
    }

    if (sub === 'balance') {
        const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();
      
        // ================= QUEST CHECK =================
        const quests = await supabase.storage.from('quests').download('quests.json');
        let questText = "No active quest today.";
        if (quests.data) {
          const text = await quests.data.text();
          const allQuests = JSON.parse(text);
      
          const today = new Date().getDate();
          const quest = allQuests.find(q => q.day === today);
          if (quest) {
            // Get progress from quests_status
            const { data: status } = await supabase
              .from('quests_status')
              .select('*')
              .eq('user_id', uid)
              .eq('quest_id', today)
              .maybeSingle();
      
            const target = quest.requirements?.count || quest.requirements?.minutes || 0;
            const progress = status?.progress || 0;
            const completed = progress >= target;
      
            if (completed) {
              if (!status?.reward_claimed) {
                // 💰 Award reward now
                const reward = quest.reward || {}; // { credits: 100, gems: 5 }
      
                await supabase.from('users')
                  .update({
                    balance: (user.balance || 0) + (reward.credits || 0),
                    gems: (user.gems || 0) + (reward.gems || 0)
                  })
                  .eq('id', uid);
      
                // Mark reward as claimed
                await supabase.from('quests_status')
                  .update({ reward_claimed: true })
                  .eq('user_id', uid)
                  .eq('quest_id', today);
      
                questText = `🎉 **Quest Completed!**\nReward claimed: **+${reward.credits || 0} credits, +${reward.gems || 0} gems**`;
              } else {
                questText = `✅ Quest already completed and reward claimed.`;
              }
            } else {
              questText = `⏳ Quest in progress: ${progress}/${target}`;
            }
          }
        }
      
        // 🔹 Fetch inventory with item effects
        const { data: inv } = await supabase
          .from('inventory')
          .select('quantity, shop_items(name, effect)')
          .eq('user_id', uid);
      
        let itemsText = '*(No items owned)*';
        if (inv && inv.length > 0) {
          itemsText = inv.map(row => {
            let effects = '';
            if (row.shop_items.effect) {
              effects = row.shop_items.effect
                .split(',')
                .map(e => {
                  const [k, v] = e.split(':');
                  if (k === 'credits_per_day') return `+${v} 💰/day`;
                  if (k === 'gems_per_day') return `+${v} 💎/day`;
                  if (k === 'xp_boost') return `+${v}% XP Boost`;
                  return `${k}: ${v}`;
                })
                .join(', ');
            }
            return `**${row.shop_items.name}** x${row.quantity} → *${effects}*`;
          }).join('\n');
        }
      
        return interaction.reply({
          embeds: [makeEmbed(
            '💰 Your Balance',
            `**Wallet:** ${user?.balance || 0} credits\n**Gems:** ${user?.gems || 0}\n**Bank:** ${user?.bank_balance || 0}\n\n🎯 **Quest Status:**\n${questText}\n\n🎒 **Items Owned:**\n${itemsText}`,
            0x0099ff
          )]
        });
      }


    if (sub === 'bank') {
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount') || 0;
      const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

      if (action === 'deposit') {
        if (amount <= 0 || amount > (user.balance || 0))
          return interaction.reply({
            embeds: [makeEmbed('❌ Error', 'Invalid amount.', 0xff0000)],
            ephemeral: true
          });

        await supabase.from('users').update({
          balance: (user.balance || 0) - amount,
          bank_balance: (user.bank_balance || 0) + amount
        }).eq('id', uid);

        return interaction.reply({
          embeds: [makeEmbed('🏦 Deposit Successful', `Deposited **${amount} credits** to bank.`, 0x00ff00)]
        });
      }

      if (action === 'withdraw') {
        if (amount <= 0 || amount > (user.bank_balance || 0))
          return interaction.reply({
            embeds: [makeEmbed('❌ Error', 'Invalid amount.', 0xff0000)],
            ephemeral: true
          });

        await supabase.from('users').update({
          balance: (user.balance || 0) + amount,
          bank_balance: (user.bank_balance || 0) - amount
        }).eq('id', uid);

        return interaction.reply({
          embeds: [makeEmbed('💳 Withdraw Successful', `Withdrew **${amount} credits** from bank.`, 0x00ff00)]
        });
      }

      return interaction.reply({
        embeds: [makeEmbed('❓ Unknown Action', 'Bank action must be either **deposit** or **withdraw**.', 0xff0000)],
        ephemeral: true
      });
    }
  }
};


