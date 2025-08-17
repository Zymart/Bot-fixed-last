
const { getUser } = require('./users');
function leaderboardCommand(msg, args) {
  const type = (args[0]||"exp").toLowerCase();
  let users = require('../data.json').users || [];
  if (!users.length) return msg.reply("No users yet.");
  users.sort((a,b)=> (b[type]||0) - (a[type]||0));
  const top = users.slice(0,10).map((u,i)=>`#${i+1} ${u.username} — ${u[type]||0}`);
  return msg.reply("🏆 Leaderboard by " + type + "\n" + top.join("\n"));
}
module.exports = { leaderboardCommand };
