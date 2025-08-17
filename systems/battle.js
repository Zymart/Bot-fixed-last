
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const battles = new Map();
function battleKey(chId, uid) { return `${chId}:${uid}`; }

async function startBattle(channel, user) {
  const enemy = { name: "Goblin", hp: 60, maxHp: 60, atk: 8 };
  const b = { hp: user.hp, maxHp: user.maxHp, enemy, turn: "player" };
  battles.set(battleKey(channel.id, user.userId), b);
  await renderBattle(channel, user, b, "⚔️ A wild Goblin appears!");
}

async function renderBattle(channel, user, b, headline) {
  const emb = new EmbedBuilder()
    .setTitle(`⚔️ Battle vs ${b.enemy.name}`)
    .setColor(0x9b59b6)
    .setDescription(`${headline}\n${user.username} HP: ${b.hp}/${b.maxHp}\n${b.enemy.name} HP: ${b.enemy.hp}/${b.enemy.maxHp}`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`battle:attack:${user.userId}`).setLabel("Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`battle:flee:${user.userId}`).setLabel("Flee").setStyle(ButtonStyle.Danger)
  );

  if (b.msg) await b.msg.edit({ embeds: [emb], components: [row] }).catch(()=>{});
  else b.msg = await channel.send({ embeds: [emb], components: [row] });
}

module.exports = { startBattle, renderBattle, battles, battleKey };
