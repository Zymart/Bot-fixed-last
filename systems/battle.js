const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getUser, saveUser } = require("./users");

function randomEnemy() {
  const enemies = [
    { name: "Goblin", hp: 30, attack: 5, exp: 10, gold: 5 },
    { name: "Orc", hp: 50, attack: 8, exp: 20, gold: 10 },
    { name: "Wolf", hp: 40, attack: 6, exp: 15, gold: 8 }
  ];
  return enemies[Math.floor(Math.random() * enemies.length)];
}

async function startBattle(channel, user) {
  const enemy = randomEnemy();
  user.hp = user.hp || 100;
  enemy.currentHp = enemy.hp;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("attack").setLabel("⚔️ Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("skill").setLabel("🔥 Skill").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("run").setLabel("🏃 Run").setStyle(ButtonStyle.Secondary)
  );

  const battleMsg = await channel.send({
    content: `⚔️ **Battle Started!**\n${user.username} vs ${enemy.name}\nHP: ${user.hp} | Enemy HP: ${enemy.hp}`,
    components: [row]
  });

  const collector = battleMsg.createMessageComponentCollector({ time: 60000 });

  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== user.id) {
      return interaction.reply({ content: "❌ This is not your battle!", ephemeral: true });
    }

    let log = "";

    if (interaction.customId === "attack") {
      const dmg = Math.floor(Math.random() * 10) + 5;
      enemy.currentHp -= dmg;
      log += `${user.username} attacked for **${dmg}** damage!\n`;
    }

    if (interaction.customId === "skill") {
      const dmg = Math.floor(Math.random() * 20) + 10;
      enemy.currentHp -= dmg;
      log += `${user.username} used a skill for **${dmg}** damage!\n`;
    }

    if (interaction.customId === "run") {
      collector.stop();
      return interaction.update({ content: "🏃 You ran away!", components: [] });
    }

    // Enemy attacks back if alive
    if (enemy.currentHp > 0) {
      const enemyDmg = Math.floor(Math.random() * enemy.attack) + 1;
      user.hp -= enemyDmg;
      log += `${enemy.name} countered for **${enemyDmg}** damage!\n`;
    }

    // Check win/lose
    if (enemy.currentHp <= 0) {
      user.exp += enemy.exp;
      user.gold += enemy.gold;
      saveUser(user);

      collector.stop();
      return interaction.update({
        content: `✅ ${user.username} defeated **${enemy.name}**!\n+${enemy.exp} EXP | +${enemy.gold} Gold`,
        components: []
      });
    }

    if (user.hp <= 0) {
      user.hp = 0;
      saveUser(user);

      collector.stop();
      return interaction.update({
        content: `💀 ${user.username} was defeated by **${enemy.name}**...`,
        components: []
      });
    }

    interaction.update({
      content: `⚔️ **Battle Ongoing!**\n${user.username} HP: ${user.hp} | ${enemy.name} HP: ${enemy.currentHp}\n\n${log}`,
      components: [row]
    });
  });

  collector.on("end", () => {
    if (!battleMsg.editable) return;
    battleMsg.edit({ components: [] }).catch(() => {});
  });
}

module.exports = { startBattle };
