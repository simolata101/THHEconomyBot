const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands with pagination'),

  async execute(interaction) {
    // Define all command categories and their descriptions
    const categories = [
      {
        name: 'Economy Commands',
        description: 'Manage your finances and earn rewards',
        commands: [
          { name: '/e work', description: 'Work to earn credits' },
          { name: '/e daily', description: 'Claim your daily reward' },
          { name: '/e hourly', description: 'Claim your hourly reward' },
          { name: '/e idle', description: 'Toggle idle earnings' },
          { name: '/e balance', description: 'Check your balances and items' },
          { name: '/e bank', description: 'Deposit or withdraw from bank' }
        ],
        color: 0x00ff00,
        emoji: '💰'
      },
      {
        name: 'Games & Gambling',
        description: 'Play games and try your luck',
        commands: [
          { name: '/games minigame', description: 'Play a dice minigame' },
          { name: '/games gamble coinflip', description: 'Bet on coin flip' },
          { name: '/games gamble rps', description: 'Rock Paper Scissors' },
          { name: '/games gamble tower', description: 'Tower risk game' },
          { name: '/games stock', description: 'Buy/sell stocks' },
          { name: '/games auction', description: 'Create an auction' },
          { name: '/games lottery', description: 'Buy lottery tickets' }
        ],
        color: 0xff9900,
        emoji: '🎮'
      },
      {
        name: 'Quests System',
        description: 'Track and complete daily quests',
        commands: [
          { name: '/q status', description: 'Check quest progress' },
          { name: '/q info', description: 'Get info about a quest' },
          { name: '/q claim', description: 'Claim your quest credit' }
        ],
        color: 0x0099ff,
        emoji: '📜'
      },
      {
        name: 'World & Shop',
        description: 'Shop, craft, and manage the economy',
        commands: [
          { name: '/w quests', description: 'List active quests' },
          { name: '/w complete', description: 'Complete a quest' },
          { name: '/w shop', description: 'View shop items' },
          { name: '/w buy', description: 'Purchase an item' },
          { name: '/w craft', description: 'Craft items' },
          { name: '/w collectible', description: 'Mint collectibles' },
          { name: '/w leaderboard', description: 'View leaderboard' }
        ],
        color: 0x9966ff,
        emoji: '🏪'
      }
    ];

    let currentPage = 0;
    
    // Function to create the embed for the current page
    const createEmbed = (page) => {
      const category = categories[page];
      
      return new EmbedBuilder()
        .setTitle(`${category.emoji} ${category.name}`)
        .setDescription(category.description)
        .setColor(category.color)
        .addFields(
          category.commands.map(cmd => ({
            name: cmd.name,
            value: cmd.description,
            inline: false
          }))
        )
        .setFooter({ 
          text: `Page ${page + 1} of ${categories.length} • Use buttons to navigate` 
        });
    };

    // Create navigation buttons
    const createButtons = (page) => {
      const row = new ActionRowBuilder();
      
      // Previous button
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('previous')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 0)
      );
      
      // Page indicator button (non-interactive)
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('page_indicator')
          .setLabel(`${page + 1}/${categories.length}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      
      // Next button
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === categories.length - 1)
      );
      
      return row;
    };

    // Send initial message with first page
    const message = await interaction.reply({
      embeds: [createEmbed(currentPage)],
      components: [createButtons(currentPage)],
      fetchReply: true
    });

    // Create collector for button interactions
    const filter = (i) => i.user.id === interaction.user.id;
    const collector = message.createMessageComponentCollector({ 
      filter, 
      time: 60000 // 1 minute timeout
    });

    collector.on('collect', async (i) => {
      if (i.customId === 'previous' && currentPage > 0) {
        currentPage--;
      } else if (i.customId === 'next' && currentPage < categories.length - 1) {
        currentPage++;
      }

      // Update the message with the new page
      await i.update({
        embeds: [createEmbed(currentPage)],
        components: [createButtons(currentPage)]
      });
    });

    collector.on('end', () => {
      // Disable all buttons when collector ends
      message.edit({
        components: [createButtons(currentPage).components.map(button => 
          button.setDisabled(true)
        )]
      }).catch(() => {
        // Message might already be deleted, ignore error
      });
    });
  }

};

