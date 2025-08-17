const { startBattle } = require("./battle");
const { getUser, registerUser, saveUser, getProfile } = require("./users");
const { openPortal, listPortals } = require("./portals");

const PREFIX = process.env.PREFIX || "!";

async function runCommand(cmd, msg, args) {
  let user = getUser(msg.author.id);

  switch (cmd) {
    case "register":
      if (user) return msg.reply("✅ You are already registered.");
      registerUser(msg.author);
      return msg.reply("🎉 Registration complete! Use `!profile` to view your stats.");

    case "profile":
      if (!user) return msg.reply("❌ You must `!register` first.");
      return msg.reply(getProfile(user));

    case "battle":
      if (!user) return msg.reply("❌ You must `!register` first.");
      return startBattle(msg.channel, user);

    case "portal":
      if (!user) return msg.reply("❌ You must `!register` first.");
      return listPortals(msg.channel);

    case "openportal":
      if (msg.author.id !== process.env.OWNER_ID)
        return msg.reply("❌ Only the bot owner can open portals.");
      return openPortal(msg.channel);

    case "help":
      return msg.reply(
        `📜 **Available Commands**:
        \`${PREFIX}register\` → Create your account
        \`${PREFIX}profile\` → Show your stats
        \`${PREFIX}battle\` → Fight enemies
        \`${PREFIX}portal\` → See active portals
        \`${PREFIX}openportal\` → (Owner only) Open a new portal
        \`${PREFIX}help\` → Show this help menu`
      );

    default:
      return msg.reply("❌ Unknown command. Use `!help` to see commands.");
  }
}

module.exports = { runCommand };
