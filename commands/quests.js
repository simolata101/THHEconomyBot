const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Runtime cache
let quests = [];

/**
 * Load quests.json from Supabase Storage
 */
async function loadQuests() {
  try {
    const { data, error } = await supabase
      .storage
      .from('quests')
      .download('quests.json');

    if (error) {
      console.error("❌ Failed to load quests.json:", error.message);
      return [];
    }

    const text = await data.text();
    quests = JSON.parse(text);

    console.log(`📥 Quests loaded → ${quests.length} quests`);
    return quests;
  } catch (err) {
    console.error("❌ Error parsing quests.json:", err);
    return [];
  }
}

function getQuests() {
  return quests;
}
function findQuest(id) {
  return quests.find(q => q.id === id);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quests')
    .setDescription('Quest-related commands')
    .addSubcommand(s =>
      s.setName('status')
        .setDescription('Show your quest progress')
    )
    .addSubcommand(s =>
      s.setName('info')
        .setDescription('Show quest info for a given day')
        .addIntegerOption(o =>
          o.setName('day')
            .setDescription('Day of the month (1–31)')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('upload')
        .setDescription('Upload or reload quests.json (Admin only)')
        .addAttachmentOption(o =>
          o.setName('file')
            .setDescription('Upload new quests.json')
            .setRequired(false)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  /**
   * @param {import("discord.js").ChatInputCommandInteraction} interaction
   * @param {{ supabase: any, client: any }} deps
   */
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const uid = interaction.user.id;

      const { data: progress, error } = await supabase
        .from('quests_status')
        .select('*')
        .eq('user_id', uid);

      if (error) {
        console.error(error);
        return interaction.reply({ content: "❌ Could not fetch quest status.", ephemeral: true });
      }

      if (!progress || progress.length === 0) {
        return interaction.reply({ content: "ℹ️ You have no quest progress yet.", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(`${interaction.user.username}'s Quest Progress`)
        .setColor(0x5865F2)
        .setTimestamp();

        progress.forEach(p => {
          const quest = quests.find(q => q.day === p.quest_id);
          if (!quest) return;
        
          // Determine the target based on quest type
          let target = 0;
          if (quest.type === 'messages') target = quest.requirements?.count || 0;
          if (quest.type === 'vc_time') target = quest.requirements?.minutes || 0;
        
          embed.addFields({
            name: quest.name,
            value: `Progress: **${p.progress || 0}/${target}**\nStatus: **${p.completed ? "✅ Completed" : "⏳ Ongoing"}**`,
            inline: false
          });
        });


      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'info') {
      const day = interaction.options.getInteger('day');
      const quest = quests.find(q => q.day === day);

      if (!quest) {
        return interaction.reply({ content: `❌ No quest found for Day ${day}.`, ephemeral: true });
      }

            // Determine the requirement string based on quest type
            let requirementText = '';
            if (quest.type === 'messages') {
              requirementText = `${quest.requirements?.count || 0} messages`;
            } else if (quest.type === 'vc_time') {
              const minutes = quest.requirements?.minutes || 0;
              // Convert minutes to hours+minutes for readability
              const hours = Math.floor(minutes / 60);
              const mins = minutes % 60;
              requirementText = hours > 0 ? `${hours}h ${mins}m in VC` : `${mins}m in VC`;
            }
            
            const embed = new EmbedBuilder()
              .setTitle(`📜 Quest for Day ${day}`)
              .setColor(0x00AE86)
              .addFields(
                { name: "Name", value: quest.name, inline: false },
                { name: "Description", value: quest.description || "No description", inline: false },
                { name: "Requirement", value: requirementText || "N/A", inline: true },
                { name: "Reward", value: quest.reward?.toString() || "N/A", inline: true }
              )
              .setFooter({ text: "Complete this quest before the day ends!" });


      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'upload') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "❌ You don’t have permission to use this command.", ephemeral: true });
      }

      const file = interaction.options.getAttachment('file');
      await interaction.deferReply({ ephemeral: true });

      try {
        if (file) {
          if (!file.name.endsWith('.json')) {
            return interaction.editReply("❌ Please upload a `.json` file.");
          }

          const res = await fetch(file.url);
          const buffer = await res.arrayBuffer();

          const { error } = await supabase
            .storage
            .from('quests')
            .upload('quests.json', buffer, {
              contentType: 'application/json',
              upsert: true
            });

          if (error) throw error;

          await loadQuests();
          return interaction.editReply("✅ quests.json uploaded and reloaded successfully.");
        } else {
          await loadQuests();
          return interaction.editReply("🔄 quests.json reloaded from Supabase Storage.");
        }
      } catch (err) {
        console.error("❌ Upload/Reload failed:", err);
        return interaction.editReply("❌ Failed to upload or reload quests.json.");
      }
    }
  },

  // Export loader so index.js can preload on startup
  loadQuests,
  getQuests,
  findQuest
};

