
let guilds = [];
function handleGuildCommand(msg, args) {
  const sub = (args[0]||"").toLowerCase();
  if (sub === "create") {
    const name = args.slice(1).join(" ");
    if (!name) return msg.reply("Usage: !guild create <name>");
    if (guilds.find(g => g.leader === msg.author.id)) return msg.reply("You already own a guild.");
    const g = { name, leader: msg.author.id, members: [msg.author.id] };
    guilds.push(g);
    return msg.reply(`✅ Guild '${name}' created.`);
  }
  if (sub === "join") {
    const leaderId = args[1];
    const g = guilds.find(g => g.leader === leaderId);
    if (!g) return msg.reply("Guild not found.");
    if (g.members.includes(msg.author.id)) return msg.reply("Already in this guild.");
    g.members.push(msg.author.id);
    return msg.reply(`✅ Joined guild '${g.name}'`);
  }
  if (sub === "leave") {
    const g = guilds.find(g => g.members.includes(msg.author.id));
    if (!g) return msg.reply("Not in a guild.");
    g.members = g.members.filter(m => m !== msg.author.id);
    return msg.reply("✅ Left guild.");
  }
  if (sub === "info") {
    const g = guilds.find(g => g.members.includes(msg.author.id));
    if (!g) return msg.reply("Not in a guild.");
    return msg.reply(`🏰 Guild '${g.name}'\nLeader: <@${g.leader}>\nMembers: ${g.members.map(m=>"<@"+m+">").join(", ")}`);
  }
  return msg.reply("Guild commands: create, join, leave, info");
}
module.exports = { handleGuildCommand };
