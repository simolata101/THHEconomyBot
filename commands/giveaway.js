const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const ms = require("ms"); // npm install ms

// In-memory storage for active giveaways (with DB id)
const giveaways = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt => 
      opt.setName("winners").setDescription("Number of winners").setRequired(true))
    .addStringOption(opt => 
      opt.setName("prize").setDescription("Prize description").setRequired(true))
    .addChannelOption(opt => 
      opt.setName("channel").setDescription("Channel to post giveaway").setRequired(true))
    .addStringOption(opt => 
      opt.setName("duration").setDescription("Duration (e.g. 1h, 30m, 2d, 1w)").setRequired(true))
    .addRoleOption(opt => 
      opt.setName("role_required").setDescription("Role required to enter").setRequired(false))
    .addIntegerOption(opt => 
      opt.setName("messages_required").setDescription("Messages required to qualify").setRequired(false))
    .addIntegerOption(opt => 
      opt.setName("booster_entries").setDescription("Extra entries for server boosters").setRequired(false))
    .addIntegerOption(opt => 
      opt.setName("invites_required").setDescription("Invites required to qualify").setRequired(false)),

  async execute(interaction, { client, supabase }) {
    const winners = interaction.options.getInteger("winners");
    const prize = interaction.options.getString("prize");
    const channel = interaction.options.getChannel("channel");
    const durationStr = interaction.options.getString("duration");
    const roleRequired = interaction.options.getRole("role_required");
    const messagesRequired = interaction.options.getInteger("messages_required") || null;
    const boosterEntries = interaction.options.getInteger("booster_entries") || 1;
    const invitesRequired = interaction.options.getInteger("invites_required") || null;

    // Parse duration
    const durationMs = ms(durationStr);
    if (!durationMs) {
      return interaction.reply({ content: "❌ Invalid duration format. Use like `1h`, `30m`, `2d`, `1w`.", ephemeral: true });
    }

    const endsAt = new Date(Date.now() + durationMs).toISOString();

    // Create giveaway embed
    const embed = new EmbedBuilder()
      .setTitle("🎉 Giveaway!")
      .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends in:** ${durationStr}`)
      .setColor("Random")
      .setTimestamp(Date.now() + durationMs)
      .setFooter({ text: `Giveaway started by ${interaction.user.tag}` });

    if (roleRequired) embed.addFields({ name: "Requirement", value: `Must have role: ${roleRequired}`, inline: true });
    if (messagesRequired) embed.addFields({ name: "Messages Required", value: `${messagesRequired}`, inline: true });
    if (invitesRequired) embed.addFields({ name: "Invites Required", value: `${invitesRequired}`, inline: true });
    if (boosterEntries > 1) embed.addFields({ name: "Booster Bonus", value: `+${boosterEntries - 1} entries`, inline: true });

    const msg = await channel.send({ embeds: [embed] });
    await msg.react("🎉");

    // 🔹 Insert giveaway into Supabase
    const { data, error } = await supabase
      .from("giveaways")
      .insert({
        prize,
        winners,
        channel_id: channel.id,
        message_id: msg.id,
        role_required: roleRequired?.id || null,
        messages_required: messagesRequired,
        invites_required: invitesRequired,
        booster_entries: boosterEntries,
        ends_at: endsAt
      })
      .select()
      .single();

    if (error) {
      console.error("❌ Failed to insert giveaway:", error);
      return interaction.reply({ content: "❌ Failed to create giveaway in database.", ephemeral: true });
    }

    interaction.reply({ content: `✅ Giveaway started in ${channel}!`, ephemeral: true });

    // Store giveaway info in memory (with DB id)
    giveaways.set(msg.id, {
      dbId: data.id, // uuid from DB
      messageId: msg.id,
      channelId: channel.id,
      prize,
      winners,
      endAt: Date.now() + durationMs,
      roleRequired,
      messagesRequired,
      invitesRequired,
      boosterEntries,
      entries: new Map()
    });

    // Schedule giveaway end (basic, can be improved with cron + DB check)
    setTimeout(async () => {
      const giveaway = giveaways.get(msg.id);
      if (!giveaway) return;

      const fetchedMsg = await channel.messages.fetch(giveaway.messageId);
      const reaction = fetchedMsg.reactions.cache.get("🎉");
      if (!reaction) return;

      const users = await reaction.users.fetch();
      let entrants = [];

      for (const [uid, user] of users) {
        if (user.bot) continue;
        const member = await channel.guild.members.fetch(uid).catch(() => null);
        if (!member) continue;

        // Role check
        if (giveaway.roleRequired && !member.roles.cache.has(giveaway.roleRequired.id)) continue;

        // TODO: cross-check messages & invites from Supabase here
        let entries = 1;
        if (member.premiumSince && giveaway.boosterEntries > 1) {
          entries += (giveaway.boosterEntries - 1);
        }
        entrants.push(...Array(entries).fill(uid));
      }

      if (entrants.length === 0) {
        return channel.send(`❌ No valid entrants for giveaway **${giveaway.prize}**`);
      }

      // Pick winners
      const winnersPicked = [];
      for (let i = 0; i < giveaway.winners && entrants.length > 0; i++) {
        const winnerId = entrants.splice(Math.floor(Math.random() * entrants.length), 1)[0];
        if (!winnersPicked.includes(winnerId)) winnersPicked.push(winnerId);
      }

      channel.send(`🎉 Congratulations ${winnersPicked.map(id => `<@${id}>`).join(", ")}! You won **${giveaway.prize}**!`);

      giveaways.delete(msg.id);
    }, durationMs);
  }
};
