const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
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
    GatewayIntentBits.MessageContent
  ]
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

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // 🔹 Load quests on startup
  await loadQuests();

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
});

// 🎙️ Track VC time for today’s quest
client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.id;

  // User joins VC
  if (!oldState.channelId && newState.channelId) {
    vcJoinTimes.set(userId, Date.now());
  }

  // User leaves VC
  if (oldState.channelId && !newState.channelId) {
    const joinTime = vcJoinTimes.get(userId);
    if (!joinTime) return;

    const minutes = Math.floor((Date.now() - joinTime) / 60000);
    vcJoinTimes.delete(userId);

    const quests = client.getQuests();
    const today = new Date().getDate();
    const quest = quests.find(q => q.day === today && q.type === "vc_time");
    if (!quest) return;

    // Fetch current progress
    const { data: status, error } = await supabase
      .from('quests_status')
      .select('*')
      .eq('user_id', userId)
      .eq('quest_id', today)
      .maybeSingle();

    const target = quest.requirements?.minutes || 0;
    const progress = (status?.progress || 0) + minutes;
    const completed = progress >= target;

    const { error: upsertError } = status
      ? await supabase.from('quests_status')
          .update({ progress, completed })
          .eq('user_id', userId)
          .eq('quest_id', today)
      : await supabase.from('quests_status')
          .insert({ user_id: userId, quest_id: today, progress, completed });

    if (upsertError) console.error('❌ Quest insert/update failed (VC):', upsertError);
    else console.log(`✅ VC quest progress updated: user=${userId}, quest=Day ${today}, progress=${progress}`);
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



