
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const portals = [];
const PORTAL_LIFETIME_MS = 24*60*60*1000;

function handlePortalCommand(msg) {
  const now = Date.now();
  const active = portals.filter(p => now < p.expires);
  if (!active.length) return msg.reply("No active portals.");
  return msg.reply("🌌 Active Portals:\n" + active.map(p => `- ${p.name} (closes in ${(p.expires-now)/1000/60|0}m)`).join("\n"));
}
async function spawnPortal(channel) {
  const portal = { name: "Mysterious Portal", expires: Date.now() + PORTAL_LIFETIME_MS };
  portals.push(portal);
  const emb = new EmbedBuilder().setTitle("🌌 A Portal Appears!").setDescription("Enter quickly before it closes.");
  const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("enterportal").setLabel("Enter Portal").setStyle(ButtonStyle.Primary));
  await channel.send({ embeds: [emb], components: [btn] });
}
function portalLoop(client) {
  const chId = process.env.SPAWN_CHANNEL_ID;
  if (!chId) return;
  (async function loop() {
    const delay = 5*60*1000 + Math.random()*5*60*1000;
    setTimeout(async () => {
      const channel = await client.channels.fetch(chId).catch(()=>null);
      if (channel) await spawnPortal(channel);
      loop();
    }, delay);
  })();
}
module.exports = { handlePortalCommand, spawnPortal, portalLoop };
