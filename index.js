const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client, GatewayIntentBits,Partials , Collection, REST, Routes, ChannelType  } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

// Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing required ENV vars. Copy .env.example -> .env and fill values.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction,Partials.User],
});
client.commands = new Collection();

// 🔹 In-memory quest cache
let questsCache = [];

// 🔹 Load quests.json from Supabase Storage
async function loadQuests() {
  const { data, error } = await supabase.storage.from('quests').download('quests.json');
  if (error) {
    console.error("❌ Failed to load quests.json:", error);
    questsCache = [];
    return;
  }
  const text = await data.text();
  questsCache = JSON.parse(text);
  console.log("✅ Quests loaded from Supabase Storage:", questsCache.length, "quests");
}

// Export helper to use in commands
client.getQuests = () => questsCache;

// Load commands
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath);

for (const file of fs.readdirSync(commandsPath)) {
  if (!file.endsWith('.js')) continue;
  const cmd = require(path.join(commandsPath, file));

  if (!cmd.data || !cmd.data.name || typeof cmd.execute !== 'function') {
    console.warn(`[WARN] Skipping invalid command file: ${file}`);
    continue;
  }

  client.commands.set(cmd.data.name, cmd);
  commands.push(cmd.data.toJSON());
}

// Register slash commands globally
(async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err);
  }
})();

// ====================== HELPERS FOR GIVEAWAY_PROGRESS ======================
async function ensureGiveawayProgressRow(gaId, userId) {
  console.log('ensureGiveawayProgressRow');
  try {
    const { data: row, error } = await supabase
      .from('giveaway_progress')
      .select('*')
      .eq('giveaway_id', gaId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('⚠️ Error checking giveaway_progress row:', error);
      return null;
    }

    if (row) return row;

    const { data: inserted, error: insertError } = await supabase
      .from('giveaway_progress')
      .insert({ giveaway_id: gaId, user_id: userId, messages_count: 0, invites_count: 0 })
      .select()
      .maybeSingle();

    if (insertError) {
      console.error('❌ Failed to insert giveaway_progress row:', insertError);
      return null;
    }

    return inserted;
  } catch (err) {
    console.error('❌ ensureGiveawayProgressRow unexpected error:', err);
    return null;
  }
}

async function incrementGiveawayProgress(gaId, userId, field) {
  console.log('incrementGiveawayProgress');
  try {
    const { data: row, error } = await supabase
      .from('giveaway_progress')
      .select('*')
      .eq('giveaway_id', gaId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('⚠️ Fetch error in giveaway_progress:', error);
      return;
    }

    if (row) {
      const updateData = {
        messages_count: row.messages_count || 0,
        invites_count: row.invites_count || 0
      };
      if (field === 'messages_count') updateData.messages_count += 1;
      if (field === 'invites_count') updateData.invites_count += 1;

      const { error: updateError } = await supabase
        .from('giveaway_progress')
        .update(updateData)
        .eq('giveaway_id', gaId)
        .eq('user_id', userId);

      if (updateError) console.error('❌ Update failed in giveaway_progress:', updateError);
    } else {
      const insertData = {
        giveaway_id: gaId,
        user_id: userId,
        messages_count: field === 'messages_count' ? 1 : 0,
        invites_count: field === 'invites_count' ? 1 : 0
      };
      const { error: insertError } = await supabase
        .from('giveaway_progress')
        .insert(insertData);

      if (insertError) console.error('❌ Insert failed in giveaway_progress:', insertError);
    }
  } catch (err) {
    console.error('❌ incrementGiveawayProgress unexpected error:', err);
  }
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // 🔹 Load quests on startup
  await loadQuests();

  try {
    const { data: active, error } = await supabase
      .from('giveaways')
      .select('*')
      .gt('ends_at', new Date().toISOString());

    if (error) console.error('❌ Failed to fetch active giveaways:', error);
    else if (active) {
      console.log(`🔄 Resynced ${active.length} active giveaways from DB`);
      client.activeGiveaways = active;

      // Resync giveaway_progress based on existing reactions and log who reacted
      for (const ga of active) {
        try {
          if (!ga.channel_id || !ga.message_id) continue;
          const channel = await client.channels.fetch(ga.channel_id).catch(() => null);
          if (!channel) {
            console.warn(`⚠️ Unable to fetch channel ${ga.channel_id} for GA ${ga.id}`);
            continue;
          }

          const message = await channel.messages.fetch(ga.message_id).catch(() => null);
          if (!message) {
            console.warn(`⚠️ Unable to fetch message ${ga.message_id} in channel ${ga.channel_id} for GA ${ga.id}`);
            continue;
          }

          const reaction = message.reactions.cache.find(r => r.emoji.name === '🎉');
          if (!reaction) continue;

          // Fetch users who reacted (may be limited to 100 at a time)
          const users = await reaction.users.fetch().catch(err => {
            console.error(`⚠️ Failed to fetch users for reaction on message ${ga.message_id}:`, err);
            return null;
          });

          if (!users) continue;

          for (const [uid, user] of users) {
            if (user.bot) continue;
            console.log(`♻️ Resync GA ${ga.id}: ${user.tag} (${uid}) reacted 🎉`);

            // Ensure giveaway_progress record exists for this user
            const row = await ensureGiveawayProgressRow(ga.id, uid);
            if (row) console.log(`✅ giveaway_progress exists for ${user.tag} in GA ${ga.id}`);
          }
        } catch (err) {
          console.error(`⚠️ Error resyncing GA ${ga.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('⚠️ Error during giveaways resync:', err);
  }

  // 🔹 Refresh invite cache
  try {
    for (const guild of client.guilds.cache.values()) {
      const invites = await guild.invites.fetch().catch(() => null);
      if (invites) {
        invites.forEach(inv => {
          invitesCache.set(inv.code, { uses: inv.uses, inviter: inv.inviter?.id });
        });
      }
    }
    console.log('✅ Invite cache resynced');
  } catch (err) {
    console.error('⚠️ Error refreshing invite cache:', err);
  }

// ✅ Cron job for checkpoint updates every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  console.log('⏰ Running VC checkpoint update...');

  const quests = client.getQuests();
  const today = new Date();
  const dayOfMonth = today.getDate(); // 1–31
  const quest = quests.find(q => q.day === dayOfMonth && q.type === "vc_time");

  if (!quest) return;

  const questId = quest.day.toString();
  const target = quest.requirements?.minutes || 0;

  for (const [userId, joinTime] of vcJoinTimes.entries()) {
    const minutes = Math.floor((Date.now() - joinTime) / 60000);

    // Fetch current progress
    const { data: status, error } = await supabase
      .from('quests_status')
      .select('*')
      .eq('user_id', userId)
      .eq('quest_id', questId)
      .maybeSingle();

    if (error) {
      console.error('❌ Supabase fetch failed (VC checkpoint):', error);
      continue;
    }

    const progress = (status?.progress || 0) + minutes;
    const completed = progress >= target;

    // Update or insert progress
    const { error: upsertError } = status
      ? await supabase.from('quests_status')
          .update({ progress, completed, last_updated: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('quest_id', questId)
      : await supabase.from('quests_status')
          .insert({ 
            user_id: userId, 
            quest_id: questId, 
            progress, 
            completed,
            last_updated: new Date().toISOString()
          });

    if (upsertError) {
      console.error('❌ Quest checkpoint update failed (VC):', upsertError);
    } else {
      console.log(`✅ VC checkpoint progress saved: user=${userId}, quest=Day ${questId}, progress=${progress}`);
    }
  }
});

  // 🕒 Cron: every hour (passive income)
  cron.schedule('0 * * * *', async () => {
    console.log('🏛️ Running passive income cron...');
    try {
      const { data: inv, error } = await supabase
        .from('inventory')
        .select('user_id, quantity, shop_items(name, effect)')
        .eq('shop_items.type', 'building');

      if (error) {
        console.error('❌ Passive income fetch error:', error);
        return;
      }
      if (!inv || inv.length === 0) {
        console.log('ℹ️ No buildings owned yet.');
        return;
      }

      const incomeMap = {};
      for (const row of inv) {
        const uid = row.user_id;
        const effect = row.shop_items.effect || '';
        const qty = row.quantity || 1;

        if (!incomeMap[uid]) incomeMap[uid] = { credits: 0, gems: 0 };

        effect.split(',').forEach(e => {
          const [k, v] = e.split(':');
          const amount = parseInt(v) * qty;
          if (k === 'credits_per_day') incomeMap[uid].credits += amount / 24;
          if (k === 'gems_per_day') incomeMap[uid].gems += amount / 24;
          if (k === 'credits_per_hour') incomeMap[uid].credits += amount;
          if (k === 'gems_per_hour') incomeMap[uid].gems += amount;
        });
      }

      for (const [uid, { credits, gems }] of Object.entries(incomeMap)) {
        const { data: user } = await supabase.from('users').select('*').eq('id', uid).single();

        if (!user) continue;

        await supabase.from('users').update({
          balance: (user.balance || 0) + Math.floor(credits),
          gems: (user.gems || 0) + Math.floor(gems)
        }).eq('id', uid);

        console.log(`💰 Passive income → ${uid}: +${Math.floor(credits)} credits, +${Math.floor(gems)} gems`);
      }

    } catch (err) {
      console.error('❌ Passive income cron failed:', err);
    }
  });
});

// ====================== QUEST TRACKING ======================

// Track VC join times in memory
const vcJoinTimes = new Map();

// 📝 Track messages for today’s quest
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const quests = client.getQuests();

  // ✅ Only today’s quest
  const today = new Date().getDate();
  const quest = quests.find(q => q.day === today && q.type === "messages");
  if (!quest) return;

  // Fetch current progress
  const { data: status, error } = await supabase
    .from('quests_status')
    .select('*')
    .eq('user_id', userId)
    .eq('quest_id', today)
    .maybeSingle();

  const target = quest.requirements?.count || 0;
  const progress = (status?.progress || 0) + 1;
  const completed = progress >= target;

  const { error: upsertError } = status
    ? await supabase.from('quests_status')
        .update({ progress, completed })
        .eq('user_id', userId)
        .eq('quest_id', today)
    : await supabase.from('quests_status')
        .insert({ user_id: userId, quest_id: today, progress, completed });

  if (upsertError) console.error('❌ Quest insert/update failed:', upsertError);
  else console.log(`✅ Quest progress updated: user=${userId}, quest=Day ${today}, progress=${progress}`);
  
  
   // fetch active giveaways
  const { data: active } = await supabase
    .from('giveaways')
    .select('id, ends_at, messages_required')
    .gt('ends_at', new Date().toISOString());

  if (!active || active.length === 0) return;

  for (const ga of active) {
    if (!ga.messages_required) continue; // skip if not required

    // get existing progress
    const { data: row } = await supabase
      .from('giveaway_progress')
      .select('*')
      .eq('giveaway_id', ga.id)
      .eq('user_id', userId)
      .maybeSingle();

    const newCount = (row?.messages_count || 0) + 1;

    await supabase.from('giveaway_progress')
      .upsert({ giveaway_id: ga.id, user_id: userId, messages_count: newCount, invites_count: row?.invites_count || 0 });

    console.log(`📩 GA ${ga.id}: ${userId} → messages=${newCount}`);
  }
});

// 🎙️ Track VC time for today’s quest
client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.id;

  // User joins VC → save join time
  if (!oldState.channelId && newState.channelId) {
    vcJoinTimes.set(userId, Date.now());
    console.log(`🎙️ User ${userId} joined VC ${newState.channel?.name || newState.channelId}`);
  }

  // User leaves VC → cleanup only
  if (oldState.channelId && !newState.channelId) {
    vcJoinTimes.delete(userId);
    console.log(`👋 User ${userId} left VC`);
  }
});



const invitesCache = new Map();
client.on('inviteCreate', invite => {
  invitesCache.set(invite.code, { uses: invite.uses, inviter: invite.inviter?.id });
});
client.on('inviteDelete', invite => {
  invitesCache.delete(invite.code);
});

client.on('guildMemberAdd', async member => {
  const invites = await member.guild.invites.fetch();
  const usedInvite = invites.find(inv => {
    const cached = invitesCache.get(inv.code);
    return cached && inv.uses > (cached.uses || 0);
  });

  if (!usedInvite) return;
  const inviterId = usedInvite.inviter?.id;
  if (!inviterId) return;

  // fetch active giveaways
  const { data: active } = await supabase
    .from('giveaways')
    .select('id, ends_at, invites_required')
    .gt('ends_at', new Date().toISOString());

  if (!active || active.length === 0) return;

  for (const ga of active) {
    if (!ga.invites_required) continue;

    const { data: row } = await supabase
      .from('giveaway_progress')
      .select('*')
      .eq('giveaway_id', ga.id)
      .eq('user_id', inviterId)
      .maybeSingle();

    const newCount = (row?.invites_count || 0) + 1;

    await supabase.from('giveaway_progress')
      .upsert({ giveaway_id: ga.id, user_id: inviterId, messages_count: row?.messages_count || 0, invites_count: newCount });

    console.log(`🎟️ GA ${ga.id}: ${inviterId} → invites=${newCount}`);
  }
});


client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '🎉') return;

  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();

  const giveawayId = reaction.message.id;

  // Fetch giveaway
  const { data: giveaway } = await supabase
    .from('giveaways')
    .select('*')
    .eq('message_id', giveawayId)
    .single();

  if (!giveaway) return;

  // Ensure progress row exists (it may already exist from message tracking)
  const row = await ensureGiveawayProgressRow(giveaway.id, user.id);
  if (row) console.log(`✅ giveaway_progress exists for ${user.tag} in GA ${giveaway.id}`);

  const guild = reaction.message.guild;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  let eligible = true;
  let reason = '';

  // Role check
  if (giveaway.role_required && !member.roles.cache.has(giveaway.role_required)) {
    eligible = false;
    reason = `You must have <@&${giveaway.role_required}> to join this giveaway.`;
  }

  // Messages requirement check
  if (eligible && giveaway.messages_required > 0) {
    const { data: progress } = await supabase
      .from('giveaway_progress')
      .select('messages_count')
      .eq('giveaway_id', giveaway.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!progress || progress.messages_count < giveaway.messages_required) {
      eligible = false;
      reason = `You need at least **${giveaway.messages_required} messages** to join this giveaway.`;
    }
  }

  // Invites requirement check
  if (eligible && giveaway.invites_required > 0) {
    const { data: progress } = await supabase
      .from('giveaway_progress')
      .select('invites_count')
      .eq('giveaway_id', giveaway.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!progress || progress.invites_count < giveaway.invites_required) {
      eligible = false;
      reason = `You need at least **${giveaway.invites_required} invites** to join this giveaway.`;
    }
  }

if (!eligible) {
  try {
    await reaction.users.remove(user.id);
    console.log(`❌ Removed ineligible reaction from ${user.tag}: ${reason}`);

    // DM the user about removal
    if (user.dmChannel === null) await user.createDM(); // Ensure DM channel exists
    await user.send(`You were removed from the giveaway (${giveaway.id}) because: ${reason}`);
  } catch (err) {
    console.error(`⚠️ Failed to remove reaction or send DM for ${user.tag}:`, err);
  }
} else {
  console.log(`✅ ${user.tag} successfully entered GA ${giveaway.id}`);

  // Optionally DM the user to confirm entry
  try {
    if (user.dmChannel === null) await user.createDM();
    await user.send(`You have successfully entered the giveaway (${giveaway.id})! Good luck!`);
  } catch (err) {
    console.error(`⚠️ Failed to send entry DM to ${user.tag}:`, err);
  }
}
});



// =============================================================

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, { supabase, client, loadQuests });
  } catch (err) {
    console.error('❌ Command error:', err);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error while executing this command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error while executing this command.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);













